// 覆盖模板生成与受控合并（单向阀）测试（分层扩展 §8.3 / §10.4）。纯函数直测合成对象。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoverageTemplate, mergeCoverage, templateClosureIssues } from "../lib/coverage-template.mjs";
import { canonicalRuleHash } from "../lib/rule-packs.mjs";
import { CHECK_MAPPING, CHECK_MAPPING_BY_ID, validateCheckMapping } from "../lib/check-mapping.mjs";
import { loadRules } from "../lib/rules.mjs";

// —— 合成夹具 ——

const APP = (id, extra = {}) => {
  const rule = { id, title: id, check_method: "mixed", platforms: ["web"], ...extra };
  return { rule, rule_id: id, pack_id: "pack-x", file: "f.yaml", rule_sha256: canonicalRuleHash(rule) };
};

const HASH = "a".repeat(64);
const PROTO_HASHES = { "prototype/index.html": HASH };
const GOOD_RESULTS = {
  artifact_version: "2",
  page_hashes: { "prototype/index.html": HASH },
  reflow_ok: true, zoom_ok: true, focus_visible_ratio: 1,
  clipped_text: [], violations: [],
};

function build(overrides = {}) {
  return buildCoverageTemplate({
    applicable: [APP("wcag-1.4.10-reflow"), APP("zz-manual-rule"), APP("aa-manual-rule")],
    results: GOOD_RESULTS,
    snapshotPrototypeHashes: PROTO_HASHES,
    naMap: new Map(),
    snapshotVersion: "2",
    ...overrides,
  });
}

// —— 检查映射登记表 ——

test("检查映射登记表：3 条、rule_id 均可在依据库解析、无重复；wcag-2.1.1-keyboard 刻意不入表", () => {
  const r = validateCheckMapping(loadRules().byId);
  assert.deepEqual(r.errors, []);
  assert.equal(r.count, 3);
  assert.ok(!CHECK_MAPPING_BY_ID.has("wcag-2.1.1-keyboard"), "可达率≠完整可操作性，keyboard 须人工复核");
});

test("validateCheckMapping：指向不存在规则/重复映射 → 拒绝", () => {
  const byId = new Map([["wcag-1.4.10-reflow", {}], ["wcag-1.4.4-resize-text", {}]]); // 缺 focus-visible
  const r = validateCheckMapping(byId);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("wcag-2.4.7-focus-visible")));
});

test("decide 语义：reflow_ok=false → fail 且证据含实测来源；focus_visible_ratio<1 → fail", () => {
  const reflow = CHECK_MAPPING_BY_ID.get("wcag-1.4.10-reflow")
    .decide({ ...GOOD_RESULTS, reflow_ok: false, violations: [{ id: "reflow-320", page: "index" }] });
  assert.equal(reflow.result, "fail");
  const pass = CHECK_MAPPING_BY_ID.get("wcag-1.4.10-reflow").decide(GOOD_RESULTS);
  assert.equal(pass.result, "pass");
  assert.match(pass.evidence, /320px 实测无横向滚动/);
  assert.equal(CHECK_MAPPING_BY_ID.get("wcag-2.4.7-focus-visible").decide({ focus_visible_ratio: 0.8 }).result, "fail");
});

// —— 模板生成：三重前提 ——

test("三重前提齐备 → 映射内规则 prefilled_automated，其余 review_required；按 rule_id 稳定排序", () => {
  const { template, stats } = build();
  assert.deepEqual(template.map((t) => t.rule_id), ["aa-manual-rule", "wcag-1.4.10-reflow", "zz-manual-rule"]);
  const auto = template.find((t) => t.rule_id === "wcag-1.4.10-reflow");
  assert.equal(auto.state, "prefilled_automated");
  assert.equal(auto.result, "pass");
  assert.equal(auto.checked_via, "automated");
  assert.match(auto.evidence, /reflow_ok=true/);
  for (const id of ["aa-manual-rule", "zz-manual-rule"]) {
    const t = template.find((x) => x.rule_id === id);
    assert.equal(t.state, "review_required");
    assert.equal(t.result, null);
    assert.equal(t.checked_via, null);
    assert.equal(t.evidence, null);
  }
  assert.deepEqual(stats, { total_rules: 3, automated_prefilled: 1, review_required: 2, not_applicable_candidates: 0 });
});

test("前提 1 缺失（无映射）→ 不 prefill", () => {
  const { template } = build({ applicable: [APP("aa-manual-rule")] });
  assert.equal(template[0].state, "review_required");
});

test("前提 2 缺失（results 为空 / page_hashes 与快照原型哈希漂移）→ 不 prefill", () => {
  const noResults = build({ results: null });
  assert.equal(noResults.template.find((t) => t.rule_id === "wcag-1.4.10-reflow").state, "review_required");
  const drift = build({ results: { ...GOOD_RESULTS, page_hashes: { "prototype/index.html": "b".repeat(64) } } });
  assert.equal(drift.template.find((t) => t.rule_id === "wcag-1.4.10-reflow").state, "review_required");
  const missingKey = build({ results: { ...GOOD_RESULTS, page_hashes: {} } });
  assert.equal(missingKey.template.find((t) => t.rule_id === "wcag-1.4.10-reflow").state, "review_required");
});

