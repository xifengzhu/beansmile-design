// 共享样式抽取门测试（规范 27.2）。/tmp 临时目录搭最小 prototype/ 夹具。
// 边界哲学同 24.5：只封规范化后逐字节重复的零成本复制，AST 级相似度刻意不做。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sharedCssIssues, normalizeCss, resolvesToAssets, DUP_MIN_CHARS } from "../lib/css-dup.mjs";

// 生成规范化后 ≥DUP_MIN_CHARS 的大段 CSS（每条声明不同，防止压缩塌缩）。
const BIG_CSS = Array.from({ length: 120 }, (_, i) => `.c${i}{margin:${i}px;padding:${i + 1}px;color:#0${(i % 10)}f}`).join("\n");
assert.ok(normalizeCss(BIG_CSS).length >= DUP_MIN_CHARS, "夹具自检：BIG_CSS 须超过阈值");
const SMALL_CSS = ".hero{color:#333}";

function makePkg(pages, { candidates = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "css-dup-"));
  for (const [name, html] of Object.entries(pages)) {
    const p = join(root, "prototype", name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, html);
  }
  if (candidates) {
    for (const [name, html] of Object.entries(candidates)) {
      const p = join(root, "audit", "candidates", name);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, html);
    }
  }
  return root;
}

const page = ({ link = "assets/styles.css", inline = "" } = {}) =>
  `<!doctype html><html><head>${link ? `<link rel="stylesheet" href="${link}">` : ""}${inline ? `<style>${inline}</style>` : ""}</head><body><main>x</main></body></html>`;

test("正向：多页共享 link + 各自 <2KB 私有内联 → 通过", () => {
  const root = makePkg({
    "index.html": page({ inline: SMALL_CSS }),
    "about.html": page({ inline: ".about{padding:4px}" }),
  });
  assert.deepEqual(sharedCssIssues(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("正向：单页大内联 → 豁免（单文件自包含合法）", () => {
  const root = makePkg({ "index.html": page({ link: null, inline: BIG_CSS }) });
  assert.deepEqual(sharedCssIssues(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("正向：子目录页面用 ../assets/ 相对路径引入共享样式 → 通过", () => {
  const root = makePkg({
    "index.html": page(),
    "web/flow.html": page({ link: "../assets/styles.css" }),
  });
  assert.deepEqual(sharedCssIssues(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：两页各内联同一份 ≥2KB 样式 → fail（即便都有共享 link）", () => {
  const root = makePkg({
    "index.html": page({ inline: BIG_CSS }),
    "about.html": page({ inline: BIG_CSS }),
  });
  const issues = sharedCssIssues(root);
  assert.ok(issues.some((s) => s.includes("重复出现在 2 页")), issues.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：同内容但注释与空白不同（规范化后仍同一）→ fail", () => {
  const disguised = `/* 页面B专属（其实是复制的） */\n  ${BIG_CSS.replaceAll("\n", "\n\n\t ")}`;
  const root = makePkg({
    "index.html": page({ inline: BIG_CSS }),
    "about.html": page({ inline: disguised }),
  });
  assert.ok(sharedCssIssues(root).some((s) => s.includes("重复出现在 2 页")));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：一字符实质差异 → 机器门放行（exact-dup 是机器边界，伪差异归评审）", () => {
  const root = makePkg({
    "index.html": page({ inline: BIG_CSS }),
    "about.html": page({ inline: BIG_CSS.replace("margin:1px", "margin:2px") }),
  });
  assert.deepEqual(sharedCssIssues(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：三页中一页未引入 assets/ 共享样式 → fail 并点名该页", () => {
  const root = makePkg({
    "index.html": page(),
    "about.html": page(),
    "pricing.html": page({ link: null, inline: SMALL_CSS }),
  });
  const issues = sharedCssIssues(root);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes("pricing.html") && issues[0].includes("assets/"));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：link 指向 assets/ 外或外链 → 不算共享抽取", () => {
  const root = makePkg({
    "index.html": page({ link: "styles.css" }),
    "about.html": page({ link: "https://cdn.example.com/styles.css" }),
  });
  assert.equal(sharedCssIssues(root).length, 2);
  rmSync(root, { recursive: true, force: true });
});

test("candidates 目录不受检（候选单文件自包含合法）", () => {
  const root = makePkg(
    { "index.html": page({ inline: SMALL_CSS }) }, // 单页原型
    { candidates: { "cand-1/key.html": page({ link: null, inline: BIG_CSS }), "cand-2/key.html": page({ link: null, inline: BIG_CSS }) } },
  );
  assert.deepEqual(sharedCssIssues(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("resolvesToAssets：路径解析边界（越出根 / 查询串 / 协议头）", () => {
  assert.ok(resolvesToAssets("index.html", "assets/styles.css"));
  assert.ok(resolvesToAssets("web/flow.html", "../assets/styles.css"));
  assert.ok(resolvesToAssets("index.html", "assets/styles.css?v=2"));
  assert.ok(!resolvesToAssets("index.html", "../assets/styles.css")); // 越出 prototype/ 根
  assert.ok(!resolvesToAssets("index.html", "https://x.com/assets/a.css"));
  assert.ok(!resolvesToAssets("index.html", "assets/styles.js"));
  assert.ok(!resolvesToAssets("index.html", undefined));
});
