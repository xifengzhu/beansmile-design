// 紧凑评审规则包测试（规范 27.4）。正向：确定性、投影完整、老快照兼容；
// 对抗：改一字/增删条目/state 漂移 → 再生比对拒绝；v1.8 快照删 bundle → 拒绝。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { buildReviewBundle, bundleIssues, BUNDLE_PROJECTED_FIELDS } from "../lib/review-bundle.mjs";
import { loadFrozenRules } from "../lib/frozen-rules.mjs";
import { canonicalRuleHash } from "../lib/rule-packs.mjs";

const CARD = (id, extra = {}) => ({
  id, title: `标题 ${id}`, rule: `要求正文 ${id}`, publisher: "W3C", source_url: `https://w3.org/${id}`,
  source_version: "v1", last_verified: "2026-07-25", platforms: ["web"],
  scope: ["form"], strength: "must", evidence_grade: "A", rationale: "内部理由", check_method: "manual", ...extra,
});

const rowOf = (c, extra = {}) => ({
  rule_id: c.id, pack_id: "pack-x", rule_sha256: canonicalRuleHash(c),
  expected_check_method: c.check_method, state: "review_required",
  result: null, checked_via: null, evidence: null,
  not_applicable_candidate: { value: false, reason: null }, ...extra,
});

test("正向：同输入两次构建字节相同；含全部适用 id 且按 rule_id 排序；投影剔除溯源字段", () => {
  const cards = [CARD("r-b", { exceptions: ["装饰性图片除外"] }), CARD("r-a")];
  const template = cards.map((c) => rowOf(c));
  const t1 = buildReviewBundle({ cards, template, version: "3" });
  const t2 = buildReviewBundle({ cards, template, version: "3" });
  assert.equal(t1, t2);
  const doc = yaml.load(t1);
  assert.equal(doc.artifact_version, "3");
  assert.deepEqual(doc.rules.map((r) => r.rule_id), ["r-a", "r-b"]);
  for (const r of doc.rules) {
    for (const f of ["publisher", "source_url", "source_version", "last_verified", "rationale", "evidence_grade", "conflicts_with"]) {
      assert.ok(!(f in r), `溯源字段 ${f} 不得进入 bundle`);
    }
    for (const f of BUNDLE_PROJECTED_FIELDS) assert.ok(f in r, `缺投影字段 ${f}`);
  }
  assert.deepEqual(doc.rules[1].exceptions, ["装饰性图片除外"]);
  assert.equal(doc.stats.total, 2);
});

test("正向：na_candidate 与 prefilled state 随模板行进入 bundle", () => {
  const c = CARD("r-a");
  const doc = yaml.load(buildReviewBundle({
    cards: [c],
    template: [rowOf(c, { state: "prefilled_automated", not_applicable_candidate: { value: true, reason: "无表格" } })],
    version: "1",
  }));
  assert.equal(doc.rules[0].state, "prefilled_automated");
  assert.deepEqual(doc.rules[0].na_candidate, { value: true, reason: "无表格" });
  assert.equal(doc.stats.prefilled_automated, 1);
  assert.equal(doc.stats.not_applicable_candidates, 1);
});

// —— loadFrozenRules 集成（文件系统夹具）——

function makeSnapshot(version, cards, { snapshotVersion = 2, writeBundle = true, mutate = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "review-bundle-"));
  const rulesDir = join(root, "audit", "snapshots", String(version), "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "f.yaml"), yaml.dump({ rules: cards }));
  const template = cards.map((c) => rowOf(c));
  const manifest = {
    artifact_version: String(version),
    ...(snapshotVersion ? { snapshot_version: snapshotVersion } : {}),
    generated_at: new Date().toISOString(),
    rules: cards.map((c) => ({ rule_id: c.id, pack_id: "pack-x", file: "f.yaml", sha256: canonicalRuleHash(c) })),
  };
  writeFileSync(join(rulesDir, "rules-manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(rulesDir, "review-scope.yaml"), yaml.dump({
    artifact_version: String(version), platforms: ["web"], industry: null, reference_system: "none",
    activated_rule_ids: cards.map((c) => c.id), rule_coverage_template: template,
  }));
  if (writeBundle) writeFileSync(join(rulesDir, "review-bundle.yaml"), buildReviewBundle({ cards, template, version: String(version) }));
  mutate(rulesDir);
  return root;
}

test("正向：v1.8 快照 bundle 完好 → loadFrozenRules 通过且返回解析后的 bundle", () => {
  const root = makeSnapshot("2", [CARD("r-a"), CARD("r-b")]);
  const r = loadFrozenRules(root, "2");
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.bundle.rules.length, 2);
  rmSync(root, { recursive: true, force: true });
});

test("兼容：v1.7 老快照（无 snapshot_version、无 bundle）→ 仍 ok，bundle=null 回退读全卡", () => {
  const root = makeSnapshot("2", [CARD("r-a")], { snapshotVersion: null, writeBundle: false });
  const r = loadFrozenRules(root, "2");
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.bundle, null);
  rmSync(root, { recursive: true, force: true });
});

test("对抗：改 bundle 中规则正文一个字 → 再生比对判篡改", () => {
  const root = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const p = join(rulesDir, "review-bundle.yaml");
      writeFileSync(p, readFileSync(p, "utf8").replace("要求正文 r-a", "被软化的要求 r-a"));
    },
  });
  const r = loadFrozenRules(root, "2");
  assert.ok(!r.ok && r.errors.some((e) => e.includes("再生结果不符")), r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：bundle 增塞 manifest 外规则 / 删一条 → 再生比对判篡改", () => {
  const extra = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const p = join(rulesDir, "review-bundle.yaml");
      const doc = yaml.load(readFileSync(p, "utf8"));
      doc.rules.push({ rule_id: "r-smuggled", pack_id: "pack-x", rule_sha256: "0".repeat(64), state: "review_required", title: "私货", rule: "私货", check_method: "manual", platforms: ["web"], scope: ["x"], strength: "must" });
      writeFileSync(p, yaml.dump(doc));
    },
  });
  assert.ok(!loadFrozenRules(extra, "2").ok);
  rmSync(extra, { recursive: true, force: true });

  const removed = makeSnapshot("2", [CARD("r-a"), CARD("r-b")], {
    mutate(rulesDir) {
      const p = join(rulesDir, "review-bundle.yaml");
      const doc = yaml.load(readFileSync(p, "utf8"));
      doc.rules = doc.rules.filter((r) => r.rule_id !== "r-b");
      writeFileSync(p, yaml.dump(doc));
    },
  });
  assert.ok(!loadFrozenRules(removed, "2").ok);
  rmSync(removed, { recursive: true, force: true });
});

test("对抗：v1.8 快照（snapshot_version=2）删除 bundle → 拒绝（防降级逼评审读全库）", () => {
  const root = makeSnapshot("2", [CARD("r-a")], { writeBundle: false });
  const r = loadFrozenRules(root, "2");
  assert.ok(!r.ok && r.errors.some((e) => e.includes("缺 rules/review-bundle.yaml")), r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("对抗：state 与覆盖模板不符（bundle 谎称已自动预填）→ 再生比对判篡改", () => {
  const root = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const p = join(rulesDir, "review-bundle.yaml");
      writeFileSync(p, readFileSync(p, "utf8").replace("state: review_required", "state: prefilled_automated"));
    },
  });
  assert.ok(!loadFrozenRules(root, "2").ok);
  rmSync(root, { recursive: true, force: true });
});
