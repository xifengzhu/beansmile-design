#!/usr/bin/env node
// 阻断召回验证（规范 18.2）。对植入已知 blocker 的样本运行检测器，计算召回率，
// 并检查干净基线无误报。诚实区分静态可判定与 browser_only 类别：
//   - 有浏览器：静态 + 浏览器检测并集，覆盖全部注入类别，browser_covered=true。
//   - 无浏览器：只跑静态；browser_only 类别记为"未覆盖"，browser_covered=false，
//     召回率只在静态可判定子集上计算，绝不因此宣称"全部 blocker 可捕获"。
// 用法: node scripts/recall-harness.mjs [--dir fixtures/blockers] [--out <path>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { detectBlockers } from "./lib/detectors.mjs";
import { probeBrowser, launchBrowser } from "./lib/browser.mjs";
import { detectBlockersBrowser } from "./lib/browser-detectors.mjs";

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

const dir = resolve(arg("--dir", "fixtures/blockers"));
const out = resolve(arg("--out", join(dir, "audit", "recall.json")));
const manifest = yaml.load(readFileSync(join(dir, "manifest.yaml"), "utf8"));

const probe = await probeBrowser();
const browserCovered = probe.available;
let browser = null;
if (browserCovered) ({ browser } = await launchBrowser());

let expected = 0, detected = 0;
const misses = [], falsePositives = [], uncovered = [], perFile = [];

for (const fx of manifest.fixtures) {
  const injected = new Set(fx.injected);
  const browserOnly = new Set(fx.browser_only || []);
  const html = readFileSync(join(dir, fx.file), "utf8");
  const found = new Set(detectBlockers(html, { baseDir: dir }).categories);
  if (browser) {
    const b = await detectBlockersBrowser(browser, pathToFileURL(join(dir, fx.file)).href);
    for (const c of b.categories) found.add(c);
  }

  // 需覆盖的类别：有浏览器则全部注入；否则排除 browser_only
  const toCover = [...injected].filter((c) => browserCovered || !browserOnly.has(c));
  for (const c of toCover) {
    expected++;
    if (found.has(c)) detected++;
    else misses.push(`${fx.file}: 漏检 ${c}`);
  }
  if (!browserCovered) for (const c of injected) if (browserOnly.has(c)) uncovered.push(`${fx.file}: ${c}（需浏览器，本环境降级未覆盖）`);
  for (const c of found) if (!injected.has(c)) falsePositives.push(`${fx.file}: 误报 ${c}`);
  perFile.push({ file: fx.file, injected: fx.injected, detected: [...found] });
}

if (browser) await browser.close();

const recall = expected === 0 ? 1 : detected / expected;
const report = {
  injected: expected, detected, recall,
  false_positives: falsePositives.length,
  browser_covered: browserCovered,
  browser_probe: browserCovered ? probe.method : probe.error,
  browser_only_uncovered: uncovered,
  misses, false_positive_list: falsePositives, per_file: perFile,
  scope_note: browserCovered
    ? "静态 + 浏览器检测并集，覆盖全部注入类别。"
    : "浏览器不可用（6.2 降级）：仅静态可判定子集计入召回；browser_only 类别未覆盖，不得据此宣称全部 blocker 可捕获。",
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`阻断召回（${browserCovered ? "含浏览器" : "仅静态·降级"}）：${detected}/${expected} = ${(recall * 100).toFixed(0)}%；误报 ${falsePositives.length}`);
for (const m of misses) console.log(`  ✗ ${m}`);
for (const f of falsePositives) console.log(`  ! ${f}`);
for (const u of uncovered) console.log(`  ? ${u}`);
console.log(`报告已写入 ${out}`);

// 通过：静态子集召回=100% 且无误报。（browser_covered 由 acceptance 决定是否算完整通过）
process.exit(recall === 1 && falsePositives.length === 0 ? 0 : 1);
