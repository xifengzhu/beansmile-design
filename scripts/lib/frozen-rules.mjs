// 冻结规则读取（分层扩展 §8.4）：record-findings 与 acceptance 共用的唯一实现——
// 评审与验收的适用集只能出自快照 audit/snapshots/<version>/rules/，不得读取仓库当前
// evidence/rules/（规则库升级不追溯改变旧快照的适用集）。
// 逐卡校验 canonicalRuleHash 与 rules-manifest.json 一致，篡改即拒。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { canonicalRuleHash, applicableRules } from "./rule-packs.mjs";
import { bundleIssues } from "./review-bundle.mjs";

// §9.1 统一迁移措辞：未迁移历史包得到迁移提示，不写成"历史交付非法"。
export const MIGRATION_HINT =
  "需要迁移后重验：历史包按 §9.1 显式迁移（补 reference_system→升版→重新 snapshot→双评审）；历史 delivered 结论不因此失效";

// 返回 { ok, errors, cards, manifest, scope, bundle }。
// cards: 冻结规则卡数组（含 _file=快照内来源文件名）；manifest: rules-manifest.json 对象；
// scope: review-scope.yaml 对象（含 rule_coverage_template）；bundle: rules/review-bundle.yaml
// 解析对象（规范 27.4 紧凑评审包，通过再生比对后才返回；v1.7 老快照无 bundle → null，
// 评审回退读冻结全卡，不报错）。
// 快照缺 rules/ → ok=false 且 errors 用 MIGRATION_HINT（§9.1，不得静默回填）。
export function loadFrozenRules(pkgRoot, version) {
  const out = { ok: false, errors: [], cards: null, manifest: null, scope: null, bundle: null };
  const rulesDir = join(pkgRoot, "audit", "snapshots", String(version), "rules");
  const manifestPath = join(rulesDir, "rules-manifest.json");
  const scopePath = join(rulesDir, "review-scope.yaml");

  if (!existsSync(rulesDir) || !existsSync(manifestPath)) {
    out.errors.push(`快照 v${version} 缺 rules/ 冻结规则（${MIGRATION_HINT}）`);
    return out;
  }

  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { out.errors.push(`rules-manifest.json 解析失败: ${e.message}`); return out; }
  if (!Array.isArray(manifest?.rules)) { out.errors.push("rules-manifest.json 缺 rules 数组"); return out; }
  if (String(manifest.artifact_version) !== String(version)) {
    out.errors.push(`rules-manifest.json artifact_version=${manifest.artifact_version} 与快照版本 ${version} 不符`);
    return out;
  }

  let scope = null;
  if (existsSync(scopePath)) {
    try { scope = yaml.load(readFileSync(scopePath, "utf8")); }
    catch (e) { out.errors.push(`review-scope.yaml 解析失败: ${e.message}`); return out; }
  } else {
    out.errors.push(`快照 v${version} 缺 rules/review-scope.yaml（${MIGRATION_HINT}）`);
    return out;
  }

  // 读全部冻结卡文件（manifest 引用的 file 并集），建 rule_id → card 索引。
  const cardsByFile = new Map();
  for (const f of readdirSync(rulesDir).filter((x) => /\.ya?ml$/.test(x) && x !== "review-scope.yaml")) {
    let doc;
    try { doc = yaml.load(readFileSync(join(rulesDir, f), "utf8")); }
    catch (e) { out.errors.push(`冻结卡文件 ${f} 解析失败: ${e.message}`); continue; }
    cardsByFile.set(f, Array.isArray(doc?.rules) ? doc.rules : []);
  }

  const cards = [];
  const seen = new Set();
  for (const entry of manifest.rules) {
    const { rule_id, file, sha256 } = entry ?? {};
    if (seen.has(rule_id)) { out.errors.push(`rules-manifest.json 重复规则: ${rule_id}`); continue; }
    seen.add(rule_id);
    const fileCards = cardsByFile.get(file);
    if (!fileCards) { out.errors.push(`manifest 引用的冻结卡文件缺失: ${file}（规则 ${rule_id}）`); continue; }
    const card = fileCards.find((c) => c?.id === rule_id);
    if (!card) { out.errors.push(`冻结卡缺失: ${rule_id} 不在 ${file} 中`); continue; }
    if (canonicalRuleHash(card) !== sha256) {
      out.errors.push(`冻结卡被篡改（哈希漂移）: ${rule_id}（${file} 中的卡与 rules-manifest 记录的 sha256 不符），当前版本 findings 无效，须重新 snapshot 和双评审`);
      continue;
    }
    cards.push({ ...card, _file: file });
  }

  // 快照目录里多出 manifest 未登记的卡也算篡改面（防"塞私货卡"绕过登记）。
  const manifestIds = new Set(manifest.rules.map((r) => r.rule_id));
  for (const [f, fileCards] of cardsByFile) {
    for (const c of fileCards) {
      if (c?.id && !manifestIds.has(c.id)) out.errors.push(`快照 rules/${f} 含 manifest 未登记的卡: ${c.id}`);
    }
  }

  // 紧凑评审包再生比对（规范 27.4）：只有卡集完好才有资格重建比对；
  // v1.8 快照（snapshot_version>=2）缺 bundle 即拒（防"删掉紧凑包逼评审读全库"的降级面），
  // v1.7 老快照无 bundle 属迁移语义，不报错。
  let bundle = null;
  if (out.errors.length === 0) {
    const bundlePath = join(rulesDir, "review-bundle.yaml");
    if (existsSync(bundlePath)) {
      const diskText = readFileSync(bundlePath, "utf8");
      const issues = bundleIssues(diskText, { cards, template: scope?.rule_coverage_template ?? [], version });
      if (issues.length) out.errors.push(...issues);
      else bundle = yaml.load(diskText);
    } else if ((manifest.snapshot_version ?? 1) >= 2) {
      out.errors.push(`快照 v${version} 缺 rules/review-bundle.yaml（v1.8 快照必须含紧凑评审包），须重新 snapshot`);
    }
  }

  out.ok = out.errors.length === 0;
  if (out.ok) { out.cards = cards; out.manifest = manifest; out.scope = scope; out.bundle = bundle; }
  return out;
}

