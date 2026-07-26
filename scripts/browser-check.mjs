#!/usr/bin/env node
// 第 14.1 节浏览器自动检查（真实渲染）。用 Playwright 驱动 Chromium：
// axe-core 无障碍扫描、控制台错误捕获、多视口截图、320px 重排、640px（≈1280@200% 缩放）重排、
// 键盘可达率、可见焦点比率、文本裁切、布局跳动（CLS），以及核心任务场景执行
//（prototype/scenarios.json：填写→提交→断言成功/报错，规范 17"核心任务可以完成"的可执行证明）。
// 结果写入 audit/results.json（含 artifact_version + page_hashes 供验收绑定同源）。
// 浏览器不可用时按 6.2 降级：不写结果，退出码 3（待人工验证），绝不伪造通过。
// 退出码: 0 无阻断信号；1 存在阻断信号（结果仍已写盘）；2 用法错误；3 浏览器不可用。
// 用法: node scripts/browser-check.mjs --package <目录> --version <artifact_version>
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { probeBrowser, launchBrowser } from "./lib/browser.mjs";
import { collectPrototypePages, pageSlug } from "./lib/pages.mjs";
import { hashPaths } from "./lib/hash.mjs";
import { loadScenarios } from "./lib/scenarios.mjs";
import { collectEdgeInsetTargetsInPage, edgeOffenders, EDGE_INSET_MIN_PX } from "./lib/edge-inset.mjs";

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

const result = {
  checks_version: 7,
  artifact_version: version,
  method: probe.method,
  generated_at: new Date().toISOString(),
  // 检查时的原型内容指纹：验收据此判定 results.json 与交付原型同源（拒绝陈旧/错配的审计产物）。
  page_hashes: hashPaths(root, ["prototype"]),
  pages: [],
  violations: [],
  keyboard_reachable_ratio: 1,
  focus_visible_ratio: 1,
  console_errors: [],
  reflow_ok: true,
  zoom_ok: true,
  clipped_text: [],
  edge_insets: {},
  cls: {},
  task_flows: { total: 0, passed: 0, failures: [], definition_errors: [] },
  screenshots: [],
};
let focusableTotal = 0, focusableReachable = 0, focusVisibleCount = 0;

