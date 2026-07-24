// 静态 HTML blocker 检测器。覆盖第 14.2 节中可静态判定的类别。
// 注意：完整对比度渲染判定与真实运行时控制台错误需浏览器（规范 6.1/14.1）；
// 本模块只覆盖可静态确定的子集，作为召回验证 harness 的检测层。
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse } from "node-html-parser";
import { loadRules } from "./rules.mjs";

const FOCUSABLE = new Set(["a", "button", "input", "select", "textarea", "summary"]);

// —— 颜色与对比度 ——
function parseColor(s) {
  if (!s) return null;
  s = s.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split("").map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(([^)]+)\)/);
  if (m) return m[1].split(",").slice(0, 3).map((x) => parseInt(x.trim(), 10));
  return null;
}
function luminance([r, g, b]) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
export function contrastRatio(fg, bg) {
  const L1 = luminance(fg), L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function styleMap(styleAttr) {
  const map = {};
  for (const decl of (styleAttr || "").split(";")) {
    const [k, v] = decl.split(":");
    if (k && v) map[k.trim().toLowerCase()] = v.trim();
  }
  return map;
}

// 返回该 HTML 命中的 blocker 类别集合。
export function detectBlockers(html, { baseDir } = {}) {
  const root = parse(html, { comment: true });
  const found = new Set();
  const evidence = [];
  const note = (cat, ev) => { found.add(cat); evidence.push(`${cat}: ${ev}`); };

  // 1a. low-contrast：同元素 inline color + background-color 对比 < 4.5
  for (const el of root.querySelectorAll("[style]")) {
    const st = styleMap(el.getAttribute("style"));
    const fg = parseColor(st["color"]), bg = parseColor(st["background-color"] || st["background"]);
    if (fg && bg) {
      const r = contrastRatio(fg, bg);
      if (r < 4.5) note("low-contrast", `<${el.rawTagName}> 比值 ${r.toFixed(2)}:1`);
    }
  }
  // 1b. low-contrast：内联 <style> 中 .class 规则的 color+background 对比 < 4.5，且页面确有元素用到该 class
  for (const styleEl of root.querySelectorAll("style")) {
    for (const m of (styleEl.text || "").matchAll(/\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g)) {
      const cls = m[1];
      const decl = styleMap(m[2].replace(/\n/g, " "));
      const fg = parseColor(decl["color"]), bg = parseColor(decl["background-color"] || decl["background"]);
      if (fg && bg && root.querySelector(`.${cls}`)) {
        const r = contrastRatio(fg, bg);
        if (r < 4.5) note("low-contrast", `.${cls} 比值 ${r.toFixed(2)}:1`);
      }
    }
  }

  // 2. keyboard-unreachable：onclick 挂在非键盘可达元素
  for (const el of root.querySelectorAll("[onclick]")) {
    const tag = (el.rawTagName || "").toLowerCase();
    const ti = el.getAttribute("tabindex");
    const tabbable = ti !== undefined && Number(ti) >= 0;
    // <a> 只有带 href 才天然可聚焦；无 href 的 <a onclick> 不可键盘触达
    const nativelyFocusable = tag === "a"
      ? el.getAttribute("href") !== undefined
      : FOCUSABLE.has(tag);
    if (!nativelyFocusable && !tabbable) note("keyboard-unreachable", `<${tag} onclick> 无键盘可达（无 href/role/tabindex）`);
  }
  // 原生可聚焦元素被 tabindex=-1 移出 Tab 流
  for (const el of root.querySelectorAll("a[tabindex], button[tabindex], input[tabindex]")) {
    if (Number(el.getAttribute("tabindex")) < 0) note("keyboard-unreachable", `<${el.rawTagName} tabindex=-1> 被移出 Tab 流`);
  }

  // 3. missing-state：每个 form 自身/其内部缺任何错误反馈机制（错误机制须在表单内，页面别处的 .error 不算）
  for (const form of root.querySelectorAll("form")) {
    const scoped = [form, ...form.querySelectorAll("*")];
    const hasErrorMech = scoped.some((el) => {
      const role = (el.getAttribute?.("role") || "").toLowerCase();
      const cls = el.getAttribute?.("class") || "";
      return role === "alert"
        || el.getAttribute?.("data-state") !== undefined
        || el.getAttribute?.("aria-invalid") !== undefined
        || /\berror\b/.test(cls);
    });
    if (!hasErrorMech) note("missing-state", "form 内无 role=alert/aria-invalid/data-state/.error 等错误状态机制");
  }

  // 4. console-error：内联脚本语法错误 / 缺失的本地脚本、样式表、图片资源
  for (const link of root.querySelectorAll('link[rel="stylesheet"][href]')) {
    const href = link.getAttribute("href");
    if (href && !/^https?:|^\/\//.test(href) && baseDir && !existsSync(resolve(baseDir, href))) {
      note("console-error", `<link stylesheet href="${href}"> 本地资源缺失`);
    }
  }
  for (const s of root.querySelectorAll("script")) {
    const src = s.getAttribute("src");
    if (src) {
      if (!/^https?:|^\/\//.test(src) && baseDir && !existsSync(resolve(baseDir, src))) {
        note("console-error", `<script src="${src}"> 本地资源缺失`);
      }
    } else {
      const code = s.text || "";
      if (code.trim()) {
        try { new Function(code); } catch (e) { note("console-error", `内联脚本语法错误: ${e.message}`); }
      }
    }
  }
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (src && !/^https?:|^data:|^\/\//.test(src) && baseDir && !existsSync(resolve(baseDir, src))) {
      note("console-error", `<img src="${src}"> 本地资源缺失`);
    }
  }

  // 5. fake-reference：<meta name="rule-refs"> 或 data-rule-id 指向依据库不存在的规则
  const { byId } = loadRules();
  const refs = new Set();
  for (const meta of root.querySelectorAll('meta[name="rule-refs"]')) {
    for (const id of (meta.getAttribute("content") || "").split(",")) if (id.trim()) refs.add(id.trim());
  }
  for (const el of root.querySelectorAll("[data-rule-id]")) refs.add(el.getAttribute("data-rule-id").trim());
  for (const id of refs) if (!byId.has(id)) note("fake-reference", `引用不存在的规则 ${id}`);

  return { categories: [...found], evidence };
}
