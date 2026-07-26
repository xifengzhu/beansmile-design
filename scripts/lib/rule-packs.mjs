// 规则包注册表加载、校验与唯一激活筛选实现（UI/UX 规范库分层扩展 §5、§6）。
// record-findings、acceptance 和测试不得各自重新实现筛选逻辑——适用集只能出自 applicableRules。
import { readFileSync, readdirSync } from "node:fs";
import yaml from "js-yaml";
import { makeValidator, loadRules } from "./rules.mjs";
import { RULES_DIR, RULE_PACKS_FILE, SCHEMAS } from "./paths.mjs";
import { sha256Text } from "./hash.mjs";

// 读取注册表，返回 { packs, byFile, byId }。不做语义校验（那是 validateRulePacks 的事）。
export function loadRulePacks(file = RULE_PACKS_FILE) {
  const doc = yaml.load(readFileSync(file, "utf8"));
  if (!doc || !Array.isArray(doc.packs)) throw new Error("rule-packs.yaml: 缺少顶层 packs 数组");
  const packs = doc.packs;
  const byFile = new Map();
  const byId = new Map();
  for (const p of packs) {
    if (p?.id) byId.set(p.id, p);
    for (const f of p?.files ?? []) byFile.set(f, p);
  }
  return { packs, byFile, byId };
}

// 递归键排序，保证规范化 JSON 的确定性（与键书写顺序无关）。
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]));
  }
  return v;
}

// 规则卡规范化哈希：剔除 _file 后递归键排序 JSON 再 sha256。键序不同的等价卡哈希相同。
export function canonicalRuleHash(card) {
  const { _file, ...rest } = card;
  return sha256Text(JSON.stringify(sortKeysDeep(rest)));
}

// schema 校验 + 机器门（spec §5）。packs/rules 可注入（测试用合成对象），默认读真实注册表与依据库。
export function validateRulePacks({ packs, rules, ruleFiles } = {}) {
  const errors = [];

  if (!packs) {
    try { ({ packs } = loadRulePacks()); } catch (e) { return { ok: false, errors: [String(e.message ?? e)], count: 0 }; }
  }
  if (!rules) ({ rules } = loadRules());
  if (!ruleFiles) ruleFiles = readdirSync(RULES_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();

  // 1. schema 校验（结构：required 字段、kind/activation 枚举、八维声明形状）
  const ajv = makeValidator();
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMAS.rulePack, "utf8")));
  if (!validate({ packs })) {
    for (const e of validate.errors) errors.push(`schema: ${e.instancePath || "(root)"} ${e.message}`);
  }

  // 2. 包 id、文件唯一；空包已由 schema minItems 拦，双保险再查一次
  const seenId = new Map();
  const seenFile = new Map();
  for (const p of packs) {
    const pid = p?.id ?? "(缺 id)";
    if (seenId.has(pid)) errors.push(`重复包 id: ${pid}`);
    else seenId.set(pid, p);
    if (!(p?.files ?? []).length) errors.push(`空包: ${pid} 未包含任何规则文件`);
    for (const f of p?.files ?? []) {
      if (seenFile.has(f)) errors.push(`重复归属: ${f} 同时属于 ${seenFile.get(f)} 与 ${pid}`);
      else seenFile.set(f, pid);
    }
  }

  // 3. 幽灵文件（注册表引用不存在的文件）与孤儿文件（evidence/rules 有文件未归包）
  const actual = new Set(ruleFiles);
  for (const [f, pid] of seenFile) {
    if (!actual.has(f)) errors.push(`幽灵文件: ${pid} 引用的 ${f} 不存在于 evidence/rules/`);
  }
  for (const f of ruleFiles) {
    if (!seenFile.has(f)) errors.push(`孤儿文件: evidence/rules/${f} 未归属任何规则包`);
  }

  // 4. 同 type 的激活值不得跨包重复（industry/reference_system 各自命名空间内唯一）
  const seenActivation = new Map(); // `${type}:${value}` → pack id
  for (const p of packs) {
    const a = p?.activation;
    if (!a || a.type === "always") continue;
    for (const v of a.values ?? []) {
      const key = `${a.type}:${v}`;
      if (seenActivation.has(key)) errors.push(`激活值跨包重复: ${a.type}=${v}（${seenActivation.get(key)} 与 ${p.id}）`);
      else seenActivation.set(key, p.id);
    }
  }

  // 5. 来源 host 白名单 + reference_system 包纪律（不得 required；八维声明由 schema 保证形状）
  const rulesByFile = new Map();
  for (const r of rules) {
    if (!rulesByFile.has(r._file)) rulesByFile.set(r._file, []);
    rulesByFile.get(r._file).push(r);
  }
  for (const p of packs) {
    const hosts = new Set(p?.allowed_source_hosts ?? []);
    if (!hosts.size) errors.push(`${p?.id}: allowed_source_hosts 为空`);
    for (const f of p?.files ?? []) {
      for (const r of rulesByFile.get(f) ?? []) {
        let host = "";
        try { host = new URL(r.source_url).host; } catch { /* 非法 URL 由规则卡 schema 拦 */ }
        if (host && !hosts.has(host)) {
          errors.push(`${p.id}: 规则 ${r.id}（${f}）source_url host=${host} 不在包白名单 [${[...hosts].join(", ")}]`);
        }
        if (p.kind === "reference_system" && r.strength === "required") {
          errors.push(`${p.id}: reference_system 包不得含 strength: required（规则 ${r.id}）——品牌系统不能覆盖无障碍/平台底线`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, count: packs.length };
}

// 判断单个包对当前项目是否激活。
function packActive(pack, project) {
  const a = pack.activation ?? {};
  if (a.type === "always") return true;
  if (a.type === "industry") return !!project.industry && (a.values ?? []).includes(project.industry);
  if (a.type === "reference_system") {
    const rs = project.reference_system;
    if (!rs || rs === "none") return false;
    return (a.values ?? []).includes(rs);
  }
  return false;
}

// 唯一激活筛选实现（spec §6）：包激活 → 规则卡 platforms 与 project.platforms 求交。
// 返回 [{ rule, rule_id, pack_id, file, rule_sha256 }]，按 rule_id 稳定排序。
// project.reference_system 值未知（非 none 且不在任何 reference_system 包的 values 中）时抛错，
// 不自动回退（spec §9.2）。
export function applicableRules(project = {}, rules, packs) {
  const rs = project.reference_system;
  if (rs && rs !== "none") {
    const known = packs.some((p) =>
      p.activation?.type === "reference_system" && (p.activation.values ?? []).includes(rs));
    if (!known) {
      throw new Error(`未知主参考系统 reference_system=${rs}：注册表中无对应规则包，不自动回退（需先登记规则包或改用 none）`);
    }
  }

  const byFile = new Map();
  for (const p of packs) {
    if (!packActive(p, project)) continue;
    for (const f of p.files ?? []) byFile.set(f, p);
  }

  const platforms = project.platforms ?? [];
  const out = [];
  for (const r of rules) {
    const pack = byFile.get(r._file);
    if (!pack) continue;
    if (!(r.platforms ?? []).some((p) => platforms.includes(p))) continue;
    out.push({ rule: r, rule_id: r.id, pack_id: pack.id, file: r._file, rule_sha256: canonicalRuleHash(r) });
  }
  out.sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
  return out;
}