// 文本裁切检测（overflow hidden/clip 且非 ellipsis 的截断文字）。在页面上下文执行。
const CLIP_SNIPPET = () => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!el.innerText || !el.innerText.trim()) continue;
    const s = getComputedStyle(el);
    const clippedX = ["hidden", "clip"].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 2;
    const clippedY = ["hidden", "clip"].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
    if ((clippedX && s.textOverflow !== "ellipsis") || clippedY) {
      out.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/)[0] : ""}: "${el.innerText.trim().slice(0, 30)}"`);
    }
    if (out.length >= 20) break;
  }
  return out;
};

for (const { file, name } of pages) {
  const url = pathToFileURL(file).href;
  const consoleErrors = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${String(e).split("\n")[0]}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("requestfailed", (r) => consoleErrors.push(`${name}: 资源加载失败 ${r.url()}`));

  // CLS 观察器须在导航前注入
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* layout-shift 不支持时 __cls 保持 0 */ }
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "load" }).catch((e) => consoleErrors.push(`${name}: 导航失败 ${e.message}`));
  await page.waitForTimeout(300);

  // axe 扫描
  await page.addScriptTag({ path: axePath });
  const axe = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  for (const v of axe.violations) result.violations.push({ page: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length });

  // 键盘可达率 + 可见焦点：真实 Tab 遍历。可达=Tab 能到达的不同元素比例；
  // 可见焦点=聚焦时 computed style（outline/box-shadow/border/背景）相对未聚焦有变化的比例
  // （用真实键盘触发，:focus-visible 生效；程序化 focus() 会漏判）。
  const kb = await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]';
    const visible = (e) => {
      for (let n = e; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden") return false;
      }
      return true;
    };
    const styleKey = (e) => {
      const s = getComputedStyle(e);
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor].join("|");
    };
    const els = [...document.querySelectorAll(sel)].filter((e) => visible(e) && Number(e.getAttribute("tabindex") || 0) >= 0);
    els.forEach((e, i) => { e.setAttribute("data-kbd-i", String(i)); e.setAttribute("data-kbd-base", styleKey(e)); });
    return { total: els.length };
  });
  focusableTotal += kb.total;
  const seen = new Set(), focusVisible = new Set();
  for (let i = 0; i < kb.total + 2; i++) {
    await page.keyboard.press("Tab");
    const probe = await page.evaluate(() => {
      const el = document.activeElement;
      const idx = el?.getAttribute?.("data-kbd-i") ?? null;
      if (idx === null) return null;
      const s = getComputedStyle(el);
      const now = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor].join("|");
      return { idx, changed: now !== el.getAttribute("data-kbd-base") };
    });
    if (probe) { seen.add(probe.idx); if (probe.changed) focusVisible.add(probe.idx); }
  }
  focusableReachable += seen.size;
  focusVisibleCount += focusVisible.size;
  for (const idx of seen) {
    if (!focusVisible.has(idx)) {
      const desc = await page.evaluate((i) => {
        const el = document.querySelector(`[data-kbd-i="${i}"]`);
        return el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.innerText || el.value || "").trim().slice(0, 20)}"` : `#${i}`;
      }, idx);
      result.violations.push({ page: name, id: "focus-not-visible", impact: "serious", help: `聚焦时无可见样式变化: ${desc}` });
    }
  }

  // 文本裁切（1280 桌面视口）
  for (const c of await page.evaluate(CLIP_SNIPPET)) result.clipped_text.push({ page: name, viewport: 1280, el: c });

  // 320px 重排：无横向滚动
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(100);
  const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow320) { result.reflow_ok = false; result.violations.push({ page: name, id: "reflow-320", impact: "serious", help: "320px 下出现横向滚动" }); }

  // 640px ≈ 1280 桌面 @200% 缩放（WCAG 1.4.4/1.4.10 的缩放场景）：无横向滚动
  await page.setViewportSize({ width: 640, height: 800 });
  await page.waitForTimeout(100);
  const overflow640 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow640) { result.zoom_ok = false; result.violations.push({ page: name, id: "zoom-200", impact: "serious", help: "640px（≈200% 缩放）下出现横向滚动" }); }
  // 缩放视口下的文本裁切
  for (const c of await page.evaluate(CLIP_SNIPPET)) result.clipped_text.push({ page: name, viewport: 640, el: c });

  // 布局跳动（加载期 CLS，无输入）
  result.cls[name] = await page.evaluate(() => Number((window.__cls ?? 0).toFixed(4)));
  if (result.cls[name] >= 0.1) result.violations.push({ page: name, id: "layout-shift", impact: "serious", help: `加载期 CLS=${result.cls[name]}（阈值 0.1）` });

  // 截图：桌面 + 手机。每个视口先设尺寸**再** reload（规范 24.4/27.9）：reload 既复位
  // 测试残留态（Tab 遍历留下的焦点框/skip link），也保证页面在目标视口下初始化——
  // 先按 640px 或默认宽加载再缩放，响应式页面会把错误初始化宽度截进审计证据。
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(300);
  const shotD = join(shotDir, `${pageSlug(name)}.desktop.png`);
  await page.screenshot({ path: shotD, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(300);
  const shotM = join(shotDir, `${pageSlug(name)}.mobile.png`);
  await page.screenshot({ path: shotM, fullPage: true });
  result.screenshots.push(shotD, shotM);

  // 移动视口页边距（渲染几何，规范 25 / v1.6）：文本承载元素距视口左右边缘
  // < EDGE_INSET_MIN_PX 判贴边。声明层的间距档位检查抓不到简写覆盖容器 padding 的失效。
  const edgeRaw = await page.evaluate(collectEdgeInsetTargetsInPage);
  const offenders = edgeOffenders(edgeRaw.items, edgeRaw.vw);
  result.edge_insets[name] = { viewport: edgeRaw.vw, offenders: offenders.slice(0, 12) };
  if (offenders.length) {
    result.violations.push({
      page: name, id: "edge-inset", impact: "serious",
      help: `移动视口(${edgeRaw.vw}px)文本贴边 ${offenders.length} 处（阈值 ${EDGE_INSET_MIN_PX}px），如 ${offenders[0].el} left=${offenders[0].leftInset}px/right=${offenders[0].rightInset}px "${offenders[0].text}"`,
    });
  }

  result.console_errors.push(...consoleErrors);
  result.pages.push(name);
  await context.close();
}

// —— 核心任务场景执行（填写 → 提交 → 断言成功/报错）——
// 断言初始态探测（规范 27.11）：不等待、立即求值。若场景的全部 expect_* 在加载后
// 未做任何交互就已成立，该场景没有证明任何"交互引起的状态变化"——判废（failure），
// 封"click 任意元素 + expect 静态恒真元素"把任务证明退化成页面加载测试。
async function expectHoldsNow(page, st) {
  try {
    const loc = page.locator(st.selector).first();
    if (st.action === "expect_visible") return await loc.isVisible();
    if (st.action === "expect_hidden") return !(await loc.isVisible());
    if (st.action === "expect_text") return (await loc.isVisible()) && (await loc.innerText()).includes(st.text);
  } catch { return false; }
  return false;
}

const { scenarios, errors: scenarioErrors } = loadScenarios(root);
result.task_flows.definition_errors = scenarioErrors;
result.task_flows.total = scenarios.length;
if (!scenarioErrors.length) {
  for (const sc of scenarios) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // 场景 context 与静态巡检同等捕获错误（规范 27.11）：交互期抛异常/控制台错误/
    // 资源失败是"任务不可用"的直接证据，静默吞掉会让 flow 假通过。
    const scErrors = [];
    page.on("pageerror", (e) => scErrors.push(`场景 ${sc.id}: ${String(e).split("\n")[0]}`));
    page.on("console", (m) => { if (m.type() === "error") scErrors.push(`场景 ${sc.id}: ${m.text()}`); });
    page.on("requestfailed", (r) => scErrors.push(`场景 ${sc.id}: 资源加载失败 ${r.url()}`));
    let failure = null;
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(pathToFileURL(join(root, "prototype", sc.page)).href, { waitUntil: "load" });
      const expects = sc.steps.filter((st) => String(st.action).startsWith("expect_"));
      const holdsNow = [];
      for (const st of expects) holdsNow.push(await expectHoldsNow(page, st));
      if (holdsNow.length && holdsNow.every(Boolean)) {
        failure = `全部 ${expects.length} 条断言在初始状态即成立——场景未证明任何交互引起的状态变化，不构成任务完成证明（规范 27.11）`;
      }
      if (!failure) for (const [j, st] of sc.steps.entries()) {
        const loc = st.selector ? page.locator(st.selector).first() : null;
        try {
          if (st.action === "fill") await loc.fill(String(st.value), { timeout: 3000 });
          else if (st.action === "click") await loc.click({ timeout: 3000 });
          else if (st.action === "press") await page.keyboard.press(st.key);
          else if (st.action === "expect_visible") await loc.waitFor({ state: "visible", timeout: 3000 });
          else if (st.action === "expect_hidden") await loc.waitFor({ state: "hidden", timeout: 3000 });
          else if (st.action === "expect_text") {
            await loc.waitFor({ state: "visible", timeout: 3000 });
            const txt = await loc.innerText();
            if (!txt.includes(st.text)) throw new Error(`文本不含 "${st.text}"（实际: "${txt.trim().slice(0, 60)}"）`);
          }
        } catch (e) {
          failure = `step[${j}] ${st.action} ${st.selector ?? st.key ?? ""}: ${String(e.message).split("\n")[0]}`;
          break;
        }
      }
    } catch (e) { failure = `导航失败: ${String(e.message).split("\n")[0]}`; }
    await page.waitForTimeout(120); // 给异步错误（unhandled rejection/迟到的资源失败）落地窗口
    if (!failure && scErrors.length) failure = `执行期 JS/资源错误 ${scErrors.length} 条: ${scErrors[0]}`;
    result.console_errors.push(...scErrors);
    if (failure) result.task_flows.failures.push({ id: sc.id, name: sc.name, kind: sc.kind, error: failure });
    else result.task_flows.passed++;
    await context.close();
  }
}

