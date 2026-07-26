// 核心任务场景定义校验测试：场景必须可执行、有断言、覆盖成功与错误双路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadScenarios } from "../lib/scenarios.mjs";

const GOOD = [
  { id: "subscribe-ok", name: "订阅成功路径", kind: "success", flow: "订阅产品更新", page: "index.html",
    steps: [
      { action: "fill", selector: "#email", value: "user@example.com" },
      { action: "click", selector: "button[type=submit]" },
      { action: "expect_visible", selector: "[role=status]" },
      { action: "expect_text", selector: "[role=status]", text: "订阅成功" },
    ] },
  { id: "subscribe-empty", name: "空邮箱报错", kind: "error", flow: "订阅产品更新", page: "index.html",
    steps: [
      { action: "click", selector: "button[type=submit]" },
      { action: "expect_visible", selector: "#email-error" },
    ] },
];

const FLOWS = "# 任务流\n\n## 核心任务：订阅产品更新\n\n填写邮箱 → 提交 → 看到成功确认。\n";

function makePkg(scenarios, { flows = FLOWS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bsd-scen-"));
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), "<html></html>");
  if (flows !== null) writeFileSync(join(dir, "flows.md"), flows); // 传 null 表示不写 flows.md
  if (scenarios !== undefined) {
    writeFileSync(join(dir, "prototype", "scenarios.json"),
      typeof scenarios === "string" ? scenarios : JSON.stringify(scenarios));
  }
  return dir;
}

test("成功+错误双路径、步骤完整、含断言 → 通过", () => {
  const dir = makePkg(GOOD);
  assert.deepEqual(loadScenarios(dir).errors, []);
  rmSync(dir, { recursive: true, force: true });
});

test("缺 scenarios.json / 非法 JSON / 空数组 → 拒绝", () => {
  const missing = makePkg();
  assert.ok(loadScenarios(missing).errors.some((s) => s.includes("缺 prototype/scenarios.json")));
  rmSync(missing, { recursive: true, force: true });
  const bad = makePkg("{not json");
  assert.ok(loadScenarios(bad).errors.some((s) => s.includes("非法 JSON")));
  rmSync(bad, { recursive: true, force: true });
  const empty = makePkg([]);
  assert.ok(loadScenarios(empty).errors.some((s) => s.includes("非空数组")));
  rmSync(empty, { recursive: true, force: true });
});

test("只有成功路径没有错误路径 → 拒绝（错误路径也要证明会报错）", () => {
  const dir = makePkg([GOOD[0]]);
  assert.ok(loadScenarios(dir).errors.some((s) => s.includes("缺 kind=error")));
  rmSync(dir, { recursive: true, force: true });
});

test("无 expect_* 断言步骤 → 拒绝（跑完不验证等于没跑）", () => {
  const noAssert = [{ ...GOOD[0], steps: GOOD[0].steps.slice(0, 2) }, GOOD[1]];
  const dir = makePkg(noAssert);
  assert.ok(loadScenarios(dir).errors.some((s) => s.includes("无任何 expect_*")));
  rmSync(dir, { recursive: true, force: true });
});

// —— 场景绑定与断言有效性（规范 24.3）——

test("断言目标为 body/html → 拒绝（页面存在不证明任务完成）", () => {
  const dir = makePkg([
    { ...GOOD[0], steps: [{ action: "click", selector: "button" }, { action: "expect_visible", selector: "body" }] },
    { ...GOOD[1], steps: [{ action: "click", selector: "button" }, { action: "expect_visible", selector: " HTML " }] },
  ]);
  const { errors } = loadScenarios(dir);
  assert.equal(errors.filter((s) => s.includes("只证明页面存在")).length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("对抗：flow 为 '#' 等碎片子串 → 拒绝（任何 Markdown 都含 #，不构成任务绑定，规范 27.11）", () => {
  const dir = makePkg([
    { ...GOOD[0], flow: "#" },
    { ...GOOD[1], flow: "。，！" }, // 无实义字符
  ]);
  const { errors } = loadScenarios(dir);
  assert.equal(errors.filter((s) => s.includes("过短或无实义字符")).length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("对抗：断言目标为裸标签/地标选择器（main/section）→ 拒绝（静态页恒真，规范 27.11）", () => {
  const dir = makePkg([
    { ...GOOD[0], steps: [{ action: "click", selector: "main" }, { action: "expect_visible", selector: "main" }] },
    { ...GOOD[1], steps: [{ action: "click", selector: "button" }, { action: "expect_text", selector: "section", text: "x" }] },
  ]);
  const { errors } = loadScenarios(dir);
  assert.equal(errors.filter((s) => s.includes("裸标签选择器")).length, 2);
  // 带 #id/.class/[attr] 的具体定位不受影响（GOOD 用例已在正向测试覆盖）
  rmSync(dir, { recursive: true, force: true });
});

test("零交互场景（纯 expect）→ 拒绝（加载检查不是任务场景）", () => {
  const dir = makePkg([
    { ...GOOD[0], steps: [{ action: "expect_visible", selector: "[role=status]" }] },
    GOOD[1],
  ]);
  assert.ok(loadScenarios(dir).errors.some((s) => s.includes("无任何交互步骤")));
  rmSync(dir, { recursive: true, force: true });
});

test("缺 flow / flow 未出现在 flows.md → 逐项拒绝（不许自造场景自证可用）", () => {
  const { flow: _f, ...noFlow } = GOOD[0];
  const dir = makePkg([noFlow, { ...GOOD[1], flow: "一个 flows.md 里不存在的任务" }]);
  const { errors } = loadScenarios(dir);
  assert.ok(errors.some((s) => s.includes("缺 flow")));
  assert.ok(errors.some((s) => s.includes("未出现在 flows.md 中")));
  rmSync(dir, { recursive: true, force: true });
});

test("缺 flows.md → 拒绝（场景必须绑定 IA 文档）", () => {
  const dir = makePkg(GOOD, { flows: null });
  assert.ok(loadScenarios(dir).errors.some((s) => s.includes("缺 flows.md")));
  rmSync(dir, { recursive: true, force: true });
});

test("page 不存在 / 未知 action / 缺必填字段 / id 重复 → 逐项拒绝", () => {
  const dir = makePkg([
    { ...GOOD[0], page: "nope.html" },
    { ...GOOD[1], id: "subscribe-empty", steps: [{ action: "hover", selector: "#x" }, { action: "fill", selector: "#y" }, { action: "expect_visible", selector: "#z" }] },
    { ...GOOD[1] },
  ]);
  const { errors } = loadScenarios(dir);
  assert.ok(errors.some((s) => s.includes("page 不存在")));
  assert.ok(errors.some((s) => s.includes("未知 action: hover")));
  assert.ok(errors.some((s) => s.includes("(fill) 缺 value")));
  assert.ok(errors.some((s) => s.includes("id 重复")));
  rmSync(dir, { recursive: true, force: true });
});
