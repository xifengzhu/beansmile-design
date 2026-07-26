// 共享样式抽取门（规范 27.2）：多页原型必须把共享 CSS 抽到 prototype/assets/，
// 同一份大段样式逐页内联会把每次全量源码评审的输入体积成倍推高。
// 只封"规范化后逐字节重复"的零成本复制；AST 级相似度刻意不做（规范 27.10），
// 规则重排序等有成本伪差异由视觉评审组件一致性维度兜底。
// audit/candidates/ 不在 prototype/ 下，天然豁免（候选刻意单文件自包含）。
import { readFileSync } from "node:fs";
import { parse } from "node-html-parser";
import { collectPrototypePages } from "./pages.mjs";
import { sha256Text } from "./hash.mjs";

// 页面私有小段样式不管；≥2KB 的重复块才构成必须抽取的共享样式。
export const DUP_MIN_CHARS = 2048;

// 剥注释、压空白：抓"复制粘贴后改缩进/注释"的同一样式。
export function normalizeCss(text) {
  return String(text ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

// href 相对页面所在目录解析回相对 prototype/ 的路径，判定是否指向 assets/ 下的 .css。
export function resolvesToAssets(pageName, href) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // http(s)/data 等外链不算共享抽取
  const dir = pageName.includes("/") ? pageName.slice(0, pageName.lastIndexOf("/") + 1) : "";
  const out = [];
  for (const seg of (dir + href).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.pop()) return false; } // 越出 prototype/ 根不算
    else out.push(seg);
  }
  return out[0] === "assets" && /\.css(\?|#|$)/.test(out[out.length - 1] ?? "");
}

// 返回问题字符串数组，空数组=通过。单页/无原型不检查（单文件自包含合法）。
export function sharedCssIssues(pkgRoot) {
  const pages = collectPrototypePages(pkgRoot);
  if (pages.length < 2) return [];
  const issues = [];
  const inlineByHash = new Map(); // 规范化内容 sha256 → { chars, pages: [] }
  for (const pg of pages) {
    const root = parse(readFileSync(pg.file, "utf8"));
    const links = root.querySelectorAll("link")
      .filter((l) => String(l.getAttribute("rel") ?? "").toLowerCase() === "stylesheet");
    if (!links.some((l) => resolvesToAssets(pg.name, l.getAttribute("href")))) {
      issues.push(`${pg.name} 未通过 <link rel="stylesheet"> 引入 prototype/assets/ 下的共享样式表`);
    }
    for (const st of root.querySelectorAll("style")) {
      const css = normalizeCss(st.text);
      if (css.length < DUP_MIN_CHARS) continue;
      const h = sha256Text(css);
      const rec = inlineByHash.get(h) ?? { chars: css.length, pages: [] };
      if (!rec.pages.includes(pg.name)) rec.pages.push(pg.name);
      inlineByHash.set(h, rec);
    }
  }
  for (const rec of inlineByHash.values()) {
    if (rec.pages.length >= 2) {
      issues.push(`同一内联 <style>（规范化后 ${rec.chars} 字符）重复出现在 ${rec.pages.length} 页（${rec.pages.join(", ")}）——须抽取到 prototype/assets/ 共享样式表`);
    }
  }
  return issues;
}