await browser.close();
result.keyboard_reachable_ratio = focusableTotal === 0 ? 1 : Math.min(1, focusableReachable / focusableTotal);
result.focus_visible_ratio = focusableTotal === 0 ? 1 : Math.min(1, focusVisibleCount / focusableTotal);
mkdirSync(join(root, "audit"), { recursive: true });
writeFileSync(join(root, "audit", "results.json"), JSON.stringify(result, null, 2));

const severe = result.violations.filter((v) => ["critical", "serious"].includes(v.impact)).length;
const maxCls = Math.max(0, ...Object.values(result.cls));
const blockers = [
  severe > 0 ? `axe/检查严重违规 ${severe}` : null,
  result.console_errors.length ? `控制台错误 ${result.console_errors.length}` : null,
  result.keyboard_reachable_ratio < 1 ? `键盘可达 ${(result.keyboard_reachable_ratio * 100).toFixed(0)}%` : null,
  result.focus_visible_ratio < 1 ? `可见焦点 ${(result.focus_visible_ratio * 100).toFixed(0)}%` : null,
  !result.reflow_ok ? "320px 重排失败" : null,
  !result.zoom_ok ? "200% 缩放重排失败" : null,
  result.clipped_text.length ? `文本裁切 ${result.clipped_text.length} 处` : null,
  Object.values(result.edge_insets).some((e) => e.offenders.length) ? `移动视口文本贴边（${Object.entries(result.edge_insets).filter(([, e]) => e.offenders.length).map(([p, e]) => `${p}:${e.offenders.length}处`).join(", ")}）` : null,
  maxCls >= 0.1 ? `CLS=${maxCls}` : null,
  result.task_flows.definition_errors.length ? `核心任务场景定义问题 ${result.task_flows.definition_errors.length} 条` : null,
  result.task_flows.failures.length ? `核心任务执行失败 ${result.task_flows.failures.length}/${result.task_flows.total}` : null,
].filter(Boolean);

console.log(`${blockers.length ? "✗" : "✓"} 浏览器检查完成（${probe.method}）：axe 严重违规 ${severe}，控制台错误 ${result.console_errors.length}，键盘可达 ${(result.keyboard_reachable_ratio * 100).toFixed(0)}%，可见焦点 ${(result.focus_visible_ratio * 100).toFixed(0)}%，reflow ${result.reflow_ok ? "OK" : "FAIL"}，200%缩放 ${result.zoom_ok ? "OK" : "FAIL"}，裁切 ${result.clipped_text.length}，页边距贴边 ${Object.values(result.edge_insets).reduce((n, e) => n + e.offenders.length, 0)}，CLS≤${maxCls}，核心任务 ${result.task_flows.passed}/${result.task_flows.total}`);
if (blockers.length) {
  console.error(`  阻断信号：${blockers.join("；")}（结果已写盘，须修复后重跑）`);
  process.exit(1);
}
process.exit(0);
