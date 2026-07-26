// 冻结规则绑定测试（分层扩展 §10.4 / §10.5）。文件系统相关用 /tmp 临时目录搭最小快照。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import { loadFrozenRules, activationGateIssues, MIGRATION_HINT } from "../lib/frozen-rules.mjs";
import { canonicalRuleHash } from "../lib/rule-packs.mjs";
import { semanticIssuesStandards } from "../lib/findings.mjs";
import { naCandidates } from "../lib/na-scan.mjs";

// —— 合成夹具：最小冻结快照 ——

const CARD = (id, extra = {}) => ({
  id, title: id, rule: "r", publisher: "P", source_url: `https://w3.org/${id}`,
  source_version: "v1", last_verified: "2026-07-25", platforms: ["web"],
  scope: ["x"], strength: "recommended", evidence_grade: "B", rationale: "r", check_method: "manual", ...extra,
});

// 在临时目录下搭 audit/snapshots/<v>/rules/，返回包根路径。
function makeSnapshot(version, cards, { scopeExtra = {}, mutate = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "frozen-rules-"));
  const rulesDir = join(root, "audit", "snapshots", String(version), "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "f.yaml"), yaml.dump({ rules: cards }));
  const manifest = {
    artifact_version: String(version),
    generated_at: new Date().toISOString(),
    rules: cards.map((c) => ({ rule_id: c.id, pack_id: "pack-x", file: "f.yaml", sha256: canonicalRuleHash(c) })),
  };
  writeFileSync(join(rulesDir, "rules-manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(rulesDir, "review-scope.yaml"), yaml.dump({
    artifact_version: String(version), platforms: ["web"], industry: null, reference_system: "none",
    activated_rule_ids: cards.map((c) => c.id), rule_coverage_template: [], ...scopeExtra,
  }));
  mutate(rulesDir);
  return root;
}

test("正向：完好快照 loadFrozenRules 通过，cards/manifest/scope 齐备", () => {
  const root = makeSnapshot("2", [CARD("r-a"), CARD("r-b")]);
  const r = loadFrozenRules(root, "2");
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.deepEqual(r.cards.map((c) => c.id), ["r-a", "r-b"]);
  assert.equal(r.cards[0]._file, "f.yaml");
  assert.equal(r.manifest.rules.length, 2);
  assert.equal(r.scope.reference_system, "none");
  rmSync(root, { recursive: true, force: true });
});

test("篡改快照卡内容（哈希漂移）→ loadFrozenRules 拒绝", () => {
  const root = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const doc = yaml.load(readFileSync(join(rulesDir, "f.yaml"), "utf8"));
      doc.rules[0].rule = "被悄悄放宽的要求";
      writeFileSync(join(rulesDir, "f.yaml"), yaml.dump(doc));
    },
  });
  const r = loadFrozenRules(root, "2");
  assert.ok(!r.ok && r.errors.some((e) => e.includes("哈希漂移") && e.includes("r-a")));
  rmSync(root, { recursive: true, force: true });
});

test("快照 rules/ 塞入 manifest 未登记的卡 → 拒绝", () => {
  const root = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const doc = yaml.load(readFileSync(join(rulesDir, "f.yaml"), "utf8"));
      doc.rules.push(CARD("r-smuggled"));
      writeFileSync(join(rulesDir, "f.yaml"), yaml.dump(doc));
    },
  });
  const r = loadFrozenRules(root, "2");
  assert.ok(!r.ok && r.errors.some((e) => e.includes("未登记的卡") && e.includes("r-smuggled")));
  rmSync(root, { recursive: true, force: true });
});

test("manifest artifact_version 与快照版本不符 / 引用缺失文件 → 拒绝", () => {
  const wrongV = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) {
      const m = JSON.parse(readFileSync(join(rulesDir, "rules-manifest.json"), "utf8"));
      m.artifact_version = "1";
      writeFileSync(join(rulesDir, "rules-manifest.json"), JSON.stringify(m));
    },
  });
  assert.ok(!loadFrozenRules(wrongV, "2").ok);
  rmSync(wrongV, { recursive: true, force: true });

  const ghost = makeSnapshot("2", [CARD("r-a")], {
    mutate(rulesDir) { rmSync(join(rulesDir, "f.yaml")); },
  });
  const r = loadFrozenRules(ghost, "2");
  assert.ok(!r.ok && r.errors.some((e) => e.includes("f.yaml")));
  rmSync(ghost, { recursive: true, force: true });
});

// —— §10.5 存量迁移 ——