// 「规则包激活」门（spec §8.5-a）的核心比对：context、当前注册表重算集与冻结 manifest
// 是否一致。rules/packs 可注入（测试用合成对象），默认由调用方传入真实库。
// 返回问题清单，空数组=一致。规则库在快照后升级导致重算集变化 → 明确提示升版重评。
export function activationGateIssues(project, manifest, scope, rules, packs) {
  const problems = [];
  const eq = (k, a, b) => {
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      problems.push(`review-scope.${k}=${JSON.stringify(a ?? null)} 与 context ${JSON.stringify(b ?? null)} 不一致`);
    }
  };
  eq("platforms", scope?.platforms, project.platforms ?? []);
  eq("industry", scope?.industry, project.industry ?? null);
  eq("reference_system", scope?.reference_system, project.reference_system);

  const manifestIds = new Set((manifest?.rules ?? []).map((r) => r.rule_id));
  try {
    const nowIds = applicableRules(project, rules, packs).map((a) => a.rule_id);
    const missing = nowIds.filter((id) => !manifestIds.has(id));
    const extra = [...manifestIds].filter((id) => !nowIds.includes(id));
    if (missing.length || extra.length) {
      problems.push(
        `冻结集与当前注册表重算集不一致（缺 ${missing.length} 条: ${missing.slice(0, 3).join(",")}${missing.length > 3 ? "…" : ""}；多 ${extra.length} 条: ${extra.slice(0, 3).join(",")}${extra.length > 3 ? "…" : ""}）——规则库已升级，需升版重新 snapshot 评审`
      );
    }
  } catch (e) { problems.push(`当前注册表重算失败: ${e.message}`); }
  return problems;
}
