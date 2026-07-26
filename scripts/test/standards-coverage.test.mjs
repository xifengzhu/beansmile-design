// standards 覆盖矩阵语义测试："pass + 空 findings"不再构成合规证明。
// 适用集经共享函数 applicableRules（规则包激活 + 平台交集）计算后传入——测试构造合成
// packs 注册表对象走同一条激活路径，不绕过共享实现（分层扩展 §6）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { semanticIssuesStandards } from "../lib/findings.mjs";
import { applicableRules } from "../lib/rule-packs.mjs";

const RULES = [
  { id: "wcag-1.4.3-contrast-minimum", platforms: ["web", "mobile_web"], _file: "wcag-2.2-aa.yaml" },
  { id: "web-form-label-association", platforms: ["web", "mobile_web"], _file: "web-core.yaml" },
  { id: "craft-spacing-rhythm", platforms: ["web", "mobile_web", "ios", "android", "mini_program"], _file: "design-craft.yaml" },
  { id: "hig-navigation-patterns", platforms: ["ios"], _file: "ios-hig.yaml" },
  { id: "ecom-guest-checkout-option", platforms: ["web", "mobile_web"], _file: "industry-ecommerce.yaml" },
  { id: "saas-destructive-confirm", platforms: ["web", "mobile_web"], _file: "industry-saas-b2b.yaml" },
];

const PACKS = [
  { id: "foundation-wcag", kind: "foundation", files: ["wcag-2.2-aa.yaml"], activation: { type: "always" } },
  { id: "platform-web", kind: "platform", files: ["web-core.yaml"], activation: { type: "always" } },
  { id: "platform-ios", kind: "platform", files: ["ios-hig.yaml"], activation: { type: "always" } },
  { id: "craft-design", kind: "craft", files: ["design-craft.yaml"], activation: { type: "always" } },
  { id: "industry-ecommerce", kind: "industry", files: ["industry-ecommerce.yaml"], activation: { type: "industry", values: ["ecommerce"] } },
  { id: "industry-saas-b2b", kind: "industry", files: ["industry-saas-b2b.yaml"], activation: { type: "industry", values: ["saas_b2b"] } },
];

// 经共享激活函数计算适用集（规则卡投影）。
const applicable = (platforms, industry) =>
  applicableRules({ platforms, industry, reference_system: "none" }, RULES, PACKS).map((a) => a.rule);

const cover = (rule_id, result = "pass", extra = {}) => ({
  rule_id, result, checked_via: "code",
  evidence: `已核查 ${rule_id}：index.html 全部命中，实测值合格（示例 4.8:1）`, ...extra,
});

function doc(coverage, findings = []) {
  return { reviewer: "standards", artifact_version: "1", verdict: "pass", findings, rule_coverage: coverage };
}

test("目标平台全部适用规则逐条覆盖 → 通过；平台外规则不要求", () => {
  const d = doc([cover("wcag-1.4.3-contrast-minimum"), cover("web-form-label-association"), cover("craft-spacing-rhythm")]);
  assert.deepEqual(semanticIssuesStandards(d, applicable(["web"])), []);
});

test("空 findings + 空/缺覆盖 → 报覆盖缺口（形式化 pass 被拒）", () => {
  const issues = semanticIssuesStandards(doc([cover("craft-spacing-rhythm")]), applicable(["web"]));
  assert.ok(issues.some((s) => s.includes("覆盖缺口") && s.includes("缺 2 条")));
});

test("iOS 项目要求 hig 规则；覆盖引用适用集外规则/重复条目 → 拒绝", () => {
  const missing = semanticIssuesStandards(doc([cover("craft-spacing-rhythm")]), applicable(["ios"]));
  assert.ok(missing.some((s) => s.includes("hig-navigation-patterns")));
  const dup = doc([cover("craft-spacing-rhythm"), cover("craft-spacing-rhythm"), cover("no-such-rule")]);
  const issues = semanticIssuesStandards(dup, applicable(["web"]));
  assert.ok(issues.some((s) => s.includes("重复条目")));
  assert.ok(issues.some((s) => s.includes("适用规则集外的规则: no-such-rule")));
});

