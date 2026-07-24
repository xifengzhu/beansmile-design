#!/usr/bin/env node
// 迭代循环用的轻量截图（html-prototype Skill 的截图-自评-迭代循环）。
// 对 prototype/ 全部页面在 375/768/1440 三视口截全页图，写入 audit/iterations/round-N/。
// 与 browser-check.mjs 的区别：不跑 axe/键盘/门禁，只求快，供生成中自评使用。
// 浏览器不可用时退出码 3（6.2 降级：按清单做代码级自评并记录假设）。
// 用法: node scripts/screenshot.mjs --package <目录> --round <N> [--page <相对 prototype/ 的路径>]
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { probeBrowser, launchBrowser } from "./lib/browser.mjs";
import { collectPrototypePages, pageSlug } from "./lib/pages.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), round = arg("--round");
if (!pkg || !round) { console.error("用法: node scripts/screenshot.mjs --package <目录> --round <N> [--page <相对路径>]"); process.exit(2); }
const root = resolve(pkg);

const probe = await probeBrowser();
if (!probe.available) {
  console.error(`✗ 浏览器不可用（${probe.error}）→ 6.2 降级：跳过截图，按 polish-checklist 做代码级自评并在 assumptions 记录"视觉未经渲染验证"。`);
  process.exit(3);
}

let pages = collectPrototypePages(root);
const only = arg("--page");
if (only) pages = pages.filter((p) => p.name === only);
if (!pages.length) { console.error(`✗ 未找到原型页面${only ? `（--page ${only}）` : ""}`); process.exit(2); }

const outDir = join(root, "audit", "iterations", `round-${round}`);
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { label: "mobile-375", width: 375, height: 812 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "desktop-1440", width: 1440, height: 900 },
];

const { browser } = await launchBrowser();
const shots = [];
for (const pg of pages) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathToFileURL(pg.file).href, { waitUntil: "load" }).catch((e) => console.error(`  ! ${pg.name} 导航失败: ${String(e.message).split("\n")[0]}`));
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(120);
    const out = join(outDir, `${pageSlug(pg.name)}.${vp.label}.png`);
    await page.screenshot({ path: out, fullPage: true });
    shots.push(out);
  }
  await context.close();
}
await browser.close();

console.log(`✓ 第 ${round} 轮截图：${pages.length} 页 × ${VIEWPORTS.length} 视口 → ${outDir}`);
for (const s of shots) console.log(`  ${s}`);
console.log(`下一步：Read 每张截图，对照 skills/html-prototype/references/polish-checklist.md 自评，把命中项与修复记录写入 ${join(outDir, "notes.md")}`);
