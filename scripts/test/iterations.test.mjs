// 增量截图携带链测试（规范 27.3）。/tmp 夹具造多轮 meta，覆盖 planIncremental
// 纯函数与 iterationChainIssues 验收判定；对抗面：谎称未变（哈希链断裂）、转引、
// 首末轮含 carried、引用轮缺图、meta 内部自相矛盾。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planIncremental, iterationChainIssues, expectedShots } from "../lib/iterations.mjs";
import { pageSlug } from "../lib/pages.mjs";
import { sha256Text } from "../lib/hash.mjs";

const H = (s) => sha256Text(s);
const PAGES = [{ name: "index.html" }, { name: "about.html" }, { name: "case.html" }];
const NOTES = (shot) => `本轮自评：对照 polish-checklist 检查了对齐与层级，命中 2 项已修复，见 ${shot}。`;

// —— planIncremental 纯函数 ——

const prevV2 = (hashes, { tokens = "t1", pages = null } = {}) => ({
  meta_version: 2, round: 1, page_hashes: hashes, tokens_sha256: tokens,
  pages: pages ?? PAGES.map((p) => ({ name: p.name, slug: pageSlug(p.name), status: "shot", shots: expectedShots(pageSlug(p.name)) })),
});

test("planIncremental：仅 1 页变更 → 该页 shot，其余 carried 且 from_round=上一轮", () => {
  const prev = { "prototype/index.html": H("a"), "prototype/about.html": H("b"), "prototype/case.html": H("c") };
  const cur = { ...prev, "prototype/index.html": H("a2") };
  const plan = planIncremental({ prevMeta: prevV2(prev), prevRound: 1, currentHashes: cur, tokensSha256: "t1", pages: PAGES, pageSlug });
  assert.equal(plan.full, false);
  assert.deepEqual(plan.changed.map((p) => p.name), ["index.html"]);
  assert.deepEqual(plan.carried.map((e) => [e.name, e.from_round]), [["about.html", 1], ["case.html", 1]]);
  assert.equal(plan.carried[0].page_sha256, H("b"));
});

test("planIncremental：assets/ 或 design-tokens 变化 → 保守全量；上一轮 v1 meta → 全量", () => {
  const prev = { "prototype/index.html": H("a"), "prototype/assets/styles.css": H("css"), "prototype/about.html": H("b") };
  const assetsChanged = planIncremental({
    prevMeta: prevV2(prev), prevRound: 1,
    currentHashes: { ...prev, "prototype/assets/styles.css": H("css2") },
    tokensSha256: "t1", pages: PAGES.slice(0, 2), pageSlug,
  });
  assert.ok(assetsChanged.full && assetsChanged.reason.includes("共享资源"));
  const tokensChanged = planIncremental({ prevMeta: prevV2(prev), prevRound: 1, currentHashes: prev, tokensSha256: "t2", pages: PAGES.slice(0, 2), pageSlug });
  assert.ok(tokensChanged.full && tokensChanged.reason.includes("design-tokens"));
  const v1prev = planIncremental({ prevMeta: { round: 1, page_hashes: prev }, prevRound: 1, currentHashes: prev, tokensSha256: "t1", pages: PAGES.slice(0, 2), pageSlug });
  assert.ok(v1prev.full && v1prev.reason.includes("v1 meta"));
});

test("planIncremental：上一轮已 carried 的页再 carried → from_round 直通实拍轮（禁转引链）", () => {
  const hashes = { "prototype/index.html": H("a"), "prototype/about.html": H("b"), "prototype/case.html": H("c") };
  const prev = prevV2(hashes, {
    pages: [
      { name: "index.html", slug: "index.html", status: "shot", shots: expectedShots("index.html") },
      { name: "about.html", slug: "about.html", status: "carried", from_round: 1, page_sha256: H("b"), shots: expectedShots("about.html") },
      { name: "case.html", slug: "case.html", status: "shot", shots: expectedShots("case.html") },
    ],
  });
  prev.round = 2;
  const cur = { ...hashes, "prototype/case.html": H("c2") };
  const plan = planIncremental({ prevMeta: prev, prevRound: 2, currentHashes: cur, tokensSha256: "t1", pages: PAGES, pageSlug });
  const about = plan.carried.find((e) => e.name === "about.html");
  const index = plan.carried.find((e) => e.name === "index.html");
  assert.equal(about.from_round, 1); // 直通 round-1 的实拍，不指向 round-2 的 carried
  assert.equal(index.from_round, 2);
});

// —— iterationChainIssues 验收判定（文件系统夹具）——