test("缺 rules/ 的历史快照 → 迁移提示措辞（含「需要迁移后重验」，不含「非法」）", () => {
  const root = mkdtempSync(join(tmpdir(), "frozen-rules-legacy-"));
  mkdirSync(join(root, "audit", "snapshots", "1"), { recursive: true }); // 旧版快照无 rules/
  const r = loadFrozenRules(root, "1");
  assert.ok(!r.ok);
  const text = r.errors.join(" ");
  assert.ok(text.includes("需要迁移后重验"), `措辞须含迁移提示，实际: ${text}`);
  assert.ok(text.includes("历史 delivered 结论不因此失效"));
  assert.ok(!text.includes("非法"), "不得写成历史交付非法");
  rmSync(root, { recursive: true, force: true });
});

// —— 冻结集 vs 仓库规则库漂移 ——

test("快照后往依据库加规则不改变旧快照适用集：语义校验仍以冻结集为准", () => {
  const frozenCards = [CARD("r-a"), CARD("r-b")];
  const root = makeSnapshot("2", frozenCards);
  const { cards } = loadFrozenRules(root, "2");
  // 仓库随后新增 r-new（web 平台，若现算会进入适用集）——但校验用冻结 cards，不要求覆盖 r-new。
  const doc = {
    reviewer: "standards", artifact_version: "2", verdict: "pass", findings: [],
    rule_coverage: cards.map((c) => ({
      rule_id: c.id, result: "pass", checked_via: "code",
      evidence: `已核查 ${c.id}：index.html 实测合格（示例 4.8:1）`,
    })),
  };
  assert.deepEqual(semanticIssuesStandards(doc, cards), []);
  // 反向：coverage 引用仓库新增而冻结集没有的规则 → 拒（评审引用当前仓库规则而非冻结规则）。
  const withNew = { ...doc, rule_coverage: [...doc.rule_coverage, { rule_id: "r-new", result: "pass", checked_via: "code", evidence: "引用了快照外的新规则xxxx" }] };
  assert.ok(semanticIssuesStandards(withNew, cards).some((s) => s.includes("适用规则集外") && s.includes("r-new")));
  rmSync(root, { recursive: true, force: true });
});

test("「规则包激活」门：注册表升级（新增激活规则）后正确报不一致并提示升版重评", () => {
  const packs = [{ id: "pack-x", kind: "foundation", files: ["f.yaml"], activation: { type: "always" }, allowed_source_hosts: ["w3.org"] }];
  const rules = [{ ...CARD("r-a"), _file: "f.yaml" }, { ...CARD("r-b"), _file: "f.yaml" }];
  const project = { platforms: ["web"], reference_system: "none" };
  const manifest = { rules: [{ rule_id: "r-a", pack_id: "pack-x", file: "f.yaml" }, { rule_id: "r-b", pack_id: "pack-x", file: "f.yaml" }] };
  const scope = { platforms: ["web"], industry: null, reference_system: "none" };
  // 一致：无问题。
  assert.deepEqual(activationGateIssues(project, manifest, scope, rules, packs), []);
  // 快照后规则库升级：新增 r-c → 重算集多一条，门 fail 且提示升版重新 snapshot。
  const upgraded = [...rules, { ...CARD("r-c"), _file: "f.yaml" }];
  const issues = activationGateIssues(project, manifest, scope, upgraded, packs);
  assert.ok(issues.some((s) => s.includes("规则库已升级") && s.includes("重新 snapshot")));
  // context 漂移（换平台）也报不一致。
  const drift = activationGateIssues({ ...project, platforms: ["web", "ios"] }, manifest, scope, rules, packs);
  assert.ok(drift.some((s) => s.includes("review-scope.platforms")));
});

// —— N/A 候选扫描 ——

test("naCandidates：无 table/@font-face 时给出两条候选；存在时不提示", () => {
  const root = mkdtempSync(join(tmpdir(), "na-scan-"));
  const proto = join(root, "prototype");
  mkdirSync(proto, { recursive: true });
  writeFileSync(join(proto, "index.html"), "<!doctype html><html><body><p>hi</p></body></html>");
  const na = naCandidates(proto);
  assert.equal(na.get("web-data-table-semantics"), "原型无数据表元素（全部 html 无 <table）");
  assert.ok(na.has("web-font-display-swap"));

  writeFileSync(join(proto, "data.html"), "<html><body><table><tr><td>1</td></tr></table><style>@font-face{font-family:x}</style></body></html>");
  const na2 = naCandidates(proto);
  assert.ok(!na2.has("web-data-table-semantics"));
  assert.ok(!na2.has("web-font-display-swap"));
  rmSync(root, { recursive: true, force: true });
});

test("naCandidates：目录不存在或无 html → 空 Map（不猜）", () => {
  assert.equal(naCandidates("/tmp/definitely-not-here-xyz").size, 0);
  const root = mkdtempSync(join(tmpdir(), "na-scan-empty-"));
  assert.equal(naCandidates(root).size, 0);
  rmSync(root, { recursive: true, force: true });
});
