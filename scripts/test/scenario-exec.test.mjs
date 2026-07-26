// 核心任务场景执行门的浏览器级回归（规范 27.11）：
// ① 场景执行 context 与静态巡检同等捕获 pageerror/console/资源失败——交互期抛异常
//    不得再报"控制台错误 0、核心任务全过"；
// ② 全部断言在初始状态即成立的场景判废——"click 任意元素 + expect 静态恒真元素"
//    不构成任务完成证明；
// ③ 干净交互包的 browser-check 真产物必须通过 results-check 的 fail-closed 校验
//    （奇偶校验：门收紧不得误伤真实产物）。
// 依赖真实浏览器：不可用时显式 skip（诚实降级，不假通过）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { probeBrowser } from "../lib/browser.mjs";
import { resultsIssues } from "../lib/results-check.mjs";
import { loadScenarios } from "../lib/scenarios.mjs";
import { collectPrototypePages } from "../lib/pages.mjs";
import { hashPaths } from "../lib/hash.mjs";

const CLI = resolve(import.meta.dirname, "..", "browser-check.mjs");
const probe = await probeBrowser();

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>订阅演示</title>
<style>body{margin:0;padding:32px;font-family:sans-serif;color:#111;background:#fff}
input,button{font-size:16px;padding:10px 16px}
input:focus,button:focus{outline:3px solid #0044cc}</style></head>
<body><main>
<h1>订阅产品更新</h1>
<div class="hero">英雄区静态内容（恒可见）</div>
<form id="f"><label for="email">邮箱</label> <input id="email" type="text">
<button id="submit" type="submit">提交</button></form>
<p id="ok" role="status" hidden>订阅成功</p>
<p id="err" role="alert" hidden>请输入邮箱</p>
<button id="boom" type="button">爆炸</button>
<p id="boomdone" hidden>爆炸完成</p>
<script>
document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = document.getElementById("email").value.trim();
  document.getElementById("ok").hidden = !v;
  document.getElementById("err").hidden = !!v;
});
document.getElementById("boom").addEventListener("click", () => {
  document.getElementById("boomdone").hidden = false;
  throw new Error("boom 交互崩溃");
});
</script></main></body></html>`;

const FLOWS = "# 任务流\n\n## 核心任务：订阅产品更新\n\n填写邮箱 → 提交 → 成功确认；空邮箱 → 报错。\n\n## 核心任务：触发爆炸\n";

const OK = { id: "subscribe-ok", name: "订阅成功", kind: "success", flow: "订阅产品更新", page: "index.html",
  steps: [
    { action: "fill", selector: "#email", value: "user@example.com" },
    { action: "click", selector: "#submit" },
    { action: "expect_visible", selector: "#ok" },
    { action: "expect_text", selector: "#ok", text: "订阅成功" },
  ] };
const ERR = { id: "subscribe-empty", name: "空邮箱报错", kind: "error", flow: "订阅产品更新", page: "index.html",
  steps: [{ action: "click", selector: "#submit" }, { action: "expect_visible", selector: "#err" }] };

function makePkg(scenarios) {
  const dir = mkdtempSync(join(tmpdir(), "scen-exec-"));
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), PAGE);
  writeFileSync(join(dir, "flows.md"), FLOWS);
  writeFileSync(join(dir, "prototype", "scenarios.json"), JSON.stringify(scenarios, null, 2));
  return dir;
}

function runCheck(dir) {
  const r = spawnSync("node", [CLI, "--package", dir, "--version", "1"], { encoding: "utf8" });
  const results = JSON.parse(readFileSync(join(dir, "audit", "results.json"), "utf8"));
  return { status: r.status, stderr: r.stderr, results };
}

test("正向：真实交互场景通过，且 browser-check 真产物恒过 fail-closed 结构校验", async (t) => {
  if (!probe.available) return t.skip(`浏览器不可用（${probe.error}）——本机应修复环境而非依赖降级`);
  const dir = makePkg([OK, ERR]);
  const { status, stderr, results } = runCheck(dir);
  assert.equal(status, 0, `干净包应无阻断信号: ${stderr}`);
  assert.equal(results.checks_version, 7);
  assert.equal(results.task_flows.passed, 2);
  // 奇偶校验：真产物必须过 resultsIssues——fail-closed 门不得误伤 browser-check 自身输出
  const { scenarios, errors: scenarioErrors } = loadScenarios(dir);
  const issues = resultsIssues(results, {
    currentVersion: "1",
    activeHashes: hashPaths(dir, ["prototype"]),
    prototypePages: collectPrototypePages(dir).map((p) => p.name),
    scenarios, scenarioErrors,
  });
  assert.deepEqual(issues, []);
  rmSync(dir, { recursive: true, force: true });
});

test("对抗：空断言场景判废 + 交互期 JS 异常被捕获（不再假通过）", async (t) => {
  if (!probe.available) return t.skip(`浏览器不可用（${probe.error}）——本机应修复环境而非依赖降级`);
  const VACUOUS = { id: "vacuous", name: "静态恒真", kind: "success", flow: "订阅产品更新", page: "index.html",
    steps: [{ action: "click", selector: ".hero" }, { action: "expect_visible", selector: ".hero" }] };
  const BOOM = { id: "boom", name: "交互崩溃", kind: "success", flow: "触发爆炸", page: "index.html",
    steps: [{ action: "click", selector: "#boom" }, { action: "expect_visible", selector: "#boomdone" }] };
  const dir = makePkg([VACUOUS, BOOM, ERR]);
  const { status, results } = runCheck(dir);
  assert.equal(status, 1, "对抗包必须携带阻断信号");
  assert.equal(results.task_flows.total, 3);
  assert.equal(results.task_flows.passed, 1, "只有真实错误路径场景应通过");
  const errOf = (id) => results.task_flows.failures.find((f) => f.id === id)?.error ?? "";
  assert.ok(errOf("vacuous").includes("初始状态即成立"), `vacuous 应判废: ${errOf("vacuous")}`);
  assert.ok(errOf("boom").includes("执行期 JS"), `boom 应因执行期错误失败: ${errOf("boom")}`);
  assert.ok(results.console_errors.some((s) => s.includes("场景 boom")), "场景执行期错误须进 console_errors");
  rmSync(dir, { recursive: true, force: true });
});
