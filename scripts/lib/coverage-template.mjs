// 覆盖模板生成与受控合并（分层扩展 §8.3）。
// buildCoverageTemplate：applicableRules() 的结果在评审前生成确定性覆盖模板——reviewer 不再
// 从空白手写 rule_coverage，只对 review_required 行返回更新。
// mergeCoverage：单向阀合并。拒绝增行/缺行/重复行/改锁定字段/覆盖自动证据/遗留 null/
// 未确认 N/A 候选；prefilled_automated 只允许 pass→fail 升级。
import { diffHashMaps } from "./hash.mjs";
import { CHECK_MAPPING_BY_ID } from "./check-mapping.mjs";

const RESULTS = ["pass", "fail", "intent_only", "not_applicable"];
const VIAS = ["automated", "screenshot", "code", "manual_checklist"];
// 锁定字段由模板决定；reviewer 行携带且不一致时拒绝。
const LOCKED_FIELDS = ["pack_id", "rule_sha256", "expected_check_method", "state"];

// 纯函数。applicable: applicableRules() 的返回（[{rule, rule_id, pack_id, file, rule_sha256}]）；
// results: audit/results.json 解析对象（可 null）；snapshotPrototypeHashes: 快照 prototype/ 的
// {相对路径: sha256}；naMap: naCandidates() 的 Map<rule_id, reason>；snapshotVersion: 快照版本。
// prefilled_automated 三重前提缺一不可：
//   1) CHECK_MAPPING 有该 rule_id 的显式映射；
//   2) results 非空且 results.page_hashes 与快照原型哈希逐键一致（prototype/ 前缀对齐）；
//   3) results.artifact_version 与快照版本一致。
// decide 判 fail 同样 prefill——fail 也是可信自动证据；decide 返回 null（信号缺失）不 prefill。
export function buildCoverageTemplate({ applicable, results, snapshotPrototypeHashes, naMap, snapshotVersion }) {
  const na = naMap ?? new Map();

  let resultsTrusted = false;
  if (results && typeof results === "object") {
    const versionOk = results.artifact_version !== undefined && snapshotVersion !== undefined
      && String(results.artifact_version) === String(snapshotVersion);
    const hashes = snapshotPrototypeHashes ?? {};
    const sameOrigin = !!results.page_hashes
      && Object.keys(hashes).length > 0
      && diffHashMaps(hashes, results.page_hashes, ["prototype"]).length === 0;
    resultsTrusted = versionOk && sameOrigin;
  }

  const sorted = [...(applicable ?? [])].sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
  const template = sorted.map((a) => {
    const naReason = na.get(a.rule_id);
    const row = {
      rule_id: a.rule_id,
      pack_id: a.pack_id,
      rule_sha256: a.rule_sha256,
      expected_check_method: a.rule?.check_method ?? null,
      state: "review_required",
      result: null,
      checked_via: null,
      evidence: null,
      not_applicable_candidate: { value: naReason !== undefined, reason: naReason ?? null },
    };
    const mapping = CHECK_MAPPING_BY_ID.get(a.rule_id);
    if (mapping && resultsTrusted) {
      const d = mapping.decide(results);
      if (d) {
        row.state = "prefilled_automated";
        row.result = d.result;
        row.checked_via = "automated";
        row.evidence = d.evidence;
      }
    }
    return row;
  });

  const stats = {
    total_rules: template.length,
    automated_prefilled: template.filter((r) => r.state === "prefilled_automated").length,
    review_required: template.filter((r) => r.state === "review_required").length,
    not_applicable_candidates: template.filter((r) => r.not_applicable_candidate.value).length,
  };
  return { template, stats };
}

// N/A 候选确认证据：须写明范围确认依据（机器可查的最低要求：≥10 字符且明确提到"范围"）。
function naEvidenceOk(evidence) {
  const e = String(evidence ?? "").trim();
  return e.length >= 10 && /范围/.test(e);
}