test("前提 3 缺失（results.artifact_version 与快照版本不符）→ 不 prefill", () => {
  const { template } = build({ results: { ...GOOD_RESULTS, artifact_version: "1" } });
  assert.equal(template.find((t) => t.rule_id === "wcag-1.4.10-reflow").state, "review_required");
});

test("decide 判 fail 同样 prefill（fail 也是可信自动证据）", () => {
  const { template } = build({ results: { ...GOOD_RESULTS, reflow_ok: false, violations: [{ id: "reflow-320", page: "index" }] } });
  const auto = template.find((t) => t.rule_id === "wcag-1.4.10-reflow");
  assert.equal(auto.state, "prefilled_automated");
  assert.equal(auto.result, "fail");
});

test("naMap 命中的行填 not_applicable_candidate（仅提示，state 仍 review_required）", () => {
  const { template, stats } = build({ naMap: new Map([["aa-manual-rule", "原型无数据表元素"]]) });
  const t = template.find((x) => x.rule_id === "aa-manual-rule");
  assert.deepEqual(t.not_applicable_candidate, { value: true, reason: "原型无数据表元素" });
  assert.equal(t.state, "review_required");
  assert.equal(stats.not_applicable_candidates, 1);
});

// —— 受控合并（单向阀）——

const ROW = (rule_id, result = "pass", extra = {}) => ({
  rule_id, result, checked_via: "code",
  evidence: `已核查 ${rule_id}：index.html 实测合格（示例值 4.8:1）`, ...extra,
});

function tpl(overrides = {}) { return build(overrides).template; }
const MANUAL_ROWS = [ROW("aa-manual-rule"), ROW("zz-manual-rule")];

test("正向：review_required 行全部闭合、自动行不动 → 通过，coverage 形状与 findings schema 一致", () => {
  const r = mergeCoverage(tpl(), MANUAL_ROWS);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.coverage.length, 3);
  const auto = r.coverage.find((c) => c.rule_id === "wcag-1.4.10-reflow");
  assert.deepEqual(Object.keys(auto).sort(), ["checked_via", "evidence", "result", "rule_id"]);
  assert.equal(auto.result, "pass");
  assert.equal(auto.checked_via, "automated");
});

test("单向阀：prefilled pass→fail 升级允许（附 ≥10 字符证据）；证据过短拒绝", () => {
  const up = ROW("wcag-1.4.10-reflow", "fail", { checked_via: "screenshot", evidence: "375px 实机复测 index.html 出现 24px 横向滚动" });
  const ok = mergeCoverage(tpl(), [...MANUAL_ROWS, up]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.coverage.find((c) => c.rule_id === "wcag-1.4.10-reflow").result, "fail");
  const short = mergeCoverage(tpl(), [...MANUAL_ROWS, { ...up, evidence: "复测失败" }]);
  assert.ok(!short.ok && short.errors.some((e) => e.includes("≥10 字符")));
});

test("单向阀：自动 fail→pass 一律拒绝；prefilled 改 not_applicable/intent_only 拒绝", () => {
  const failTpl = tpl({ results: { ...GOOD_RESULTS, reflow_ok: false, violations: [{ id: "reflow-320", page: "index" }] } });
  const toPass = mergeCoverage(failTpl, [...MANUAL_ROWS, ROW("wcag-1.4.10-reflow", "pass")]);
  assert.ok(!toPass.ok && toPass.errors.some((e) => e.includes("fail→pass 拒绝") || e.includes("不得被 reviewer 覆盖")));
  const toNa = mergeCoverage(tpl(), [...MANUAL_ROWS, ROW("wcag-1.4.10-reflow", "not_applicable", { na_confirmed: true })]);
  assert.ok(!toNa.ok && toNa.errors.some((e) => e.includes("只允许 pass→fail 升级")));
});

test("增行/缺行/重复行/遗留 null → 全拒", () => {
  const extra = mergeCoverage(tpl(), [...MANUAL_ROWS, ROW("ghost-rule")]);
  assert.ok(!extra.ok && extra.errors.some((e) => e.includes("模板外规则") && e.includes("ghost-rule")));
  const missing = mergeCoverage(tpl(), [ROW("aa-manual-rule")]);
  assert.ok(!missing.ok && missing.errors.some((e) => e.includes("zz-manual-rule") && e.includes("缺行")));
  const dup = mergeCoverage(tpl(), [...MANUAL_ROWS, ROW("aa-manual-rule")]);
  assert.ok(!dup.ok && dup.errors.some((e) => e.includes("重复行")));
  const nul = mergeCoverage(tpl(), [ROW("aa-manual-rule"), { rule_id: "zz-manual-rule", result: null, checked_via: null, evidence: null }]);
  assert.ok(!nul.ok && nul.errors.some((e) => e.includes("zz-manual-rule") && e.includes("null")));
});

