// 视口初始化回归（规范 27.9 复审修正 P1 / 24.4）：截图必须让页面在目标视口下**初始化**
// ——先按默认宽加载再缩放会让依赖初始化宽度的响应式页面（JS 断点、一次性布局）产生错误证据。
// 测法：探针页在解析时把 body 高度设为 innerWidth×10，截图后解析 PNG IHDR 尺寸即可读出
// 初始化宽度（375 初始化 → 高 3750；若先按 1280/640 加载再缩放 → 高 12800/6400，立刻穿帮）。
// 依赖真实浏览器：不可用时显式 skip（诚实降级，不假通过），本机环境应保持可用。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { probeBrowser } from "../lib/browser.mjs";

const SCRIPTS = resolve(import.meta.dirname, "..");
const probe = await probeBrowser();

// 探针页：初始化宽度 → 内容高度（margin/padding 归零保证 fullPage 高度 = body 高度）
const PROBE_HTML = `<html lang="zh"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head>
<body><script>document.body.style.height = (window.innerWidth * 10) + "px";</script></body></html>`;

function makePkg() {
  const dir = mkdtempSync(join(tmpdir(), "vp-init-"));
  mkdirSync(join(dir, "prototype"), { recursive: true });
  writeFileSync(join(dir, "prototype", "index.html"), PROBE_HTML);
  return dir;
}

function pngSize(path) {
  const b = readFileSync(path); // PNG 签名 8B + IHDR 块头 8B → 宽高各 4B 大端
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

test("screenshot.mjs：三视口各自按目标宽度初始化（PNG 高度 = 初始化宽度×10）", async (t) => {
  if (!probe.available) return t.skip(`浏览器不可用（${probe.error}）——本机应修复环境而非依赖降级`);
  const dir = makePkg();
  const r = spawnSync("node", [join(SCRIPTS, "screenshot.mjs"), "--package", dir, "--round", "1"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = join(dir, "audit", "iterations", "round-1");
  for (const [label, w] of [["mobile-375", 375], ["tablet-768", 768], ["desktop-1440", 1440]]) {
    const s = pngSize(join(out, `index.html.${label}.png`));
    assert.equal(s.width, w, `${label} 截图宽度`);
    assert.equal(s.height, w * 10, `${label} 初始化宽度应为 ${w}（高 ${w * 10}），实际初始化宽度 ${s.height / 10}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("browser-check.mjs：桌面/移动截图均在目标视口下 reload 后拍摄", async (t) => {
  if (!probe.available) return t.skip(`浏览器不可用（${probe.error}）——本机应修复环境而非依赖降级`);
  const dir = makePkg();
  // 探针页可能带无障碍违规（退出码 1 属正常），本测试只断言截图证据的初始化宽度
  spawnSync("node", [join(SCRIPTS, "browser-check.mjs"), "--package", dir, "--version", "1"], { encoding: "utf8" });
  const shots = join(dir, "audit", "screenshots");
  const d = pngSize(join(shots, "index.html.desktop.png"));
  assert.deepEqual(d, { width: 1280, height: 12800 }, `desktop 初始化宽度 ${d.height / 10}，应为 1280`);
  const m = pngSize(join(shots, "index.html.mobile.png"));
  assert.deepEqual(m, { width: 375, height: 3750 }, `mobile 初始化宽度 ${m.height / 10}，应为 375（640/1280 初始化即为复审指出的旧缺陷）`);
  rmSync(dir, { recursive: true, force: true });
});
