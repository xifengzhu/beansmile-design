// 方向章节索引一致性测试（规范 27.7）。真实仓库 + /tmp 合成夹具双面覆盖，
// 对抗面与规则包幽灵/孤儿检查同构：缺章、孤儿章、缺 _intro。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { playbookIndexIssues } from "../lib/kb-index.mjs";

function makeRefs({ directions = ["D1", "D2"], chapters = ["D1", "D2"], intro = true } = {}) {
  const refs = mkdtempSync(join(tmpdir(), "kb-index-"));
  writeFileSync(join(refs, "direction-library.md"),
    `# 库\n\n${directions.map((d) => `## ${d} 某方向（X）\n\n内容\n`).join("\n")}`);
  mkdirSync(join(refs, "playbooks"));
  if (intro) writeFileSync(join(refs, "playbooks", "_intro.md"), "# 总则");
  for (const c of chapters) writeFileSync(join(refs, "playbooks", `${c}.md`), `# ${c}`);
  return refs;
}

test("正向：仓库真实 references/ 通过（8 方向一一对应）", () => {
  const r = playbookIndexIssues();
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.count, 8);
});

test("正向：合成夹具 library ↔ playbooks 对齐 → 通过", () => {
  const refs = makeRefs();
  const r = playbookIndexIssues(refs);
  assert.ok(r.ok && r.count === 2);
  rmSync(refs, { recursive: true, force: true });
});

test("对抗：library 声明 D3 但缺 playbooks/D3.md → 报缺章", () => {
  const refs = makeRefs({ directions: ["D1", "D2", "D3"], chapters: ["D1", "D2"] });
  const r = playbookIndexIssues(refs);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("D3") && e.includes("缺章")));
  rmSync(refs, { recursive: true, force: true });
});

test("对抗：playbooks/ 留有 library 未声明的 D9.md → 报孤儿章", () => {
  const refs = makeRefs({ chapters: ["D1", "D2", "D9"] });
  const r = playbookIndexIssues(refs);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("D9") && e.includes("孤儿章")));
  rmSync(refs, { recursive: true, force: true });
});

test("对抗：缺 _intro.md / 缺 playbooks/ 目录 → 报", () => {
  const noIntro = makeRefs({ intro: false });
  assert.ok(playbookIndexIssues(noIntro).errors.some((e) => e.includes("_intro.md")));
  rmSync(noIntro, { recursive: true, force: true });

  const refs = mkdtempSync(join(tmpdir(), "kb-index-"));
  writeFileSync(join(refs, "direction-library.md"), "## D1 X\n");
  const r = playbookIndexIssues(refs);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("playbooks/")));
  rmSync(refs, { recursive: true, force: true });
});