// rounds: [{ n, meta, files: {文件名: 内容}, notes }]
function makePkg(rounds, activeHashes) {
  const root = mkdtempSync(join(tmpdir(), "iters-"));
  for (const r of rounds) {
    const rd = join(root, "audit", "iterations", `round-${r.n}`);
    mkdirSync(rd, { recursive: true });
    if (r.meta !== null) writeFileSync(join(rd, "meta.json"), JSON.stringify(r.meta, null, 2));
    for (const [f, c] of Object.entries(r.files ?? {})) writeFileSync(join(rd, f), c);
    if (r.notes !== null) writeFileSync(join(rd, "notes.md"), r.notes ?? NOTES(Object.keys(r.files ?? {})[0] ?? "x.png"));
  }
  return { root, activeHashes };
}

const pngFiles = (names) => Object.fromEntries(names.flatMap((n) => expectedShots(pageSlug(n)).map((s) => [s, "png"])));

// 标准三轮夹具：round1 全量 → round2 增量（index 变，about carried）→ round3 全量收官。
function threeRounds({ mutate = () => {} } = {}) {
  const pages2 = ["index.html", "about.html"];
  const h1 = { "prototype/index.html": H("i1"), "prototype/about.html": H("a1") };
  const h2 = { "prototype/index.html": H("i2"), "prototype/about.html": H("a1") };
  const h3 = { "prototype/index.html": H("i3"), "prototype/about.html": H("a1") };
  const full = (n, hashes) => ({
    meta_version: 2, round: n, page_hashes: hashes, tokens_sha256: "t",
    pages: pages2.map((p) => ({ name: p, slug: p, status: "shot", shots: expectedShots(p) })),
    shots: pages2.flatMap((p) => expectedShots(p)),
  });
  const r2meta = {
    meta_version: 2, round: 2, page_hashes: h2, tokens_sha256: "t",
    pages: [
      { name: "about.html", slug: "about.html", status: "carried", from_round: 1, page_sha256: H("a1"), shots: expectedShots("about.html") },
      { name: "index.html", slug: "index.html", status: "shot", shots: expectedShots("index.html") },
    ],
    shots: expectedShots("index.html"),
  };
  const rounds = [
    { n: 1, meta: full(1, h1), files: pngFiles(pages2), notes: NOTES("index.html.mobile-375.png") },
    { n: 2, meta: r2meta, files: pngFiles(["index.html"]), notes: NOTES("index.html.desktop-1440.png") },
    { n: 3, meta: full(3, h3), files: pngFiles(pages2), notes: NOTES("about.html.mobile-375.png") },
  ];
  mutate(rounds);
  return makePkg(rounds, h3);
}

test("正向：全量→增量→全量收官，携带链完整 → 无 issue", () => {
  const { root, activeHashes } = threeRounds();
  const r = iterationChainIssues(root, activeHashes);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rounds, 3);
  rmSync(root, { recursive: true, force: true });
});

test("兼容：v1.7 老 meta（无 meta_version）按全量轮处理，不追溯 fail", () => {
  const h = { "prototype/index.html": H("i1") };
  const { root, activeHashes } = makePkg([
    { n: 1, meta: { round: 1, page_hashes: h, shots: ["index.html.mobile-375.png"] }, files: pngFiles(["index.html"]), notes: NOTES("index.html.mobile-375.png") },
    { n: 2, meta: { round: 2, page_hashes: h, shots: ["index.html.mobile-375.png"] }, files: pngFiles(["index.html"]), notes: NOTES("index.html.tablet-768.png") },
  ], h);
  assert.deepEqual(iterationChainIssues(root, activeHashes).problems, []);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：carried 页实际已变（当前轮哈希 ≠ 引用轮）→ 哈希链断裂 fail", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) {
      rounds[1].meta.page_hashes["prototype/about.html"] = H("a-偷偷改了");
      // 末轮/活动指纹同步，孤立测携带链本身
      rounds[2].meta.page_hashes["prototype/about.html"] = H("a-偷偷改了");
    },
  });
  const act = { "prototype/index.html": H("i3"), "prototype/about.html": H("a-偷偷改了") };
  const r = iterationChainIssues(root, act);
  assert.ok(r.problems.some((p) => p.includes("哈希链断裂") && p.includes("about.html")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：from_round 指向不存在轮 / 非法值 → fail", () => {
  const missing = threeRounds({ mutate(rounds) { rounds[1].meta.pages[0].from_round = 9; } });
  assert.ok(iterationChainIssues(missing.root, missing.activeHashes).problems.some((p) => p.includes("from_round 非法") || p.includes("round-9")));
  rmSync(missing.root, { recursive: true, force: true });
  const self = threeRounds({ mutate(rounds) { rounds[1].meta.pages[0].from_round = 2; } });
  assert.ok(iterationChainIssues(self.root, self.activeHashes).problems.some((p) => p.includes("from_round 非法")));
  rmSync(self.root, { recursive: true, force: true });
});

