// 中间版本增量评审测试（规范 27.5）。/tmp 夹具造两个冻结快照 + findings 链。
// 对抗面：遗漏 baseline blocker、核销幽灵问题、delta 改名冒充全量（schema 拒）、
// delta/ 篡改再生比对、text-diff 确定性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { diffLines } from "../lib/text-diff.mjs";
import {
  validateDeltaDoc, loadReviewerFindings, semanticIssuesDelta, buildDeltaBundle, deltaIssues,
} from "../lib/delta-review.mjs";
import { validateFindingsDoc } from "../lib/findings.mjs";
import { sha256File } from "../lib/hash.mjs";

// —— text-diff ——

test("diffLines：确定性、只列增删行、空 diff 返回空串", () => {
  const a = "line1\nline2\nline3";
  const b = "line1\nline2-changed\nline3\nline4";
  const d1 = diffLines(a, b, "x.html");
  const d2 = diffLines(a, b, "x.html");
  assert.equal(d1, d2);
  assert.ok(d1.includes("-2: line2") && d1.includes("+2: line2-changed") && d1.includes("+4: line4"));
  assert.ok(!d1.includes("line1"), "未变行不出现");
  assert.equal(diffLines(a, a, "x.html"), "");
});

// —— 夹具 ——

const FINDING = (id, severity = "warning", extra = {}) => ({
  id, severity, location: "prototype/index.html .hero", rule_id: null,
  evidence: `实测行高 1.2，低于要求的 1.5`, user_impact: "长读吃力", recommendation: "行高改 1.6", ...extra,
});

// 造包：v1 全量 findings（standards+visual）+ v1/v2 冻结快照（prototype 有 1 文件差异）
// + v2 的 delta/changed-files.json（delta findings 的绑定包，复审修正后为硬性要求）。
function makePkg({ openBlockerId = "s-1", tokensChange = false, extraPage = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "delta-rev-"));
  for (const [v, body] of [["1", "<h1>v1</h1>"], ["2", "<h1>v2 改了标题</h1>"]]) {
    const snap = join(root, "audit", "snapshots", v);
    mkdirSync(join(snap, "prototype"), { recursive: true });
    writeFileSync(join(snap, "prototype", "index.html"), `<!doctype html><html><body>${body}</body></html>`);
    if (extraPage) writeFileSync(join(snap, "prototype", "about.html"), `<!doctype html><html><body>about 不变</body></html>`);
    writeFileSync(join(snap, "design-tokens.json"), tokensChange && v === "2" ? `{"v":2}` : `{"v":1}`);
  }
  const deltaDir = join(root, "audit", "snapshots", "2", "delta");
  mkdirSync(deltaDir, { recursive: true });
  writeFileSync(join(deltaDir, "changed-files.json"), JSON.stringify({ baseline_version: "1", artifact_version: "2" }, null, 2));
  mkdirSync(join(root, "audit", "findings"), { recursive: true });
  const standards = {
    reviewer: "standards", artifact_version: "1", verdict: "fail",
    findings: [FINDING(openBlockerId, "blocker", { rule_id: "r-a" }), FINDING("s-2", "note")],
    rule_coverage: [{ rule_id: "r-a", result: "fail", checked_via: "code", evidence: "index.html 缺 label，实测 0 个关联" }],
  };
  writeFileSync(join(root, "audit", "findings", "standards-1.yaml"), yaml.dump(standards));
  const DIMS = ["hierarchy", "rhythm", "typography", "color", "consistency", "content", "brand", "completion"];
  const visual = {
    reviewer: "visual", artifact_version: "1", verdict: "pass",
    findings: [FINDING("v-1", "warning", { dimension: "typography" })],
    // schema 合法即可（语义校验不在本测试范围），供 delta 汇取遗留 findings
    dimension_reviews: DIMS.map((d, i) => ({
      dimension: d, screenshot: `audit/screenshots/p${i}.png`, screenshot_sha256: "a".repeat(64),
      region: `区块 ${i} x≈0,y≈${i * 100}`, observed: `第 ${i} 维实测：字号 16px、行高 1.5、对比 4.6:1`, judgment: "pass",
    })),
  };
  writeFileSync(join(root, "audit", "findings", "visual-1.yaml"), yaml.dump(visual));
  return root;
}

