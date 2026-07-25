// 执行竞争门禁（规范 v1.3 生成上限层）：同一方向 ≥2 个候选执行版本、逐个截图对比、择优有记录。
// 竞争的是构成层执行（direction-playbooks.md），不是重开方向——令牌一致由评审看，这里只机器判定
// "竞争确实发生、每个候选都被看过、选择被记录"。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./hash.mjs";

// 返回 { dir, cands: ["cand-1", ...] } 或 null（目录不存在）。
export function collectCandidates(pkgRoot) {
  const dir = join(pkgRoot, "audit", "candidates");
  if (!existsSync(dir)) return null;
  const cands = readdirSync(dir)
    .filter((d) => /^cand-\d+$/.test(d) && statSync(join(dir, d)).isDirectory())
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  return { dir, cands };
}

// 返回问题字符串数组；空数组 = 通过。
export function candidateIssues(pkgRoot) {
  const c = collectCandidates(pkgRoot);
  if (!c) return ["缺 audit/candidates/：执行竞争未发生（专业模式要求同方向 ≥2 个候选版本对比择优）"];
  const problems = [];
  if (c.cands.length < 2) problems.push(`候选仅 ${c.cands.length} 个（要求 ≥2）`);
  const shotsByCand = new Map();
  for (const cand of c.cands) {
    const files = readdirSync(join(c.dir, cand));
    if (!files.some((f) => f.endsWith(".html"))) problems.push(`${cand} 无 HTML 页面`);
    const pngs = files.filter((f) => f.endsWith(".png"));
    if (!pngs.length) problems.push(`${cand} 无截图（候选必须渲染对比，不许纸上谈兵）`);
    shotsByCand.set(cand, pngs);
  }
  // 候选同一性（规范 24.1）：内容组合摘要（逐文件 sha256 排序拼接，与文件名无关）两两不得相同——
  // 字节相同的候选意味着竞争没有真实发生。机器只判字节级同一；近似重复留给视觉评审按方向对标判定。
  const digest = (cand, ext) =>
    readdirSync(join(c.dir, cand)).filter((f) => f.endsWith(ext))
      .map((f) => sha256File(join(c.dir, cand, f))).sort().join(",");
  for (const ext of [".html", ".png"]) {
    const seen = new Map();
    for (const cand of c.cands) {
      const d = digest(cand, ext);
      if (!d) continue; // 缺文件已在上面单独报
      if (seen.has(d)) {
        problems.push(ext === ".html"
          ? `${seen.get(d)} 与 ${cand} 的 HTML 内容完全相同（竞争未发生，规范 24.1）`
          : `${seen.get(d)} 与 ${cand} 的截图完全相同（截图并非渲染自各自候选，规范 24.1）`);
      } else seen.set(d, cand);
    }
  }
  const selPath = join(c.dir, "selection.md");
  if (!existsSync(selPath)) {
    problems.push("缺 audit/candidates/selection.md（择优决定未记录）");
    return problems;
  }
  const sel = readFileSync(selPath, "utf8");
  if (sel.trim().length < 100) problems.push(`selection.md 过短（${sel.trim().length} 字符），不构成有效对比记录`);
  const m = sel.match(/chosen:\s*(cand-\d+)/);
  if (!m) problems.push("selection.md 缺 `chosen: cand-N` 声明");
  else if (!c.cands.includes(m[1])) problems.push(`chosen 指向不存在的候选 ${m[1]}`);
  // 每个候选的截图至少被 selection.md 以 `cand-N/<截图名>` 限定路径引用一张——证明逐个看过，
  // 落选也要有落选理由的证据。要求限定路径是因为各候选截图常同名，裸文件名会互相蒙混。
  for (const cand of c.cands) {
    const pngs = shotsByCand.get(cand) ?? [];
    if (pngs.length && !pngs.some((p) => sel.includes(`${cand}/${p}`))) {
      problems.push(`selection.md 未以 ${cand}/<截图名> 形式引用其截图（每个候选都要看过截图再裁决）`);
    }
  }
  return problems;
}