test("对抗：转引（引用轮中该页也是 carried）→ fail", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) {
      // 把 round-1 的 about 改成 carried（伪造：链头不是实拍）
      rounds[0].meta.pages = rounds[0].meta.pages.map((e) =>
        e.name === "about.html" ? { ...e, status: "carried", from_round: 0, page_sha256: H("a1") } : e);
    },
  });
  const r = iterationChainIssues(root, activeHashes);
  assert.ok(r.problems.some((p) => p.includes("禁转引")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：首轮或末轮含 carried → fail（首末轮必须全量）", () => {
  const lastCarried = threeRounds({
    mutate(rounds) {
      rounds[2].meta.pages = rounds[2].meta.pages.map((e) =>
        e.name === "about.html" ? { name: "about.html", slug: "about.html", status: "carried", from_round: 1, page_sha256: H("a1"), shots: expectedShots("about.html") } : e);
    },
  });
  assert.ok(iterationChainIssues(lastCarried.root, lastCarried.activeHashes).problems.some((p) => p.includes("末轮") && p.includes("必须全量")));
  rmSync(lastCarried.root, { recursive: true, force: true });
});

test("对抗：meta 登记 shots 但盘上无文件 / 引用轮缺该页截图 → fail", () => {
  const ghostShot = threeRounds({ mutate(rounds) { rounds[1].meta.shots.push("phantom.png"); } });
  assert.ok(iterationChainIssues(ghostShot.root, ghostShot.activeHashes).problems.some((p) => p.includes("phantom.png")));
  rmSync(ghostShot.root, { recursive: true, force: true });
  const srcMissing = threeRounds({ mutate(rounds) { delete rounds[0].files["about.html.tablet-768.png"]; } });
  assert.ok(iterationChainIssues(srcMissing.root, srcMissing.activeHashes).problems.some((p) => p.includes("round-1 缺截图 about.html.tablet-768.png")));
  rmSync(srcMissing.root, { recursive: true, force: true });
});

test("对抗：notes 只引用 carried 图（未引用当轮新截）→ fail", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) { rounds[1].notes = NOTES("about.html.mobile-375.png"); }, // about 是 carried
  });
  const r = iterationChainIssues(root, activeHashes);
  assert.ok(r.problems.some((p) => p.includes("当轮实际新截")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：pages[] 漏登记 page_hashes 中存在的页面 → 覆盖不全 fail（缺页不能算全量）", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) {
      // 末轮只登记并"截了" index.html，完全省略 about.html（复审探针形态）
      rounds[2].meta.pages = rounds[2].meta.pages.filter((e) => e.name === "index.html");
      rounds[2].meta.shots = expectedShots("index.html");
    },
  });
  const r = iterationChainIssues(root, activeHashes);
  assert.ok(r.problems.some((p) => p.includes("漏登记页面") && p.includes("about.html")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：pages[] 登记 page_hashes 外的幽灵页 → fail", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) {
      rounds[0].meta.pages.push({ name: "ghost.html", slug: "ghost.html", status: "shot", shots: expectedShots("ghost.html") });
    },
  });
  assert.ok(iterationChainIssues(root, activeHashes).problems.some((p) => p.includes("之外的页面") && p.includes("ghost.html")));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：实拍页缺一个视口截图 → fail（三视口缺一不构成全量证据）", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) {
      // meta.shots 同步瘦身（绕过 shots-在盘检查），但盘上少一张视口图
      delete rounds[2].files["about.html.tablet-768.png"];
      rounds[2].meta.shots = rounds[2].meta.shots.filter((s) => s !== "about.html.tablet-768.png");
    },
  });
  const r = iterationChainIssues(root, activeHashes);
  assert.ok(r.problems.some((p) => p.includes("缺视口截图 about.html.tablet-768.png")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：v1.8 包（requireV2）删除 meta_version 降级到 v1 路径 → fail", () => {
  const { root, activeHashes } = threeRounds({
    mutate(rounds) { delete rounds[1].meta.meta_version; },
  });
  // 不带 requireV2：v1 meta 按兼容路径放行（老包语义）
  assert.ok(!iterationChainIssues(root, activeHashes).problems.some((p) => p.includes("v1 兼容路径")));
  // 带 requireV2（v1.8 包）：降级即 fail
  const r = iterationChainIssues(root, activeHashes, { requireV2: true });
  assert.ok(r.problems.some((p) => p.includes("规避") && p.includes("round-2")), r.problems.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：末轮后原型又被改动（活动指纹漂移）→ fail（既有门保留）", () => {
  const { root } = threeRounds();
  const drifted = { "prototype/index.html": H("i4"), "prototype/about.html": H("a1") };
  assert.ok(iterationChainIssues(root, drifted).problems.some((p) => p.includes("又被改动")));
  rmSync(root, { recursive: true, force: true });
});
