#!/usr/bin/env node
// 冻结当前交付物到只读快照 audit/snapshots/<version>/（规范 5.3）。评审只对快照进行。
// version 须单调递增；目标已存在则拒绝（保证快照不可变）。
// 同时写入 manifest.json（逐文件 sha256 + 摘要指纹）：验收据此校验快照未被篡改、
// 评审窗口内活动产物未被改动（outputs/ 不入 git，git diff 对其永远为空，不可依赖）。
// 分层扩展 §8.3/§8.4：快照同时冻结激活规则集到 rules/（规则卡只读副本 + rules-manifest.json
// + review-scope.yaml 覆盖模板），评审与验收只读冻结集，规则库升级不追溯漂移。
// 规则冻结无浏览器依赖，恒定执行，无降级旗标。
// 用法: node scripts/snapshot.mjs --package <目录> --version <artifact_version>
import { cpSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { hashPaths, manifestDigest } from "./lib/hash.mjs";
import { loadYaml } from "./lib/context.mjs";
import { loadRules } from "./lib/rules.mjs";
import { loadRulePacks, applicableRules } from "./lib/rule-packs.mjs";
import { buildCoverageTemplate } from "./lib/coverage-template.mjs";
import { naCandidates } from "./lib/na-scan.mjs";
import { MIGRATION_HINT } from "./lib/frozen-rules.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), version = arg("--version");
if (!pkg || !version) { console.error("用法: node scripts/snapshot.mjs --package <目录> --version <v>"); process.exit(2); }
const root = resolve(pkg);
const snapRoot = join(root, "audit", "snapshots");
mkdirSync(snapRoot, { recursive: true });

// 先读 context 并求激活集——缺 reference_system 时按 §9.1 报迁移提示退出，不生成半套快照。
const ctxPath = join(root, "context.yaml");
if (!existsSync(ctxPath)) { console.error("✗ 缺 context.yaml，无法确定激活规则集"); process.exit(1); }
const project = loadYaml(ctxPath)?.project ?? {};
if (project.reference_system === undefined) {
  console.error(`✗ context.project 缺 reference_system —— ${MIGRATION_HINT}`);
  process.exit(1);
}
let applicable;
try {
  applicable = applicableRules(project, loadRules().rules, loadRulePacks().packs);
} catch (e) {
  console.error(`✗ 激活规则集计算失败: ${e.message}`);
  process.exit(1);
}

// 单调性：新版本号必须大于已有最大值
const existing = existsSync(snapRoot) ? readdirSync(snapRoot).filter((d) => /^\d+$/.test(d)).map(Number) : [];
if (existing.length && Number(version) <= Math.max(...existing)) {
  console.error(`✗ 版本 ${version} 不大于已有快照最大版本 ${Math.max(...existing)}，拒绝（须单调递增）`);
  process.exit(1);
}
const dest = join(snapRoot, String(version));
if (existsSync(dest)) { console.error(`✗ 快照 ${dest} 已存在，拒绝覆盖（快照不可变）`); process.exit(1); }
mkdirSync(dest, { recursive: true });

const items = ["prototype", "design-tokens.json", "decisions.md", "brief.md", "flows.md"];
const copied = [];
for (const it of items) {
  const src = join(root, it);
  if (existsSync(src)) { cpSync(src, join(dest, it), { recursive: true }); copied.push(it); }
}

// —— 冻结激活规则集（§8.4）——
const rulesDir = join(dest, "rules");
mkdirSync(rulesDir, { recursive: true });

// 每个来源文件只含激活卡的副本（结构保持 {rules:[...]}，卡逐字段原样、剔除 _file）。
const byFile = new Map();
for (const a of applicable) {
  if (!byFile.has(a.file)) byFile.set(a.file, []);
  const { _file, ...card } = a.rule;
  byFile.get(a.file).push(card);
}
for (const [file, cards] of byFile) {
  writeFileSync(join(rulesDir, file), yaml.dump({ rules: cards }, { lineWidth: 120 }));
}

// rules-manifest.json：激活集的规范化哈希登记（按 rule_id 排序，applicableRules 已排序）。
const rulesManifest = {
  artifact_version: String(version),
  generated_at: new Date().toISOString(),
  rules: applicable.map((a) => ({ rule_id: a.rule_id, pack_id: a.pack_id, file: a.file, sha256: a.rule_sha256 })),
};
writeFileSync(join(rulesDir, "rules-manifest.json"), JSON.stringify(rulesManifest, null, 2));

// 覆盖模板（§8.3）：自动预填只信与冻结原型同源、同版本的 results.json；N/A 候选扫描冻结原型。
const resultsPath = join(root, "audit", "results.json");
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : null;
const snapshotPrototypeHashes = hashPaths(dest, ["prototype"]);
const naMap = naCandidates(join(dest, "prototype"));
const { template, stats } = buildCoverageTemplate({
  applicable, results, snapshotPrototypeHashes, naMap, snapshotVersion: String(version),
});

const reviewScope = {
  artifact_version: String(version),
  platforms: project.platforms ?? [],
  industry: project.industry ?? null,
  reference_system: project.reference_system,
  activated_rule_ids: applicable.map((a) => a.rule_id),
  rule_coverage_template: template,
  stats,
};
writeFileSync(join(rulesDir, "review-scope.yaml"), yaml.dump(reviewScope, { lineWidth: 120 }));

// 内容哈希 manifest：以快照目录（而非活动目录）为准计算，保证 manifest 与快照内容严格对应。
// rules/ 在此之前已生成，一并纳入哈希清单（冻结规则也受不可变性保护）。
const manifest = {
  artifact_version: String(version),
  created_at: new Date().toISOString(),
  files: hashPaths(dest, [...copied, "rules"]),
};
manifest.digest = manifestDigest(manifest);
writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`✓ 已冻结快照 v${version} → ${dest}（含 ${copied.join(", ")}, rules）。评审仅授予此目录只读权限。`);
console.log(`  manifest.json：${Object.keys(manifest.files).length} 个文件，digest=${manifest.digest.slice(0, 16)}…`);
console.log(`  rules/：冻结激活规则 ${applicable.length} 条（${byFile.size} 个来源文件）+ rules-manifest.json + review-scope.yaml`);
console.log(`  覆盖模板成本统计：total_rules=${stats.total_rules}, automated_prefilled=${stats.automated_prefilled}, review_required=${stats.review_required}, not_applicable_candidates=${stats.not_applicable_candidates}`);
if (results === null) console.log("  ! 无 audit/results.json：全部规则走 review_required（先跑 browser:check 再 snapshot 可获自动预填）");
