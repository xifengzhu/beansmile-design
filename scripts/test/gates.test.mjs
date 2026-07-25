// 门禁语义测试：确认门状态机 + visual findings 八维证据纪律。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateStageTransition } from "../lib/context.mjs";
import { semanticIssuesVisual, DIMENSIONS } from "../lib/findings.mjs";
import { sha256File } from "../lib/hash.mjs";

// —— 确认门 ——

test("专业模式：缺确认记录时禁止推进对应阶段", () => {
  assert.equal(validateStageTransition("research", "ux", "professional", {}).ok, false);
  assert.equal(validateStageTransition("ux", "visual", "professional", { confirmations: {} }).ok, false);
  assert.equal(validateStageTransition("visual", "prototype", "professional", { confirmations: {} }).ok, false);
});

test("专业模式：有确认记录时放行", () => {
  const ctx = {
    confirmations: {
      requirements: { summary: "s", user_reply: "确认" },
      flows: { summary: "s", user_reply: "确认" },
      direction: { summary: "s", user_reply: "选 D3", candidates: ["D1", "D3"], chosen: "D3" },
    },
  };
  assert.equal(validateStageTransition("research", "ux", "professional", ctx).ok, true);
  assert.equal(validateStageTransition("ux", "visual", "professional", ctx).ok, true);
  assert.equal(validateStageTransition("visual", "prototype", "professional", ctx).ok, true);
});

test("direction 门：候选 <2 或 chosen 不在候选中 → 拒绝", () => {
  const one = { confirmations: { direction: { summary: "s", user_reply: "r", candidates: ["D1"], chosen: "D1" } } };
  assert.equal(validateStageTransition("visual", "prototype", "professional", one).ok, false);
  const bad = { confirmations: { direction: { summary: "s", user_reply: "r", candidates: ["D1", "D2"], chosen: "D9" } } };
  assert.equal(validateStageTransition("visual", "prototype", "professional", bad).ok, false);
});

test("快速模式不设确认门；未传 ctx 时不误伤（兼容旧调用）", () => {
  assert.equal(validateStageTransition("intake", "prototype", "quick", {}).ok, true);
  assert.equal(validateStageTransition("research", "ux", "professional").ok, true);
});

// —— visual 八维证据纪律 ——

function makePkgWithShot() {
  const dir = mkdtempSync(join(tmpdir(), "bsd-vis-"));
  mkdirSync(join(dir, "audit", "screenshots"), { recursive: true });
  const shot = join(dir, "audit", "screenshots", "index.desktop.png");
  writeFileSync(shot, "PNGDATA");
  return { dir, shotRel: "audit/screenshots/index.desktop.png", shotSha: sha256File(shot) };
}

function fullDoc({ shotRel, shotSha }) {
  return {
    reviewer: "visual",
    artifact_version: "1",
    verdict: "pass",
    findings: [
      { id: "v-w-1", severity: "warning", dimension: "brand", location: "index.html hero",
        evidence: "主色 #1b4dd1 仅出现 1 处，方向 D3 的关键手法 0 处落地", user_impact: "无记忆点", recommendation: "落地 ≥2 处关键手法" },
    ],
    dimension_reviews: DIMENSIONS.map((d) => ({
      dimension: d,
      screenshot: shotRel,
      screenshot_sha256: shotSha,
      region: "全页 x=0,y=0,w=1440",
      observed: d === "brand" ? "主色 #1b4dd1 出现 1 处，关键手法 0 处" : `实测 gap=24px，字号 16px（维度 ${d}）`,
      judgment: d === "brand" ? "warning" : "pass",
    })),
  };
}

test("完整八维 + 截图哈希匹配 + 含实测值 → 无语义问题", () => {
  const pkg = makePkgWithShot();
  assert.deepEqual(semanticIssuesVisual(fullDoc(pkg), pkg.dir), []);
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("缺维度 → 报缺", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.dimension_reviews = doc.dimension_reviews.slice(0, 6);
  const issues = semanticIssuesVisual(doc, pkg.dir);
  assert.ok(issues.some((s) => s.includes("缺维度")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("截图哈希不匹配（引用的不是盘上这张图）→ 拒绝", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.dimension_reviews[0].screenshot_sha256 = "0".repeat(64);
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("哈希不匹配")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("observed 无实测数值 → 拒绝（\"感觉不错\"不合格）", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.dimension_reviews[1].observed = "层级清晰、版式节奏一致、品牌方向克制可信、完成度很好";
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("无任何实测数值")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("judgment=warning 但无同维度 finding → 拒绝（判定与 findings 脱钩）", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.findings = [];
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("无同维度")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("warning/blocker 的 evidence 无数值 → 拒绝", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.findings[0].evidence = "感觉品牌感不强";
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("evidence 无实测数值")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

// —— 证据多样性（规范 24.2）——

function makePkgWithTwoShots() {
  const pkg = makePkgWithShot();
  const shot2 = join(pkg.dir, "audit", "screenshots", "index.mobile.png");
  writeFileSync(shot2, "PNGDATA-MOBILE");
  return { ...pkg, shot2Rel: "audit/screenshots/index.mobile.png", shot2Sha: sha256File(shot2) };
}

test("有 ≥2 张截图可用但八维全引用同一张 → 拒绝（未逐维看图）", () => {
  const pkg = makePkgWithTwoShots();
  const doc = fullDoc(pkg); // 八维全引用 desktop 一张
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("全部引用同一张截图")));
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("八维引用 ≥2 张不同截图 → 不误伤", () => {
  const pkg = makePkgWithTwoShots();
  const doc = fullDoc(pkg);
  doc.dimension_reviews[0].screenshot = pkg.shot2Rel;
  doc.dimension_reviews[0].screenshot_sha256 = pkg.shot2Sha;
  assert.deepEqual(semanticIssuesVisual(doc, pkg.dir), []);
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("包内仅 1 张截图时八维同图不误伤（单图包降级为哈希匹配）", () => {
  const pkg = makePkgWithShot();
  assert.deepEqual(semanticIssuesVisual(fullDoc(pkg), pkg.dir), []);
  rmSync(pkg.dir, { recursive: true, force: true });
});

test("observed 模板化复制（两维文本完全相同）→ 拒绝", () => {
  const pkg = makePkgWithShot();
  const doc = fullDoc(pkg);
  doc.dimension_reviews[2].observed = doc.dimension_reviews[1].observed;
  assert.ok(semanticIssuesVisual(doc, pkg.dir).some((s) => s.includes("模板化复制")));
  rmSync(pkg.dir, { recursive: true, force: true });
});
