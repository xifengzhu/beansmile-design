// file:// 交付兼容性静态门禁。交付环境是客户双击 file:// 打开原型；浏览器门禁为让
// axe 读取外部样式表（CSSOM via XHR）启用了 --allow-file-access-from-files，副作用是
// 原型自身的 fetch/XHR/动态 import/ES module 在门禁里也被放行——但这些能力在客户
// 未加 flag 的真实浏览器里被 CORS 拦截，页面会残缺。此静态检查把这类依赖挡在
// 验收内，保持"门禁通过 ⇒ 交付环境可用"的环境诚实承诺。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseHtml } from "node-html-parser";
import { collectPrototypePages } from "./pages.mjs";
import { listFilesRecursive } from "./hash.mjs";

// 词法级检测：允许极少量误报（注释里出现 fetch( 等），换来零漏报——命中者要么删除
// 依赖，要么改为内联数据/静态资源。
const RUNTIME_NETWORK = /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bimport\s*\(/;

export function fileProtocolIssues(rootPath) {
  const issues = [];
  const scripts = [];
  for (const page of collectPrototypePages(rootPath)) {
    const document = parseHtml(readFileSync(page.file, "utf8"));
    for (const element of document.querySelectorAll("script")) {
      if ((element.getAttribute("type") ?? "").trim().toLowerCase() === "module") {
        issues.push(`prototype/${page.name} 使用 ES module script：file:// 交付环境下被 CORS 拦截，客户打开即失效`);
      }
      if (!element.getAttribute("src")) scripts.push({ label: `prototype/${page.name}`, code: element.text ?? "" });
    }
  }
  const assetsDir = join(rootPath, "prototype", "assets");
  if (existsSync(assetsDir)) {
    for (const rel of listFilesRecursive(assetsDir)) {
      if (/\.(?:js|mjs)$/i.test(rel)) {
        scripts.push({ label: `prototype/assets/${rel}`, code: readFileSync(join(assetsDir, rel), "utf8") });
      }
    }
  }
  for (const { label, code } of scripts) {
    if (RUNTIME_NETWORK.test(code)) {
      issues.push(`${label} 依赖 fetch/XHR/动态 import：file:// 交付环境下被 CORS 拦截，须改为内联数据或静态资源`);
    }
  }
  return [...new Set(issues)];
}