const FROZEN_STUB = { manifest: { rules: [{ rule_id: "r-a" }] }, cards: [{ id: "r-a", platforms: ["web"] }] };

const DELTA_DOC = (extra = {}) => ({
  reviewer: "standards", artifact_version: "2", baseline_version: "1", verdict: "pass",
  findings: [],
  resolved_findings: [{ id: "s-1", evidence: "files.diff 确认 label 已补，实测 3 个 for/id 关联" }],
  rule_coverage_delta: [{ rule_id: "r-a", result: "pass", checked_via: "code", evidence: "变更后 index.html 全部 3 个控件有 label" }],
  ...extra,
});

// —— schema 与冒充防线 ——

test("正向：合法 delta 文档过 schema；同文档改名冒充全量 → 全量 schema 拒（baseline_version 非法字段）", () => {
  const doc = DELTA_DOC();
  assert.ok(validateDeltaDoc(doc).ok);
  const asFull = validateFindingsDoc(doc);
  assert.ok(!asFull.ok && asFull.errors.some((e) => e.includes("additional properties")), asFull.errors.join("; "));
});

test("loadReviewerFindings：全量优先；delta 文件不被全量语义拾取", () => {
  const root = makePkg();
  writeFileSync(join(root, "audit", "findings", "standards-2-delta.yaml"), yaml.dump(DELTA_DOC()));
  const r1 = loadReviewerFindings(root, "standards", "1");
  assert.equal(r1.kind, "full");
  const r2 = loadReviewerFindings(root, "standards", "2");
  assert.equal(r2.kind, "delta");
  rmSync(root, { recursive: true, force: true });
});

test("对抗：文件名版本与文档内 artifact_version 不符 → 拒载（standards-2.yaml 内写 999）", () => {
  const root = makePkg();
  const wrong = {
    reviewer: "standards", artifact_version: "999", verdict: "pass", findings: [],
    rule_coverage: [{ rule_id: "r-a", result: "pass", checked_via: "code", evidence: "错版评审蒙混进 v2 的探针" }],
  };
  writeFileSync(join(root, "audit", "findings", "standards-2.yaml"), yaml.dump(wrong));
  assert.equal(loadReviewerFindings(root, "standards", "2"), null);
  const wrongDelta = DELTA_DOC({ artifact_version: "999" });
  writeFileSync(join(root, "audit", "findings", "visual-2-delta.yaml"), yaml.dump({ ...wrongDelta, reviewer: "visual" }));
  assert.equal(loadReviewerFindings(root, "visual", "2"), null);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：delta findings 无绑定 delta 包 / baseline 与包不一致 → 拒收", () => {
  const noBundle = makePkg();
  rmSync(join(noBundle, "audit", "snapshots", "2", "delta"), { recursive: true, force: true });
  const baseline = loadReviewerFindings(noBundle, "standards", "1");
  assert.ok(semanticIssuesDelta(DELTA_DOC(), baseline, FROZEN_STUB, noBundle).some((s) => s.includes("无 delta/changed-files.json")));
  rmSync(noBundle, { recursive: true, force: true });

  const mismatch = makePkg();
  writeFileSync(join(mismatch, "audit", "snapshots", "2", "delta", "changed-files.json"),
    JSON.stringify({ baseline_version: "0", artifact_version: "2" }));
  const b2 = loadReviewerFindings(mismatch, "standards", "1");
  assert.ok(semanticIssuesDelta(DELTA_DOC(), b2, FROZEN_STUB, mismatch).some((s) => s.includes("脱钩")));
  rmSync(mismatch, { recursive: true, force: true });
});

