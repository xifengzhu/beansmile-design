// results.json fail-closed 结构校验测试（规范 27.11）。核心对抗面：此前验收对缺失字段
// 静默放行，伪造 checks_version+同源哈希+键盘比例的最小文档可绕过大量浏览器证据。
import { test } from "node:test";
import assert from "node:assert/strict";
import { resultsIssues, MIN_CHECKS_VERSION } from "../lib/results-check.mjs";

const PAGES = ["about.html", "index.html"];
const HASHES = { "prototype/index.html": "h1", "prototype/about.html": "h2", "prototype/scenarios.json": "h3" };

function goodResults() {
  return {
    checks_version: MIN_CHECKS_VERSION,
    artifact_version: "1",
    page_hashes: { ...HASHES },
    pages: [...PAGES],
    keyboard_reachable_ratio: 1,
    focus_visible_ratio: 1,
    reflow_ok: true,
    zoom_ok: true,
    violations: [],
    console_errors: [],
    clipped_text: [],
    screenshots: ["a.desktop.png", "a.mobile.png", "b.desktop.png", "b.mobile.png"],
    cls: { "index.html": 0.01, "about.html": 0 },
    edge_insets: { "index.html": { viewport: 375, offenders: [] }, "about.html": { viewport: 375, offenders: [] } },
    task_flows: { total: 2, passed: 2, failures: [], definition_errors: [] },
  };
}
const CTX = {
  currentVersion: "1",
  activeHashes: { ...HASHES },
  prototypePages: [...PAGES],
  scenarios: [{ id: "ok" }, { id: "err" }],
  scenarioErrors: [],
};

test("正向：完整 v7 产物 + 全部信号干净 → 无问题", () => {
  assert.deepEqual(resultsIssues(goodResults(), CTX), []);
});

test("对抗：伪造最小文档（只有 checks_version+哈希+键盘比例）→ 逐项报缺，不再 fail-open", () => {
  const forged = { checks_version: MIN_CHECKS_VERSION, artifact_version: "1", page_hashes: { ...HASHES }, keyboard_reachable_ratio: 1 };
  const issues = resultsIssues(forged, CTX);
  for (const frag of ["缺 pages[]", "可见焦点 缺失", "320px 重排结果缺失", "200% 缩放重排结果缺失",
    "缺 violations[]", "缺 console_errors[]", "缺 clipped_text[]", "缺 screenshots[]",
    "缺 cls", "缺 edge_insets", "缺 task_flows"]) {
    assert.ok(issues.some((s) => s.includes(frag)), `应报: ${frag}\n实际: ${issues.join("\n")}`);
  }
});

test("对抗：task_flows 为 {} 或 0/0 → 拒绝（与 scenarios.json 现算数对账）", () => {
  const empty = { ...goodResults(), task_flows: {} };
  const ie = resultsIssues(empty, CTX);
  assert.ok(ie.some((s) => s.includes("total/passed 缺失或非整数")));
  assert.ok(ie.some((s) => s.includes("缺 definition_errors[]")));
  assert.ok(ie.some((s) => s.includes("缺 failures[]")));

  const zero = { ...goodResults(), task_flows: { total: 0, passed: 0, failures: [], definition_errors: [] } };
  assert.ok(resultsIssues(zero, CTX).some((s) => s.includes("≠ 当前 scenarios.json 场景数 2")));
});

test("对抗：执行失败 / 通过数不足 / 场景定义现算不合法 → 拒绝", () => {
  const failed = { ...goodResults(), task_flows: { total: 2, passed: 1, failures: [{ id: "ok", error: "断言超时" }], definition_errors: [] } };
  const issues = resultsIssues(failed, CTX);
  assert.ok(issues.some((s) => s.includes("核心任务执行失败 1/2")));
  assert.ok(issues.some((s) => s.includes("核心任务通过 1/2")));

  const badScen = resultsIssues(goodResults(), { ...CTX, scenarioErrors: ["flow 过短"] });
  assert.ok(badScen.some((s) => s.includes("scenarios.json 定义不合法")));
});

test("对抗：巡检漏页 / 记录幽灵页 / 截图数与页面数不对账 → 拒绝", () => {
  const skip = { ...goodResults(), pages: ["index.html"], screenshots: ["a", "b"] };
  const issues = resultsIssues(skip, CTX);
  assert.ok(issues.some((s) => s.includes("巡检未覆盖页面: about.html")));
  assert.ok(issues.some((s) => s.includes("≠ 页面数 2 × 2")));
  const ghost = { ...goodResults(), pages: [...PAGES, "ghost.html"] };
  assert.ok(resultsIssues(ghost, CTX).some((s) => s.includes("原型中不存在的页面: ghost.html")));
});

test("对抗：逐页 cls/edge_insets 记录被抽掉或有贴边 → 拒绝", () => {
  const noCls = { ...goodResults(), cls: { "index.html": 0.01 } };
  assert.ok(resultsIssues(noCls, CTX).some((s) => s.includes("cls 缺页面记录: about.html")));
  const offend = goodResults();
  offend.edge_insets["index.html"].offenders = [{ el: "p", leftInset: 4, rightInset: 4, text: "贴边" }];
  assert.ok(resultsIssues(offend, CTX).some((s) => s.includes("移动视口文本贴边 index.html")));
  const highCls = { ...goodResults(), cls: { "index.html": 0.25, "about.html": 0 } };
  assert.ok(resultsIssues(highCls, CTX).some((s) => s.includes("CLS=0.25")));
});

test("对抗：旧版 checks_version / 版本不符 / 不同源 / 信号脏 → 拒绝", () => {
  assert.ok(resultsIssues({ ...goodResults(), checks_version: MIN_CHECKS_VERSION - 1 }, CTX)[0].includes("旧版检查产物"));
  assert.ok(resultsIssues({ ...goodResults(), artifact_version: "2" }, CTX).some((s) => s.includes("artifact_version 缺失或不符")));
  const { artifact_version: _v, ...noVer } = goodResults();
  assert.ok(resultsIssues(noVer, CTX).some((s) => s.includes("artifact_version 缺失或不符")));
  const drifted = { ...goodResults(), page_hashes: { ...HASHES, "prototype/index.html": "tampered" } };
  assert.ok(resultsIssues(drifted, CTX).some((s) => s.includes("不同源")));
  const dirty = { ...goodResults(), violations: [{ impact: "serious" }], console_errors: ["x"], focus_visible_ratio: 0.9 };
  const issues = resultsIssues(dirty, CTX);
  assert.ok(issues.some((s) => s.includes("严重违规 1")));
  assert.ok(issues.some((s) => s.includes("控制台错误 1 条")));
  assert.ok(issues.some((s) => s.includes("可见焦点 90%")));
});
