// 原型页面收集。递归遍历 prototype/，支持规范 13 的 prototype/<platform>/<flow>.html 组织。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// 返回 [{ file: 绝对路径, name: 相对 prototype/ 的路径（用作截图/报告标识）}]，index.html 排最前。
export function collectPrototypePages(pkgRoot) {
  const protoDir = join(pkgRoot, "prototype");
  if (!existsSync(protoDir)) return [];
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== "assets" && entry !== "node_modules") walk(p);
      } else if (entry.endsWith(".html")) {
        pages.push({ file: p, name: relative(protoDir, p) });
      }
    }
  };
  walk(protoDir);
  pages.sort((a, b) => (a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : a.name.localeCompare(b.name)));
  return pages;
}

// 截图/报告用的扁平文件名：platform/flow.html → platform__flow.html
export function pageSlug(name) {
  return name.replaceAll("/", "__");
}
