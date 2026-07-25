// 浏览器侧 blocker 检测（运行时），用于召回基准中 browser_only 类别。
// 捕获运行时控制台错误 / 资源加载失败（静态检测无法发现的 console-error）、
// 基于 computed style 的低对比度采样，以及移动视口文本贴边（edge-flush，规范 25 / v1.6）。
import { collectEdgeInsetTargetsInPage, edgeOffenders, EDGE_INSET_VIEWPORT } from "./edge-inset.mjs";

export async function detectBlockersBrowser(browser, fileUrl) {
  const found = new Set();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).split("\n")[0]));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("requestfailed", (r) => errs.push(`资源失败 ${r.url()}`));

  await page.goto(fileUrl, { waitUntil: "load" }).catch((e) => errs.push(`导航失败 ${e.message}`));
  await page.waitForTimeout(200);
  if (errs.length) found.add("console-error");

  // computed-style 低对比度采样（跨文件 CSS 也能覆盖）
  const low = await page.evaluate(() => {
    function lum([r, g, b]) {
      const a = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    function rgb(s) { const m = s.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : null; }
    function ratio(f, b) { const L1 = lum(f), L2 = lum(b); const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1]; return (hi + 0.05) / (lo + 0.05); }
    function effBg(el) {
      let e = el;
      while (e) { const c = getComputedStyle(e).backgroundColor; const v = rgb(c); if (v && !/rgba\(0, 0, 0, 0\)/.test(c)) return v; e = e.parentElement; }
      return [255, 255, 255];
    }
    for (const el of document.querySelectorAll("body *")) {
      if (!el.textContent || !el.textContent.trim()) continue;
      if (!el.childNodes || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fg = rgb(getComputedStyle(el).color);
      if (!fg) continue;
      if (ratio(fg, effBg(el)) < 4.5) return true;
    }
    return false;
  }).catch(() => false);
  if (low) found.add("low-contrast");

  // 移动视口文本贴边（渲染几何：文本承载元素距视口边缘 < 阈值，声明层检查抓不到）
  await page.setViewportSize(EDGE_INSET_VIEWPORT).catch(() => {});
  await page.waitForTimeout(100);
  const edgeRaw = await page.evaluate(collectEdgeInsetTargetsInPage).catch(() => null);
  if (edgeRaw && edgeOffenders(edgeRaw.items, edgeRaw.vw).length) found.add("edge-flush");

  await context.close();
  return { categories: [...found], errors: errs };
}
