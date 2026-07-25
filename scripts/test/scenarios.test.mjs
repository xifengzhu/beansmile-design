// 核心任务场景定义校验测试：场景必须可执行、有断言、覆盖成功与错误双路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadScenarios } from "../lib/scenarios.mjs";

const GOOD = [
  { id: "subscribe-ok", name: "订阅成功路径", kind: "success", page: "index.html",
    steps: [
      { action: "fill", selector: "#email", value: "user@example.com" },
      { action: "click", selector: "button[type=submit]" },
      { action: "expect_visible", selector: "[role=status]" },
      { action: "expect_text", selector: "[role=status]", text: "订阅成功" },
    ] },
  { id: "subscribe-empty", name: "空邮箱报错", kind: "error", page: "index.html",
    steps: [
      { action: "click", selector: "button[type=submit]" },
      { action: "expect_visible", selector: "#email-error" },
    ] },
];

function makePkg(scenarios) {
  const dir = mkdtempSync(join(tmpdir(), "bsd-scen-"));
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), "<html></html>");
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