test("Web 规则用 intent_only → 拒绝；原生规则 intent_only 合法", () => {
  const full = [cover("wcag-1.4.3-contrast-minimum", "intent_only"), cover("web-form-label-association"),
    cover("craft-spacing-rhythm"), cover("hig-navigation-patterns", "intent_only")];
  const issues = semanticIssuesStandards(doc(full), applicable(["web", "ios"]));
  assert.ok(issues.some((s) => s.includes("wcag-1.4.3-contrast-minimum") && s.includes("intent_only")));
  assert.ok(!issues.some((s) => s.includes("hig-navigation-patterns")));
});

test("覆盖证据过短 → 拒绝", () => {
  const d = doc([cover("craft-spacing-rhythm", "pass", { evidence: "符合" }), cover("wcag-1.4.3-contrast-minimum"), cover("web-form-label-association")]);
  assert.ok(semanticIssuesStandards(d, applicable(["web"])).some((s) => s.includes("证据过短")));
});

test("result=fail 无对应 finding → 拒绝；有对应 blocker/warning → 通过", () => {
  const base = [cover("wcag-1.4.3-contrast-minimum"), cover("web-form-label-association")];
  const noLink = doc([...base, cover("craft-spacing-rhythm", "fail")]);
  assert.ok(semanticIssuesStandards(noLink, applicable(["web"])).some((s) => s.includes("无对应 blocker/warning")));
  const linked = {
    ...doc([...base, cover("craft-spacing-rhythm", "fail")]),
    verdict: "fail",
    findings: [{ id: "s-1", severity: "blocker", location: "index.html .hero", rule_id: "craft-spacing-rhythm",
      evidence: "区块间距 16px < 内部间距 24px", user_impact: "边界糊", recommendation: "拉开到 48px" }],
  };
  assert.deepEqual(semanticIssuesStandards(linked, applicable(["web"])), []);
});

test("行业规则只在 industry 匹配时进入适用集（激活以注册表原始 slug 为准，含 saas_b2b）", () => {
  const base = [cover("wcag-1.4.3-contrast-minimum"), cover("web-form-label-association"), cover("craft-spacing-rhythm")];
  // 无 industry：行业规则不追着所有 Web 项目跑
  assert.deepEqual(semanticIssuesStandards(doc(base), applicable(["web"])), []);
  // industry=ecommerce：电商包进入适用集，未覆盖即缺口；saas 包仍不适用
  const issues = semanticIssuesStandards(doc(base), applicable(["web"], "ecommerce"));
  assert.ok(issues.some((s) => s.includes("ecom-guest-checkout-option")));
  assert.ok(!issues.some((s) => s.includes("saas-destructive-confirm")));
  // slug 原样精确匹配：saas_b2b 激活 industry-saas-b2b 包
  const saas = semanticIssuesStandards(doc(base), applicable(["web"], "saas_b2b"));
  assert.ok(saas.some((s) => s.includes("saas-destructive-confirm")));
  assert.deepEqual(semanticIssuesStandards(doc([...base, cover("saas-destructive-confirm")]), applicable(["web"], "saas_b2b")), []);
});

test("blocker finding 的规则在矩阵里写 pass → 自相矛盾被拒", () => {
  const full = [cover("wcag-1.4.3-contrast-minimum"), cover("web-form-label-association"), cover("craft-spacing-rhythm", "pass")];
  const d = doc(full,
    [{ id: "s-1", severity: "warning", location: "x", rule_id: "craft-spacing-rhythm",
      evidence: "间距 12/16/20 混用 3 处", user_impact: "y", recommendation: "z" }]);
  assert.ok(semanticIssuesStandards(d, applicable(["web"])).some((s) => s.includes("自相矛盾")));
});
