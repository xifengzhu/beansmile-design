#!/usr/bin/env node
// 迭代循环用的轻量截图（html-prototype Skill 的截图-自评-迭代循环）。
// 对 prototype/ 全部页面在 375/768/1440 三视口截全页图，写入 audit/iterations/round-N/。
// 与 browser-check.mjs 的区别：不跑 axe/键盘/门禁，只求快，供生成中自评使用。
// 浏览器不可用时退出码 3（6.2 降级：按清单做代码级自评并记录假设）。
// 每轮写 meta.json（当轮全部原型页面的 sha256）：验收据此核对"末轮自评看的就是交付版本"，
// 迭代不能只截一轮或截完再改代码不复评。
// 候选竞争模式（--candidates）：对 audit/candidates/cand-*/ 的候选页面在 375/1440 双视口截图，
// 图落在各候选目录内，供逐个对比与 selection.md 引用（验收「执行竞争」维度消费）。
// 用法: node scripts/screenshot.mjs --package <目录> --round <N> [--page <相对 prototype/ 的路径>]
//       node scripts/screenshot.mjs --package <目录> --candidates
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { probeBrowser, launchBrowser } from "./lib/browser.mjs";
import { collectPrototypePages, pageSlug } from "./lib/pages.mjs";
import { hashPaths } from "./lib/hash.mjs";
import { collectCandidates } from "./lib/candidates.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), round = arg("--round");
const candMode = process.argv.includes("--candidates");
if (!pkg || (!round && !candMode)) {
  console.error("用法: node scripts/screenshot.mjs --package <目录> --round <N> [--page <相对路径>] | --candidates");
  process.exit(2);
}
const root = resolve(pkg);

const probe = await probeBrowser();
if (!probe.available) {
  console.error(`✗ 浏览器不可用（${probe.error}）→ 6.2 降级：跳过截图，按 polish-checklist 做代码级自评并在 assumptions 记录"视觉未经渲染验证"。`);
  process.exit(3);
}

async function shootPages(browser, jobs, viewports) {
  const shots = [];
  for (const pg of jobs) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(pathToFileURL(pg.file).href, { waitUntil: "load" }).catch((e) => console.error(`  ! ${pg.name} 导航失败: ${String(e.message).split("\n")[0]}`));
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(120);
      const out = join(pg.outDir, `${pg.slug}.${vp.label}.png`);
      await page.screenshot({ path: out, fullPage: true });
      shots.push(out);
    }
    await context.close();
  }
  return shots;
}

const MOBILE = { label: "mobile-375", width: 375, height: 812 };
const TABLET = { label: "tablet-768", width: 768, height: 1024 };
const DESKTOP = { label: "desktop-1440", width: 1440, height: 900 };

if (candMode) {
  // —— 候选竞争模式：审 audit/candidates/cand-*/，图写回各候选目录 ——
  const c = collectCandidates(root);
  if (!c || c.cands.length === 0) { console.error("✗ 未找到 audit/candidates/cand-*/ 候选目录"); process.exit(2); }
  const jobs = c.cands.flatMap((cand) => {
    const dir = join(c.dir, cand);
    return readdirSync(dir).filter((f) => f.endsWith(".html"))
      .map((f) => ({ file: join(dir, f), name: `${cand}/${f}`, slug: pageSlug(f), outDir: dir }));
  });
  if (!jobs.length) { console.error("✗ 候选目录内无 HTML 页面"); process.exit(2); }
  const { browser } = await launchBrowser();
  const shots = await shootPages(browser, jobs, [MOBILE, DESKTOP]);
  await browser.close();
  console.log(`✓ 候选截图：${c.cands.length} 个候选、${jobs.length} 页 × 2 视口`);
  for (const s of shots) console.log(`  ${s}`);
  console.log(`下一步：Read 每个候选的截图并排对比（构成张力/记忆点落地/方向手法，见 playbooks/<选定方向>.md 与 layout-composition.md §7），`);
  console.log(`把逐候选评语与 \`chosen: cand-N\` 写入 ${join(c.dir, "selection.md")}（每个候选须以 cand-N/<截图名> 限定路径引用其截图）。`);
  process.exit(0);
}

// —— 迭代循环模式（原有行为不变）——
let pages = collectPrototypePages(root);
const only = arg("--page");
if (only) pages = pages.filter((p) => p.name === only);
if (!pages.length) { console.error(`✗ 未找到原型页面${only ? `（--page ${only}）` : ""}`); process.exit(2); }

const outDir = join(root, "audit", "iterations", `round-${round}`);
mkdirSync(outDir, { recursive: true });

const { browser } = await launchBrowser();
const shots = await shootPages(browser,
  pages.map((p) => ({ ...p, slug: pageSlug(p.name), outDir })),
  [MOBILE, TABLET, DESKTOP]);
await browser.close();

// meta.json：无论 --page 是否过滤，页面哈希都对完整 prototype/ 计算（迭代针对整包）。
const meta = {
  round: Number(round),
  generated_at: new Date().toISOString(),
  page_hashes: hashPaths(root, ["prototype"]),
  shots: shots.map((s) => basename(s)),
};
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

console.log(`✓ 第 ${round} 轮截图：${pages.length} 页 × 3 视口 → ${outDir}`);
for (const s of shots) console.log(`  ${s}`);
console.log(`下一步：Read 每张截图，对照 skills/html-prototype/references/polish-checklist.md 自评，把命中项与修复记录写入 ${join(outDir, "notes.md")}`);
console.log(`（验收会核对：≥2 轮、每轮 notes.md 非空且引用当轮截图文件名、末轮 page_hashes 与交付原型一致。）`);
