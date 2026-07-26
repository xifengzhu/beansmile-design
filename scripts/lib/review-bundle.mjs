// 紧凑评审规则包（规范 27.4）：冻结规则卡的**确定性投影**，只含评审判定所需字段，
// 剔除溯源与裁决字段（publisher/source_url/source_version/last_verified/rationale/
// evidence_grade/conflicts_with——留在冻结全卡，评审需要裁决细节时回读）。
// 完整性靠再生比对：snapshot（生成端）与 loadFrozenRules（校验端）共用 buildReviewBundle，
// 校验端用已通过 canonicalRuleHash 校验的冻结卡重建 bundle 并比对 sha256——篡改 bundle
// 软化规则文本即被抓（篡改冻结卡本身已被哈希门拦）。
import yaml from "js-yaml";
import { sha256Text } from "./hash.mjs";

// 逐字段白名单投影（评审判定所需）；exceptions 有才带。
export const BUNDLE_PROJECTED_FIELDS = ["title", "rule", "check_method", "platforms", "scope", "strength"];

// 纯函数，输出确定性 YAML 文本。cards: 冻结规则卡数组（含 id）；template:
// review-scope 的 rule_coverage_template（已按 rule_id 排序，携带 pack_id/rule_sha256/state）；
// version: 快照版本。模板行无对应卡时抛错（调用方保证卡集完整后才调用）。
export function buildReviewBundle({ cards, template, version }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rows = [...(template ?? [])].sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
  const rules = rows.map((row) => {
    const card = byId.get(row.rule_id);
    if (!card) throw new Error(`模板行 ${row.rule_id} 无对应冻结卡`);
    const entry = { rule_id: row.rule_id, pack_id: row.pack_id, rule_sha256: row.rule_sha256, state: row.state };
    for (const f of BUNDLE_PROJECTED_FIELDS) if (card[f] !== undefined) entry[f] = card[f];
    if (card.exceptions !== undefined) entry.exceptions = card.exceptions;
    if (row.not_applicable_candidate?.value) {
      entry.na_candidate = { value: true, reason: row.not_applicable_candidate.reason ?? null };
    }
    return entry;
  });
  const doc = {
    artifact_version: String(version),
    bundle_version: 1,
    projected_fields: [...BUNDLE_PROJECTED_FIELDS, "exceptions?"],
    stats: {
      total: rules.length,
      review_required: rows.filter((r) => r.state === "review_required").length,
      prefilled_automated: rows.filter((r) => r.state === "prefilled_automated").length,
      not_applicable_candidates: rows.filter((r) => r.not_applicable_candidate?.value).length,
    },
    rules,
  };
  return "# 紧凑评审规则包（规范 27.4）：冻结卡的确定性投影，评审输入首选本文件。\n"
    + "# 溯源字段（source_url/rationale 等）在同目录冻结全卡中，裁决细节时回读。\n"
    + "# 本文件由快照再生比对保护：任何手改都会被 loadFrozenRules 判为篡改。\n"
    + yaml.dump(doc, { lineWidth: 120 });
}

// 再生比对门：盘上文本 vs 用冻结卡重建的文本，字节级一致才放行。
export function bundleIssues(diskText, { cards, template, version }) {
  let rebuilt;
  try { rebuilt = buildReviewBundle({ cards, template, version }); }
  catch (e) { return [`review-bundle 再生失败: ${e.message}`]; }
  if (sha256Text(diskText) !== sha256Text(rebuilt)) {
    return ["rules/review-bundle.yaml 与冻结卡再生结果不符（评审面文本被篡改或非本快照产物），当前版本 findings 无效，须重新 snapshot 和双评审"];
  }
  return [];
}