test("修改锁定字段（pack_id/rule_sha256）→ 拒绝", () => {
  const bad = mergeCoverage(tpl(), [ROW("aa-manual-rule", "pass", { pack_id: "other-pack" }), ROW("zz-manual-rule")]);
  assert.ok(!bad.ok && bad.errors.some((e) => e.includes("锁定字段 pack_id")));
  const badSha = mergeCoverage(tpl(), [ROW("aa-manual-rule", "pass", { rule_sha256: "f".repeat(64) }), ROW("zz-manual-rule")]);
  assert.ok(!badSha.ok && badSha.errors.some((e) => e.includes("锁定字段 rule_sha256")));
});

test("N/A 候选：未确认拒绝；na_confirmed+范围证据通过；非候选行人工判 N/A 允许（证据照常必填）", () => {
  const naTpl = () => tpl({ naMap: new Map([["aa-manual-rule", "原型无数据表元素"]]) });
  const unconfirmed = mergeCoverage(naTpl(), [ROW("aa-manual-rule", "not_applicable"), ROW("zz-manual-rule")]);
  assert.ok(!unconfirmed.ok && unconfirmed.errors.some((e) => e.includes("N/A 候选未确认")));
  const noScope = mergeCoverage(naTpl(), [ROW("aa-manual-rule", "not_applicable", { na_confirmed: true, evidence: "确实没有这种元素存在" }), ROW("zz-manual-rule")]);
  assert.ok(!noScope.ok && noScope.errors.some((e) => e.includes("范围确认")));
  const ok = mergeCoverage(naTpl(), [
    ROW("aa-manual-rule", "not_applicable", { na_confirmed: true, evidence: "已确认范围：原型 3 个页面均无数据表，本次交付不含表格场景" }),
    ROW("zz-manual-rule"),
  ]);
  assert.deepEqual(ok.errors, []);
  // 非候选行 reviewer 独立判 N/A：候选只是提示不是白名单。
  const independent = mergeCoverage(tpl(), [ROW("aa-manual-rule"), ROW("zz-manual-rule", "not_applicable", { evidence: "本次交付不含该规则针对的音频内容，共核查 3 页" })]);
  assert.deepEqual(independent.errors, []);
});

// —— 模板闭合校验（落盘后视角，record-findings/acceptance 门 d 共用）——

test("templateClosureIssues：闭合 coverage 通过；缺行/增行/遗留 null 被拒", () => {
  const template = tpl();
  const good = mergeCoverage(template, MANUAL_ROWS).coverage;
  assert.deepEqual(templateClosureIssues(good, template), []);
  assert.ok(templateClosureIssues(good.slice(1), template).some((s) => s.includes("缺行")));
  assert.ok(templateClosureIssues([...good, { rule_id: "ghost", result: "pass", checked_via: "code", evidence: "xxxxxxxxxxxx" }], template)
    .some((s) => s.includes("增行")));
  const withNull = good.map((c) => (c.rule_id === "aa-manual-rule" ? { ...c, result: null } : c));
  assert.ok(templateClosureIssues(withNull, template).some((s) => s.includes("null")));
});

test("templateClosureIssues：prefilled fail→pass 拒；pass→fail 须有对应 blocker/warning finding", () => {
  const failTpl = tpl({ results: { ...GOOD_RESULTS, reflow_ok: false, violations: [{ id: "reflow-320", page: "index" }] } });
  const covPass = [ROW("aa-manual-rule"), ROW("wcag-1.4.10-reflow", "pass"), ROW("zz-manual-rule")]
    .map(({ na_confirmed, ...c }) => c);
  assert.ok(templateClosureIssues(covPass, failTpl).some((s) => s.includes("单向阀违规")));

  const passTpl = tpl();
  const covUp = [ROW("aa-manual-rule"), ROW("wcag-1.4.10-reflow", "fail", { evidence: "实机复测 375px 出现横向滚动 24px" }), ROW("zz-manual-rule")];
  assert.ok(templateClosureIssues(covUp, passTpl, []).some((s) => s.includes("blocker/warning finding")));
  const finding = [{ rule_id: "wcag-1.4.10-reflow", severity: "blocker" }];
  assert.deepEqual(templateClosureIssues(covUp, passTpl, finding), []);
});

test("templateClosureIssues：N/A 候选行写 not_applicable 时证据须含范围确认", () => {
  const template = tpl({ naMap: new Map([["aa-manual-rule", "原型无数据表元素"]]) });
  const bad = [ROW("aa-manual-rule", "not_applicable", { evidence: "没有表格所以不适用啦" }), ROW("wcag-1.4.10-reflow", "pass"), ROW("zz-manual-rule")];
  assert.ok(templateClosureIssues(bad, template).some((s) => s.includes("范围确认")));
  const good = [ROW("aa-manual-rule", "not_applicable", { evidence: "已确认范围：原型全部页面无数据表场景" }), ROW("wcag-1.4.10-reflow", "pass"), ROW("zz-manual-rule")];
  assert.deepEqual(templateClosureIssues(good, template), []);
});