test("对抗：仅共享令牌/资产变化 → changed-pages 展开为全部页面（视觉 delta 不得漏看）", () => {
  const root = makePkg({ tokensChange: true, extraPage: true });
  const b = buildDeltaBundle({ pkgRoot: root, baselineVersion: "1", version: "2" });
  const cp = JSON.parse(b["changed-pages.json"]);
  assert.equal(cp.expanded_all, true);
  assert.deepEqual(cp.pages.sort(), ["about.html", "index.html"]); // 未变的 about 也被展开进来
  assert.ok(cp.reason.includes("design-tokens.json"));
  rmSync(root, { recursive: true, force: true });
});

// —— 闭合性 ——

test("正向：baseline 全部 open 问题被核销/再断言 → 语义通过", () => {
  const root = makePkg();
  const baseline = loadReviewerFindings(root, "standards", "1");
  assert.deepEqual(semanticIssuesDelta(DELTA_DOC(), baseline, FROZEN_STUB, root), []);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：遗漏 baseline blocker（既不核销也不再断言）→ 拒收", () => {
  const root = makePkg();
  const baseline = loadReviewerFindings(root, "standards", "1");
  const doc = DELTA_DOC({ resolved_findings: [], rule_coverage_delta: [] });
  const issues = semanticIssuesDelta(doc, baseline, FROZEN_STUB, root);
  assert.ok(issues.some((s) => s.includes("s-1") && s.includes("静默丢问题")), issues.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：核销 baseline 不存在的问题 / 同一问题既核销又再断言 → 拒收", () => {
  const root = makePkg();
  const baseline = loadReviewerFindings(root, "standards", "1");
  const ghost = DELTA_DOC({ resolved_findings: [{ id: "s-1", evidence: "已修复，实测 3 个关联" }, { id: "phantom", evidence: "查无此问题但我核销了" }] });
  assert.ok(semanticIssuesDelta(ghost, baseline, FROZEN_STUB, root).some((s) => s.includes("phantom")));
  const both = DELTA_DOC({ verdict: "fail", findings: [FINDING("s-1", "blocker", { rule_id: "r-a" })] });
  assert.ok(semanticIssuesDelta(both, baseline, FROZEN_STUB, root).some((s) => s.includes("自相矛盾")));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：baseline 断链（该版本无 findings）/ baseline_version 不小于当前 → 拒收", () => {
  const root = makePkg();
  const none = semanticIssuesDelta(DELTA_DOC({ baseline_version: "9" }), loadReviewerFindings(root, "standards", "9"), FROZEN_STUB, root);
  assert.ok(none.some((s) => s.includes("增量链断裂")));
  const baseline = loadReviewerFindings(root, "standards", "1");
  const inverted = semanticIssuesDelta(DELTA_DOC({ baseline_version: "2" }), baseline, FROZEN_STUB, root);
  assert.ok(inverted.some((s) => s.includes("不小于")));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：coverage_delta fail 无对应 finding / 引用冻结集外规则 → 拒收", () => {
  const root = makePkg();
  const baseline = loadReviewerFindings(root, "standards", "1");
  const failNoFinding = DELTA_DOC({
    findings: [FINDING("s-1", "warning", { rule_id: "r-a" })], resolved_findings: [],
    rule_coverage_delta: [{ rule_id: "r-a", result: "fail", checked_via: "code", evidence: "仍缺 2 个 label 关联" }],
  });
  // s-1 再断言为 warning，r-a fail 有对应 warning finding → 应通过；换成无关联则拒
  assert.deepEqual(semanticIssuesDelta(failNoFinding, baseline, FROZEN_STUB, root), []);
  const orphanFail = DELTA_DOC({
    resolved_findings: [{ id: "s-1", evidence: "已修复，实测 3 个关联" }],
    rule_coverage_delta: [{ rule_id: "r-a", result: "fail", checked_via: "code", evidence: "仍缺 2 个 label 关联" }],
  });
  assert.ok(semanticIssuesDelta(orphanFail, baseline, FROZEN_STUB, root).some((s) => s.includes("无对应 blocker/warning")));
  const outsideRule = DELTA_DOC({ rule_coverage_delta: [{ rule_id: "r-nowhere", result: "pass", checked_via: "code", evidence: "凭空引用一条规则来核查" }] });
  assert.ok(semanticIssuesDelta(outsideRule, baseline, FROZEN_STUB, root).some((s) => s.includes("r-nowhere")));
  rmSync(root, { recursive: true, force: true });
});

// —— delta 包生成与再生比对 ——

test("正向：buildDeltaBundle 确定性；deltaIssues 对完好 delta/ 通过", () => {
  const root = makePkg();
  const b1 = buildDeltaBundle({ pkgRoot: root, baselineVersion: "1", version: "2" });
  const b2 = buildDeltaBundle({ pkgRoot: root, baselineVersion: "1", version: "2" });
  assert.deepEqual(b1, b2);
  const cf = JSON.parse(b1["changed-files.json"]);
  assert.deepEqual(cf.changed, ["prototype/index.html"]);
  assert.ok(b1["files.diff"].includes("prototype/index.html"));
  const open = yaml.load(b1["open-findings.yaml"]);
  assert.deepEqual(open.findings.map((f) => f.id).sort(), ["s-1", "v-1"]); // note 不进遗留清单
  assert.deepEqual(open.coverage_fail_rule_ids, ["r-a"]);
  assert.deepEqual(JSON.parse(b1["changed-pages.json"]).pages, ["index.html"]);

  const deltaDir = join(root, "audit", "snapshots", "2", "delta");
  mkdirSync(deltaDir, { recursive: true });
  for (const [name, text] of Object.entries(b1)) writeFileSync(join(deltaDir, name), text);
  assert.deepEqual(deltaIssues(root, "1", "2"), []);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：篡改 delta/files.diff（隐瞒变更）→ 再生比对拒绝；缺文件 → 报", () => {
  const root = makePkg();
  const bundle = buildDeltaBundle({ pkgRoot: root, baselineVersion: "1", version: "2" });
  const deltaDir = join(root, "audit", "snapshots", "2", "delta");
  mkdirSync(deltaDir, { recursive: true });
  for (const [name, text] of Object.entries(bundle)) writeFileSync(join(deltaDir, name), text);
  writeFileSync(join(deltaDir, "files.diff"), "# 这轮啥也没改\n");
  assert.ok(deltaIssues(root, "1", "2").some((s) => s.includes("files.diff") && s.includes("不符")));
  rmSync(join(deltaDir, "open-findings.yaml"));
  assert.ok(deltaIssues(root, "1", "2").some((s) => s.includes("缺 open-findings.yaml")));
  rmSync(root, { recursive: true, force: true });
});

test("visual delta：截图哈希纪律与全量同源（不存在/哈希不符 → 拒）", () => {
  const root = makePkg();
  mkdirSync(join(root, "audit", "screenshots"), { recursive: true });
  writeFileSync(join(root, "audit", "screenshots", "index.png"), "PNG-BYTES");
  const baseline = loadReviewerFindings(root, "visual", "1");
  const mk = (screenshot, sha) => ({
    reviewer: "visual", artifact_version: "2", baseline_version: "1", verdict: "pass",
    findings: [], resolved_findings: [{ id: "v-1", evidence: "变更截图确认行高已到 1.6" }],
    dimension_reviews_delta: [{ dimension: "typography", screenshot, screenshot_sha256: sha, region: "hero x≈0,y≈0", observed: "行高实测 1.6，字号 18px，两行间距 29px", judgment: "pass" }],
  });
  const good = mk("audit/screenshots/index.png", sha256File(join(root, "audit", "screenshots", "index.png")));
  assert.deepEqual(semanticIssuesDelta(good, baseline, FROZEN_STUB, root), []);
  const badHash = mk("audit/screenshots/index.png", "0".repeat(64));
  assert.ok(semanticIssuesDelta(badHash, baseline, FROZEN_STUB, root).some((s) => s.includes("哈希不匹配")));
  const missing = mk("audit/screenshots/nope.png", "0".repeat(64));
  assert.ok(semanticIssuesDelta(missing, baseline, FROZEN_STUB, root).some((s) => s.includes("不存在")));
  rmSync(root, { recursive: true, force: true });
});
