#!/usr/bin/env node
// 运行环境自检（规范 6.1）。不止检查模块是否安装，还真正试启动一次浏览器，
// 如实判断浏览器自动化能力；不具备时按 6.2 降级。
// 用法: node scripts/env-check.mjs [--out <audit/environment.md>]
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { probeBrowser } from "./lib/browser.mjs";

const require = createRequire(import.meta.url);
function canResolve(mod) { try { require.resolve(mod); return true; } catch { return false; } }

// 同步部分：模块是否安装。异步部分：浏览器能否真正启动。
export function checkEnvironmentSync() {
  return {
    node: process.version,
    playwright: canResolve("playwright") || canResolve("playwright-core"),
    axe_core: canResolve("axe-core"),
  };
}

export async function checkEnvironment() {
  const sync = checkEnvironmentSync();
  let probe = { available: false, method: null, error: "playwright 未安装" };
  if (sync.playwright) probe = await probeBrowser();
  const browser_automation = sync.playwright && sync.axe_core && probe.available;
  return { ...sync, probe, browser_automation, degraded: !browser_automation };
}

function toMarkdown(c) {
  const yn = (b) => (b ? "✓ 可用" : "✗ 缺失");
  return `# 运行环境自检（规范 6.1）

| 能力 | 状态 |
|---|---|
| Node 运行时 | ${c.node} |
| Playwright 模块 | ${yn(c.playwright)} |
| axe-core 模块 | ${yn(c.axe_core)} |
| 浏览器可真正启动 | ${c.probe.available ? `✓ 可用（${c.probe.method}）` : `✗ 不可用（${c.probe.error}）`} |
| 浏览器自动化（综合） | ${yn(c.browser_automation)} |

${c.degraded
  ? "**降级（规范 6.2）**：浏览器自动化不可用。axe 自动检查、Playwright 交互、真实截图、200% 缩放/窄视口重排、溢出遮挡检查、运行时控制台错误、computed-style 对比度均无法执行，相关结论只能标注\"未验证\"；核心阻断检查因此无法执行时，任务只能标\"待人工验证\"，不得标记已完成。"
  : "浏览器自动化具备，第 14.1 节自动检查可实际执行。"}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await checkEnvironment();
  const outIdx = process.argv.indexOf("--out");
  const md = toMarkdown(c);
  if (outIdx >= 0) {
    const out = process.argv[outIdx + 1];
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.log(`已写入 ${out}`);
  }
  console.log(md);
  process.exit(c.degraded ? 3 : 0);
}
