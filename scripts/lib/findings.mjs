// findings 加载与校验（规范 7.8）。评审只返回结构，Director 经此校验后落盘。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { makeValidator } from "./rules.mjs";
import { SCHEMAS } from "./paths.mjs";
import { sha256File } from "./hash.mjs";

let _validate;
function validator() {
  if (!_validate) {
    const ajv = makeValidator();
    _validate = ajv.compile(JSON.parse(readFileSync(SCHEMAS.findings, "utf8")));
  }
  return _validate;
}

export function validateFindingsDoc(doc) {
  const validate = validator();
  const ok = validate(doc);
  return { ok, errors: ok ? [] : validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`) };
}

// 读取某交付包中，对应 artifact_version 的两份 findings（standards + visual）。
export function loadFindingsForVersion(pkgRoot, artifactVersion) {
  const dir = join(pkgRoot, "audit", "findings");
  const out = { standards: null, visual: null, errors: [] };
  if (!existsSync(dir)) { out.errors.push("audit/findings 目录不存在"); return out; }
  for (const reviewer of ["standards", "visual"]) {
    const file = join(dir, `${reviewer}-${artifactVersion}.yaml`);
    if (!existsSync(file)) { out.errors.push(`缺当前版本 findings: ${reviewer}-${artifactVersion}.yaml`); continue; }
    const doc = yaml.load(readFileSync(file, "utf8"));
    const v = validateFindingsDoc(doc);
    if (!v.ok) { out.errors.push(`${reviewer}-${artifactVersion}.yaml schema 失败: ${v.errors.join("; ")}`); continue; }
    if (doc.artifact_version !== artifactVersion) {
      out.errors.push(`${reviewer} findings artifact_version=${doc.artifact_version} 与当前 ${artifactVersion} 不符`);
      continue;
    }
    if (doc.reviewer !== reviewer) { out.errors.push(`${reviewer} findings reviewer 字段=${doc.reviewer} 不符`); continue; }
    out[reviewer] = doc;
  }
  return out;
}

export function countBlockers(doc) {
  return (doc?.findings ?? []).filter((f) => f.severity === "blocker").length;
}

export const DIMENSIONS = ["hierarchy", "rhythm", "typography", "color", "consistency", "content", "brand", "completion"];

// visual 评审的语义校验（schema 之外的"必须真看过图"纪律，规范 7.8 / rubric）：
// 八维各恰好一条；引用的截图真实存在且哈希匹配（防引用不存在或事后被换的图）；
// observed 含实测数值；非 pass 判定须有同维度的 finding 对应；finding 须标注维度。
// 证据多样性（规范 24.2）：可选截图 ≥2 张时八维不得全引用同一张；observed 两两不得
// 完全相同——机器不判语义真假，只封"八份复制一份"的零成本造假。
// 返回问题清单，空数组=通过。
export function semanticIssuesVisual(doc, pkgRoot) {
  const issues = [];
  const reviews = doc.dimension_reviews ?? [];

  const shotDir = join(pkgRoot, "audit", "screenshots");
  const availableShots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => f.endsWith(".png")).length : 0;
  if (availableShots >= 2 && reviews.length >= 2 && new Set(reviews.map((r) => r.screenshot)).size < 2) {
    issues.push(`八维全部引用同一张截图（audit/screenshots/ 有 ${availableShots} 张可用），不构成逐维看图的证据`);
  }
  const byObserved = new Map();
  for (const r of reviews) {
    const key = String(r.observed ?? "").trim();
    if (byObserved.has(key)) issues.push(`[${r.dimension}] observed 与 [${byObserved.get(key)}] 完全相同——模板化复制不构成逐维观察`);
    else byObserved.set(key, r.dimension);
  }

  const seen = new Map();
  for (const r of reviews) seen.set(r.dimension, (seen.get(r.dimension) ?? 0) + 1);
  for (const d of DIMENSIONS) {
    const n = seen.get(d) ?? 0;
    if (n === 0) issues.push(`缺维度 dimension_reviews: ${d}`);
    if (n > 1) issues.push(`维度重复: ${d} 出现 ${n} 次`);
  }

  for (const r of reviews) {
    const p = join(pkgRoot, r.screenshot);
    if (r.screenshot.includes("..")) { issues.push(`[${r.dimension}] 截图路径非法: ${r.screenshot}`); continue; }
    if (!/^audit\//.test(r.screenshot)) issues.push(`[${r.dimension}] 截图须位于 audit/ 下: ${r.screenshot}`);
    if (!existsSync(p)) { issues.push(`[${r.dimension}] 引用的截图不存在: ${r.screenshot}`); continue; }
    if (sha256File(p) !== r.screenshot_sha256) issues.push(`[${r.dimension}] 截图哈希不匹配（引用的不是盘上这张图）: ${r.screenshot}`);
    if (!/\d/.test(r.observed)) issues.push(`[${r.dimension}] observed 无任何实测数值（px/hex/比值/数量），不满足证据纪律`);
    if (r.judgment !== "pass") {
      const linked = (doc.findings ?? []).some((f) => f.dimension === r.dimension && (r.judgment === "blocker" ? f.severity === "blocker" : ["blocker", "warning"].includes(f.severity)));
      if (!linked) issues.push(`[${r.dimension}] judgment=${r.judgment} 但 findings 中无同维度、相称严重度的条目`);
    }
  }

  for (const f of doc.findings ?? []) {
    if (!f.dimension) issues.push(`finding ${f.id} 缺 dimension 标注（八维之一）`);
    if (["blocker", "warning"].includes(f.severity) && !/\d/.test(f.evidence ?? "")) {
      issues.push(`finding ${f.id}（${f.severity}）evidence 无实测数值，不满足证据纪律`);
    }
  }
  return issues;
}

// standards 评审的语义校验（覆盖矩阵纪律）："pass + 空 findings"不构成合规证明——
// 每条适用规则都必须在 rule_coverage 里逐条出现，带核查方式与证据；
// fail 须有对应 finding；Web 规则不得用 intent_only（HTML 即目标载体，规范 6.3 的
// 保真度边界只豁免原生平台项）。
// 适用集 applicable 由调用方经 rule-packs.mjs 的 applicableRules() 计算后传入（规则卡数组），
// 本函数不再做平台/行业筛选——激活逻辑只有一份实现（分层扩展 §6）。
const WEB_PLATFORMS = ["web", "mobile_web"];

// 行业 slug → 规则包文件名（下划线归一为连字符：saas_b2b → industry-saas-b2b.yaml）。
// 旧路径兼容保留；激活判断以 evidence/rule-packs.yaml 注册表为准。
export function industryPackFile(industry) {
  return `industry-${String(industry).replaceAll("_", "-")}.yaml`;
}

export function semanticIssuesStandards(doc, applicable) {
  const issues = [];
  const cov = doc.rule_coverage ?? [];
  const byId = new Map(applicable.map((r) => [r.id, r]));

  const seen = new Map();
  for (const c of cov) seen.set(c.rule_id, (seen.get(c.rule_id) ?? 0) + 1);
  for (const [id, n] of seen) {
    if (!byId.has(id)) issues.push(`rule_coverage 引用适用规则集外的规则: ${id}`);
    if (n > 1) issues.push(`rule_coverage 重复条目: ${id} 出现 ${n} 次`);
  }
  const missing = applicable.filter((r) => !seen.has(r.id)).map((r) => r.id);
  if (missing.length) {
    issues.push(`覆盖缺口：目标平台适用规则未逐条核查，缺 ${missing.length} 条: ${missing.slice(0, 8).join(",")}${missing.length > 8 ? " 等" : ""}`);
  }

  for (const c of cov) {
    const rule = byId.get(c.rule_id);
    if (!rule) continue;
    if ((c.evidence ?? "").trim().length < 10) {
      issues.push(`[${c.rule_id}] 覆盖证据过短——每条要写检查了什么、看到了什么（含定位或实测值）`);
    }
    if (c.result === "intent_only" && (rule.platforms ?? []).some((p) => WEB_PLATFORMS.includes(p))) {
      issues.push(`[${c.rule_id}] Web 平台规则不得用 intent_only（HTML 即目标载体，必须实际验证）`);
    }
    if (c.result === "fail") {
      const linked = (doc.findings ?? []).some((f) => f.rule_id === c.rule_id && ["blocker", "warning"].includes(f.severity));
      if (!linked) issues.push(`[${c.rule_id}] coverage result=fail 但 findings 中无对应 blocker/warning 条目（矩阵与 findings 脱钩）`);
    }
  }

  // 反向一致性：带 rule_id 的 blocker/warning finding，coverage 里不得写 pass。
  for (const f of doc.findings ?? []) {
    if (f.rule_id && ["blocker", "warning"].includes(f.severity)) {
      const c = cov.find((x) => x.rule_id === f.rule_id);
      if (c && c.result === "pass") issues.push(`[${f.rule_id}] finding ${f.id}（${f.severity}）与 coverage result=pass 自相矛盾`);
    }
  }
  return issues;
}