// 受控合并（单向阀）。reviewerRows 每行 { rule_id, result, checked_via, evidence, na_confirmed? }。
// 返回 { ok, errors, coverage, stats }：coverage 与 findings schema 的 rule_coverage 条目形状一致
// （rule_id/result/checked_via/evidence）；任何一处违规即整体拒绝（coverage=null）。
export function mergeCoverage(template, reviewerRows) {
  const errors = [];
  const tpl = template ?? [];
  const byId = new Map(tpl.map((t) => [t.rule_id, t]));

  const updates = new Map();
  for (const r of Array.isArray(reviewerRows) ? reviewerRows : []) {
    if (!r || typeof r !== "object" || !r.rule_id) { errors.push("reviewer 行缺 rule_id"); continue; }
    if (!byId.has(r.rule_id)) { errors.push(`模板外规则（不得增行）: ${r.rule_id}`); continue; }
    if (updates.has(r.rule_id)) { errors.push(`重复行: ${r.rule_id}`); continue; }
    updates.set(r.rule_id, r);
  }

  const coverage = [];
  for (const t of tpl) {
    const r = updates.get(t.rule_id);
    if (r) {
      for (const k of LOCKED_FIELDS) {
        if (k in r && JSON.stringify(r[k]) !== JSON.stringify(t[k])) {
          errors.push(`[${t.rule_id}] 修改锁定字段 ${k}（rule_id/pack_id/rule_sha256 等由模板决定）`);
        }
      }
    }

    if (t.state === "prefilled_automated") {
      if (!r) { // 自动证据原样落盘
        coverage.push({ rule_id: t.rule_id, result: t.result, checked_via: t.checked_via, evidence: t.evidence });
        continue;
      }
      // 单向阀：只允许 pass→fail 升级；fail→pass 及一切覆盖自动证据的改写一律拒绝。
      if (t.result === "fail") { errors.push(`[${t.rule_id}] 自动实测已判 fail，不得被 reviewer 覆盖（fail→${r.result} 拒绝）`); continue; }
      if (r.result !== "fail") { errors.push(`[${t.rule_id}] prefilled_automated 行只允许 pass→fail 升级，不得改为 ${r.result}（覆盖自动证据来源）`); continue; }
      if (String(r.evidence ?? "").trim().length < 10) { errors.push(`[${t.rule_id}] pass→fail 升级须附 ≥10 字符实测证据`); continue; }
      if (!VIAS.includes(r.checked_via)) { errors.push(`[${t.rule_id}] 非法 checked_via: ${r.checked_via}`); continue; }
      coverage.push({ rule_id: t.rule_id, result: "fail", checked_via: r.checked_via, evidence: r.evidence });
      continue;
    }

    // review_required：缺更新即遗留 null，拒绝。
    if (!r) { errors.push(`[${t.rule_id}] 缺行：review_required 行未被 reviewer 闭合（不得遗留 null）`); continue; }
    if (!RESULTS.includes(r.result)) { errors.push(`[${t.rule_id}] 非法/遗留 null result: ${r.result}`); continue; }
    if (!VIAS.includes(r.checked_via)) { errors.push(`[${t.rule_id}] 非法 checked_via: ${r.checked_via}`); continue; }
    if (String(r.evidence ?? "").trim().length < 10) { errors.push(`[${t.rule_id}] evidence 过短（<10 字符），不满足证据纪律`); continue; }
    if (r.result === "not_applicable" && t.not_applicable_candidate?.value) {
      // 候选只是提示：最终 not_applicable 必须 reviewer 显式确认范围。
      if (r.na_confirmed !== true) { errors.push(`[${t.rule_id}] N/A 候选未确认：reviewer 行须 na_confirmed: true 且 evidence 写明范围确认依据`); continue; }
      if (!naEvidenceOk(r.evidence)) { errors.push(`[${t.rule_id}] N/A 候选确认证据须写明范围确认依据（含"范围"说明，≥10 字符）`); continue; }
    }
    // 非候选行 reviewer 独立判 N/A：允许（候选只是提示不是白名单），证据已按上方通用纪律校验。
    coverage.push({ rule_id: t.rule_id, result: r.result, checked_via: r.checked_via, evidence: r.evidence });
  }

  const ok = errors.length === 0;
  const stats = ok ? {
    total_rules: tpl.length,
    from_automated: tpl.filter((t) => t.state === "prefilled_automated" && !updates.has(t.rule_id)).length,
    from_reviewer: [...updates.keys()].length,
    upgraded_to_fail: tpl.filter((t) => t.state === "prefilled_automated" && updates.has(t.rule_id)).length,
    not_applicable: coverage.filter((c) => c.result === "not_applicable").length,
  } : null;
  return { ok, errors, coverage: ok ? coverage : null, stats };
}

// 模板闭合校验（落盘后视角，record-findings 与 acceptance 共用，spec §8.4/§8.5 门 d）：
// 对照 review-scope 模板逐行检查最终 rule_coverage——无 null、无缺行/增行/重复、
// prefilled 无 fail→pass（pass 只可原样或升级为 fail 且升级须有对应 blocker/warning finding）、
// N/A 候选写 not_applicable 时证据须含范围确认。
export function templateClosureIssues(coverage, template, findings = []) {
  const issues = [];
  const tpl = template ?? [];
  const covById = new Map();
  for (const c of coverage ?? []) {
    if (covById.has(c.rule_id)) issues.push(`重复 coverage 行: ${c.rule_id}`);
    else covById.set(c.rule_id, c);
  }
  const tplIds = new Set(tpl.map((t) => t.rule_id));
  for (const id of covById.keys()) {
    if (!tplIds.has(id)) issues.push(`coverage 含模板外规则（不得增行）: ${id}`);
  }
  for (const t of tpl) {
    const c = covById.get(t.rule_id);
    if (!c) { issues.push(`模板行未闭合（coverage 缺行）: ${t.rule_id}`); continue; }
    if (c.result == null || c.checked_via == null || c.evidence == null) {
      issues.push(`[${t.rule_id}] 遗留 null（result/checked_via/evidence），模板未闭合`);
      continue;
    }
    if (t.state === "prefilled_automated") {
      if (t.result === "fail" && c.result !== "fail") {
        issues.push(`[${t.rule_id}] 自动实测 fail 被改为 ${c.result}（单向阀违规：fail→pass 一律拒绝）`);
      } else if (t.result === "pass" && c.result !== "pass") {
        if (c.result !== "fail") {
          issues.push(`[${t.rule_id}] prefilled 行只可原样 pass 或升级为 fail，不得改为 ${c.result}`);
        } else if (!findings.some((f) => f.rule_id === t.rule_id && ["blocker", "warning"].includes(f.severity))) {
          issues.push(`[${t.rule_id}] pass→fail 升级须有对应 blocker/warning finding`);
        }
      }
    }
    if (t.not_applicable_candidate?.value && c.result === "not_applicable" && !naEvidenceOk(c.evidence)) {
      issues.push(`[${t.rule_id}] N/A 候选写 not_applicable 时证据须含范围确认（写明为何超出本次范围）`);
    }
  }
  return issues;
}
