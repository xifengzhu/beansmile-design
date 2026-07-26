#!/usr/bin/env node
// 原型静态 lint（规范 27.2 共享样式抽取门）。html-prototype Skill 生成中自检用；
// 验收「共享样式」维度调用同一实现（scripts/lib/css-dup.mjs）。
// 纯静态检查，无浏览器依赖——降级环境同样强制。
// 用法: node scripts/lint-prototype.mjs --package <目录>
// 退出码: 0 通过；1 有失败项；2 参数错误。
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { sharedCssIssues } from "./lib/css-dup.mjs";
import { collectPrototypePages } from "./lib/pages.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package");
if (!pkg) { console.error("用法: node scripts/lint-prototype.mjs --package <目录>"); process.exit(2); }
const root = resolve(pkg);
if (!existsSync(join(root, "prototype"))) { console.error(`✗ ${root} 下无 prototype/`); process.exit(2); }

const pages = collectPrototypePages(root);
const issues = sharedCssIssues(root);
if (issues.length) {
  console.error(`✗ 共享样式检查未通过（${pages.length} 页）：`);
  for (const s of issues) console.error(`  - ${s}`);
  console.error("  修法：把跨页共享的 CSS 抽到 prototype/assets/styles.css 并由每页 <link> 引入；页面私有样式（<2KB）可保留内联。");
  process.exit(1);
}
console.log(pages.length < 2
  ? `✓ 共享样式检查：单页原型（${pages.length} 页），单文件自包含合法`
  : `✓ 共享样式检查：${pages.length} 页均引入 assets/ 共享样式表，无 ≥2KB 重复内联块`);
