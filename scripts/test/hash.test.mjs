// 哈希库与快照 manifest 校验的单元测试（评审只读门禁的地基）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalDigest, hashPaths, manifestDigest, verifyManifest, diffHashMaps, sha256File } from "../lib/hash.mjs";

function makePkg() {
  const dir = mkdtempSync(join(tmpdir(), "bsd-hash-"));
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), "<html>v1</html>");
  writeFileSync(join(dir, "design-tokens.json"), '{"a":1}');
  writeFileSync(join(dir, "decisions.md"), "# D\n- one\n");
  return dir;
}

test("hashPaths 覆盖目录递归与单文件，路径稳定", () => {
  const dir = makePkg();
  const h = hashPaths(dir, ["prototype", "design-tokens.json", "no-such-file"]);
  assert.deepEqual(Object.keys(h).sort(), ["design-tokens.json", "prototype/index.html"]);
  assert.match(h["prototype/index.html"], /^[a-f0-9]{64}$/);
  rmSync(dir, { recursive: true, force: true });
});

test("manifestDigest 对键序不敏感、对内容敏感", () => {
  const a = { artifact_version: "1", files: { x: "aa", y: "bb" } };
  const b = { artifact_version: "1", files: { y: "bb", x: "aa" } };
  assert.equal(manifestDigest(a), manifestDigest(b));
  const c = { artifact_version: "1", files: { x: "aa", y: "cc" } };
  assert.notEqual(manifestDigest(a), manifestDigest(c));
});

test("verifyManifest 捕获篡改/缺失/多出文件", () => {
  const dir = makePkg();
  const snap = join(dir, "snap");
  mkdirSync(join(snap, "prototype"), { recursive: true });
  writeFileSync(join(snap, "prototype", "index.html"), "<html>v1</html>");
  const man = { artifact_version: "1", files: { "prototype/index.html": sha256File(join(snap, "prototype", "index.html")) } };
  assert.deepEqual(verifyManifest(snap, man), []);
  // 篡改
  writeFileSync(join(snap, "prototype", "index.html"), "<html>EVIL</html>");
  assert.equal(verifyManifest(snap, man).length, 1);
  assert.match(verifyManifest(snap, man)[0], /篡改/);
  // 多出未登记文件
  writeFileSync(join(snap, "prototype", "extra.html"), "x");
  assert.ok(verifyManifest(snap, man).some((p) => p.includes("多出")));
  rmSync(dir, { recursive: true, force: true });
});

test("diffHashMaps 捕获改动/删除/新增，且只看限定前缀", () => {
  const expected = { "prototype/index.html": "aa", "design-tokens.json": "bb", "brief.md": "cc" };
  const actual = { "prototype/index.html": "XX", "prototype/new.html": "dd" };
  const diff = diffHashMaps(expected, actual, ["prototype", "design-tokens.json"]);
  assert.ok(diff.some((s) => s.includes("被改动: prototype/index.html")));
  assert.ok(diff.some((s) => s.includes("被删除: design-tokens.json")));
  assert.ok(diff.some((s) => s.includes("新增: prototype/new.html")));
  // brief.md 不在范围内，不报
  assert.ok(!diff.some((s) => s.includes("brief.md")));
});

test("canonicalDigest recursively ignores object key order but preserves array order", () => {
  assert.equal(
    canonicalDigest({ b: 2, nested: { y: 2, x: 1 }, list: ["a", "b"] }),
    canonicalDigest({ list: ["a", "b"], nested: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(canonicalDigest({ list: ["a", "b"] }), canonicalDigest({ list: ["b", "a"] }));
});
