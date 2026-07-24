#!/usr/bin/env node
// 第 14.1 节浏览器自动检查（真实渲染）。用 Playwright 驱动 Chromium：
// axe-core 无障碍扫描、控制台错误捕获、多视口截图、320px 重排检查、键盘可达率。
// 结果写入 audit/results.json（含 artifact_version 供验收绑定）。
// 浏览器不可用时按 6.2 降级：不写结果，退出码 3（待人工验证），绝不伪造通过。
// 用法: node scripts/browser-check.mjs --package <目录> --version <artifact_version>
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { probeBrowser, launchBrowser } from "./lib/browser.mjs";
import { collectPrototypePages, pageSlug } from "./lib/pages.mjs";

const require = createRequire(import.meta.url);
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package");
const version = arg("--version");
if (!pkg || !version) { console.error("用法: node scripts/browser-check.mjs --package <目录> --version <artifact_version>"); process.exit(2); }
const root = resolve(pkg);

const probe = await probeBrowser();
if (!probe.available) {
  console.error(`✗ 浏览器自动化不可用（${probe.error}）→ 按 6.2 降级，不写 results.json，任务只能标"待人工验证"。`);
  process.exit(3);
}

// 收集原型页面（递归，支持规范 13 的 prototype/<platform>/<flow>.html 组织）
const pages = collectPrototypePages(root);
if (!pages.length) { console.error("✗ 未找到 prototype/**/*.html"); process.exit(2); }

const axePath = require.resolve("axe-core");
const { browser } = await launchBrowser();
const shotDir = join(root, "audit", "screenshots");
mkdirSync(shotDir, { recursive: true });

const result = { artifact_version: version, method: probe.method, pages: [], violations: [], keyboard_reachable_ratio: 1, console_errors: [], reflow_ok: true, screenshots: [] };
let focusableTotal = 0, focusableReachable = 0;

for (const { file, name } of pages) {
  const url = pathToFileURL(file).href;
  const consoleErrors = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${String(e).split("\n")[0]}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("requestfailed", (r) => consoleErrors.push(`${name}: 资源加载失败 ${r.url()}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "load" }).catch((e) => consoleErrors.push(`${name}: 导航失败 ${e.message}`));
  await page.waitForTimeout(150);

  // axe 扫描
  await page.addScriptTag({ path: axePath });
  const axe = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  for (const v of axe.violations) result.violations.push({ page: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length });

  // 键盘可达率：可聚焦元素中，能通过 Tab 到达的**不同元素**比例（按次数统计会把焦点循环误判为可达）
  const kb = await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]';
    const visible = (e) => {
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden") return false;
      }
      return true;
    };
    const els = [...document.querySelectorAll(sel)].filter((e) => visible(e) && Number(e.getAttribute("tabindex") || 0) >= 0);
    els.forEach((e, i) => e.setAttribute("data-kbd-i", String(i)));
    return { total: els.length };
  });
  focusableTotal += kb.total;
  const seen = new Set();
  for (let i = 0; i < kb.total + 2; i++) {
    await page.keyboard.press("Tab");
    const idx = await page.evaluate(() => document.activeElement?.getAttribute?.("data-kbd-i") ?? null);
    if (idx !== null) seen.add(idx);
  }
  focusableReachable += seen.size;

  // 320px 重排：无横向滚动
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) { result.reflow_ok = false; result.violations.push({ page: name, id: "reflow-320", impact: "serious", help: "320px 下出现横向滚动" }); }

  // 截图：桌面 + 手机
  await page.setViewportSize({ width: 1280, height: 800 });
  const shotD = join(shotDir, `${pageSlug(name)}.desktop.png`);
  await page.screenshot({ path: shotD, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  const shotM = join(shotDir, `${pageSlug(name)}.mobile.png`);
  await page.screenshot({ path: shotM, fullPage: true });
  result.screenshots.push(shotD, shotM);

  result.console_errors.push(...consoleErrors);
  result.pages.push(name);
  await context.close();
}

await browser.close();
result.keyboard_reachable_ratio = focusableTotal === 0 ? 1 : Math.min(1, focusableReachable / focusableTotal);
mkdirSync(join(root, "audit"), { recursive: true });
writeFileSync(join(root, "audit", "results.json"), JSON.stringify(result, null, 2));

const severe = result.violations.filter((v) => ["critical", "serious"].includes(v.impact)).length;
console.log(`✓ 浏览器检查完成（${probe.method}）：axe 严重违规 ${severe}，控制台错误 ${result.console_errors.length}，键盘可达 ${(result.keyboard_reachable_ratio * 100).toFixed(0)}%，reflow ${result.reflow_ok ? "OK" : "FAIL"}`);
process.exit(0);
