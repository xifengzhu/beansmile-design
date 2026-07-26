// 快速模式自动分类测试（规范 27.8）。分类只产生建议；确认门（--confirm mode）
// 由 director-advance 落盘，schema 层 confirmations.mode 生效。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { suggestMode } from "../lib/mode-classifier.mjs";
import { validateContext } from "../lib/context.mjs";

const BASE = { platforms: ["web"], task_type: "web_page", estimated_pages: 1, estimated_flows: 2, brand_exploration: false, industry: "general" };

test("正向：单页/单平台/流程≤2/无品牌探索 → 建议 quick 且理由非空", () => {
  const r = suggestMode(BASE);
  assert.equal(r.mode, "quick");
  assert.ok(r.reasons.length >= 4);
});

test("超界任一项 → professional：多页/多流程/多平台/品牌探索/非 general 行业", () => {
  assert.equal(suggestMode({ ...BASE, estimated_pages: 3 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_flows: 3 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, platforms: ["web", "mobile_web"] }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, brand_exploration: true }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, industry: "ecommerce" }).mode, "professional");
});

test("对抗：任一输入缺失 → 保守 professional（不猜），理由说明缺什么", () => {
  for (const key of ["platforms", "estimated_pages", "estimated_flows", "brand_exploration"]) {
    const input = { ...BASE };
    delete input[key];
    const r = suggestMode(input);
    assert.equal(r.mode, "professional", `${key} 缺失应回退专业模式`);
    assert.ok(r.reasons[0].includes("专业模式"));
  }
  assert.equal(suggestMode({}).mode, "professional");
});

test("对抗：非法数量（负数/零页/NaN/Infinity/小数）→ professional，不得建议 quick", () => {
  assert.equal(suggestMode({ ...BASE, estimated_pages: -1, estimated_flows: -2 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_pages: 0 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_pages: 0.5 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_flows: NaN }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_flows: Infinity }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_flows: 1.5 }).mode, "professional");
  assert.equal(suggestMode({ ...BASE, estimated_flows: 0 }).mode, "quick"); // 0 条流程合法（纯展示页）
});

// —— 确认门集成（director-advance --confirm mode + schema）——

const CTX = {
  project: { name: "落地页", mode: "quick", task_type: "new_design", platforms: ["web"], reference_system: "none", industry: "general" },
  users: { primary: "访客" }, goals: { business: ["转化"] }, stage: "intake",
};

test("schema：confirmations.mode 合法；缺 user_reply 非法", () => {
  assert.ok(validateContext({ ...CTX, confirmations: { mode: { summary: "建议快速模式：单页", user_reply: "同意快速" } } }).ok);
  assert.ok(!validateContext({ ...CTX, confirmations: { mode: { summary: "只有摘要没有用户答复" } } }).ok);
});

test("CLI：--confirm mode 落盘 confirmations.mode；缺 --reply 退出 2；未知门退出 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "mode-gate-"));
  writeFileSync(join(dir, "context.yaml"), yaml.dump(CTX));
  const cli = resolve(import.meta.dirname, "..", "director-advance.mjs");
  const ok = spawnSync("node", [cli, "--package", dir, "--confirm", "mode", "--summary", "建议快速模式：单页单平台", "--reply", "同意，用快速模式"]);
  assert.equal(ok.status, 0, String(ok.stderr));
  const ctx = yaml.load(readFileSync(join(dir, "context.yaml"), "utf8"));
  assert.equal(ctx.confirmations.mode.user_reply, "同意，用快速模式");

  const noReply = spawnSync("node", [cli, "--package", dir, "--confirm", "mode", "--summary", "x"]);
  assert.equal(noReply.status, 2);
  const unknown = spawnSync("node", [cli, "--package", dir, "--confirm", "speed", "--summary", "x", "--reply", "y"]);
  assert.equal(unknown.status, 2);
  rmSync(dir, { recursive: true, force: true });
});
