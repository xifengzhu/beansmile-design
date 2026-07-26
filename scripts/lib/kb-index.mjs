// 知识库方向章节一致性门（规范 27.7）：direction-library.md 声明的方向（## Dn …）
// 与 playbooks/ 目录的分章文件必须一一对应——拆分后的双源漂移（库里加了 D9 没写手册、
// 手册里留了孤儿章）在 npm run check 就被抓，与规则包的幽灵/孤儿检查同构。
// 目录/文件可注入（测试用合成夹具），默认指向 skills/visual-system/references/。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REFS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "visual-system", "references");

export function playbookIndexIssues(refsDir = DEFAULT_REFS) {
  const errors = [];
  const libraryPath = join(refsDir, "direction-library.md");
  const playbooksDir = join(refsDir, "playbooks");
  if (!existsSync(libraryPath)) return { ok: false, errors: [`缺 ${libraryPath}`], count: 0 };
  if (!existsSync(playbooksDir)) return { ok: false, errors: [`缺 playbooks/ 分章目录（${playbooksDir}）`], count: 0 };

  // 方向 ID 出自 library 的二级标题（## D1 瑞士极简（…））
  const lib = readFileSync(libraryPath, "utf8");
  const declared = [...lib.matchAll(/^## (D\d+)\s/gm)].map((m) => m[1]);
  if (!declared.length) errors.push("direction-library.md 未声明任何方向（## Dn …）");

  const files = readdirSync(playbooksDir).filter((f) => f.endsWith(".md"));
  if (!files.includes("_intro.md")) errors.push("playbooks/ 缺 _intro.md（总则 + 候选竞争构成要求）");
  const chapterFiles = files.filter((f) => f !== "_intro.md").map((f) => f.replace(/\.md$/, ""));

  for (const d of declared) {
    if (!chapterFiles.includes(d)) errors.push(`方向 ${d} 在 direction-library.md 声明但缺 playbooks/${d}.md（缺章）`);
  }
  for (const f of chapterFiles) {
    if (!declared.includes(f)) errors.push(`playbooks/${f}.md 无 direction-library.md 对应方向声明（孤儿章）`);
  }
  return { ok: errors.length === 0, errors, count: declared.length };
}
