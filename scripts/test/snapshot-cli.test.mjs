// snapshot.mjs CLI 门（规范 27.9 复审修正 P2）：参数校验必须发生在创建任何目录之前，
// 失败不得留下半成品 snapshots/<v>/——否则不可覆盖门会拒绝重试，把交付包卡死。
// 组装走临时目录 + 原子 rename，snapshots/ 下要么是完整快照要么什么都没有。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = resolve(import.meta.dirname, "..", "snapshot.mjs");

function makePkg() {
  const dir = mkdtempSync(join(tmpdir(), "snap-cli-"));
  writeFileSync(join(dir, "context.yaml"),
    "project:\n  name: probe\n  platforms: [web]\n  industry: general\n  reference_system: none\n");
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), "<html lang=\"zh\"><body><p>probe</p></body></html>");
  return dir;
}

function snapshotEntries(dir) {
  const p = join(dir, "audit", "snapshots");
  return existsSync(p) ? readdirSync(p) : [];
}

function run(dir, ...extra) {
  return spawnSync("node", [CLI, "--package", dir, ...extra], { encoding: "utf8" });
}

test("对抗：--delta-from 非法（不小于当前版本）→ 退出 2 且 snapshots/ 无任何残留（含 .tmp-）", () => {
  const dir = makePkg();
  const r = run(dir, "--version", "1", "--delta-from", "1");
  assert.equal(r.status, 2, r.stderr);
  assert.deepEqual(snapshotEntries(dir), [], "失败不得留下半成品目录");
  rmSync(dir, { recursive: true, force: true });
});

test("对抗：--delta-from 指向不存在的基线 → 退出 2 且无残留", () => {
  const dir = makePkg();
  const r = run(dir, "--version", "2", "--delta-from", "1");
  assert.equal(r.status, 2, r.stderr);
  assert.deepEqual(snapshotEntries(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test("正向：错误参数失败后同版本重试不被卡死；--delta-from 合法时生成 delta/", () => {
  const dir = makePkg();
  assert.equal(run(dir, "--version", "1", "--delta-from", "1").status, 2);
  // 重试同版本必须成功——这是"半成品卡死"回归的核心断言
  const v1 = run(dir, "--version", "1");
  assert.equal(v1.status, 0, v1.stderr);
  assert.ok(existsSync(join(dir, "audit", "snapshots", "1", "manifest.json")));
  const v2 = run(dir, "--version", "2", "--delta-from", "1");
  assert.equal(v2.status, 0, v2.stderr);
  assert.ok(existsSync(join(dir, "audit", "snapshots", "2", "delta", "changed-files.json")));
  assert.deepEqual(snapshotEntries(dir).sort(), ["1", "2"], "不得残留 .tmp- 临时目录");
  rmSync(dir, { recursive: true, force: true });
});

test("对抗：版本不单调 → 退出 1 且已有快照不受影响、无残留", () => {
  const dir = makePkg();
  assert.equal(run(dir, "--version", "3").status, 0);
  const r = run(dir, "--version", "2");
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(snapshotEntries(dir), ["3"]);
  rmSync(dir, { recursive: true, force: true });
});
