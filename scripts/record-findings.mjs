#!/usr/bin/env node
// Director 侧落盘评审结果（规范 5.3 / 7.8）。评审 Agent 只返回结构化 findings（只读），
// 由本脚本校验 schema + 绑定当前 artifact_version 后写入 audit/findings/。
// 分层扩展 §8.4：standards 的适用集不再现算——从 audit/snapshots/<version>/rules/ 读冻结卡
// （逐卡校验 canonicalRuleHash，篡改即拒）；rule_coverage 还须对照 review-scope 覆盖模板
// 闭合（单向阀）。visual 的非空 rule_id 必须能在 rules-manifest.json 解析。
// 增量模式（--delta，规范 27.5）：中间版本的 delta findings 按 findings-delta.schema 校验，
// 落盘为 <reviewer>-<version>-delta.yaml——与全量命名区隔，永不可能冒充全量评审；
// 闭合性硬线：baseline 每条 open blocker/warning 必须核销或再断言，缺一拒收。
// 用法: node scripts/record-findings.mjs --package <目录> --version <artifact_version> --in <findings.yaml> [--delta]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { validateFindingsDoc, semanticIssuesVisual, semanticIssuesStandards } from "./lib/findings.mjs";
import { loadFrozenRules } from "./lib/frozen-rules.mjs";
import { templateClosureIssues } from "./lib/coverage-template.mjs";
import { validateDeltaDoc, loadReviewerFindings, semanticIssuesDelta } from "./lib/delta-review.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pkg = arg("--package");
const version = arg("--version");
const input = arg("--in");
const deltaMode = process.argv.includes("--delta");
if (!pkg || !version || !input) {
  console.error("用法: node scripts/record-findings.mjs --package <目录> --version <artifact_version> --in <findings.yaml> [--delta]");
  process.exit(2);
}

const doc = yaml.load(readFileSync(input, "utf8"));

// —— 增量评审分支（规范 27.5）——
if (deltaMode) {
  const v = validateDeltaDoc(doc);
  if (!v.ok) {
    console.error("✗ delta findings schema 校验失败：");
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (doc.artifact_version !== version) {
    console.error(`✗ delta findings.artifact_version=${doc.artifact_version} 与当前版本 ${version} 不符，拒绝落盘`);
    process.exit(1);
  }
  const frozen = loadFrozenRules(resolve(pkg), version);
  if (!frozen.ok) {
    console.error("✗ 冻结规则快照不可用：");
    for (const e of frozen.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const baseline = loadReviewerFindings(resolve(pkg), doc.reviewer, doc.baseline_version);
  const issues = semanticIssuesDelta(doc, baseline, frozen, resolve(pkg));
  if (issues.length) {
    console.error("✗ delta findings 语义校验失败（闭合性/证据纪律）：");
    for (const s of issues) console.error(`  - ${s}`);
    process.exit(1);
  }
  const dir = join(resolve(pkg), "audit", "findings");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${doc.reviewer}-${version}-delta.yaml`);
  writeFileSync(out, yaml.dump(doc, { lineWidth: 100 }));
  const blockers = (doc.findings ?? []).filter((f) => f.severity === "blocker").length;
  console.log(`✓ 已落盘 ${doc.reviewer} 增量评审（v${doc.baseline_version}→v${version}）：verdict=${doc.verdict}，blocker=${blockers}，核销 ${(doc.resolved_findings ?? []).length} 条 → ${out}`);
  console.log("  提醒：delta 结论不进验收——拟交付版本仍须全量双评审。");
  process.exit(0);
}
const v = validateFindingsDoc(doc);
if (!v.ok) {
  console.error("✗ findings schema 校验失败：");
  for (const e of v.errors) console.error(`  - ${e}`);
  process.exit(1);
}
if (doc.artifact_version !== version) {
  console.error(`✗ findings.artifact_version=${doc.artifact_version} 与当前版本 ${version} 不符，拒绝落盘（防止旧评审蒙混）。`);
  process.exit(1);
}
if (!["standards", "visual"].includes(doc.reviewer)) {
  console.error(`✗ 未知 reviewer: ${doc.reviewer}`);
  process.exit(1);
}

// 两个 reviewer 都绑定冻结规则快照（§8.4）：缺 rules/ 或哈希漂移即拒（standards 无适用集
// 可依，visual 的 rule_id 无处解析）。
const frozen = loadFrozenRules(resolve(pkg), version);
if (!frozen.ok) {
  console.error("✗ 冻结规则快照不可用：");
  for (const e of frozen.errors) console.error(`  - ${e}`);
  process.exit(1);
}

// visual 评审的语义校验：八维覆盖、截图存在且哈希匹配、observed/evidence 含实测值、
// 判定与 findings 对应（rubric 证据纪律的机器化，防"没看图就写 pass"）。
// §8.4 追加：非空 rule_id 必须能在冻结 rules-manifest.json 解析（不得引用仓库当前规则库）。
if (doc.reviewer === "visual") {
  const issues = semanticIssuesVisual(doc, resolve(pkg));
  const frozenIds = new Set(frozen.manifest.rules.map((r) => r.rule_id));
  for (const f of doc.findings ?? []) {
    if (f.rule_id && !frozenIds.has(f.rule_id)) {
      issues.push(`finding ${f.id} 引用冻结规则 manifest 外的 rule_id: ${f.rule_id}（评审只能引用快照 v${version} 冻结集）`);
    }
  }
  if (issues.length) {
    console.error("✗ visual findings 语义校验失败（rubric 证据纪律）：");
    for (const s of issues) console.error(`  - ${s}`);
    process.exit(1);
  }
}

// standards 评审的语义校验：覆盖矩阵纪律——适用集 = 冻结快照 rules/ 的规则卡（§8.4，
// 不读仓库当前 evidence/rules/），每条冻结规则逐条核查、fail 有对应 finding、Web 规则
// 不得 intent_only；再对照 review-scope 覆盖模板做闭合校验（单向阀：prefilled 无
// fail→pass、pass 升级 fail 须有对应 finding、N/A 候选须范围确认、无 null）。
if (doc.reviewer === "standards") {
  const issues = semanticIssuesStandards(doc, frozen.cards);
  issues.push(...templateClosureIssues(doc.rule_coverage, frozen.scope?.rule_coverage_template ?? [], doc.findings ?? []));
  if (issues.length) {
    console.error("✗ standards findings 语义校验失败（覆盖矩阵纪律/模板闭合）：");
    for (const s of issues) console.error(`  - ${s}`);
    process.exit(1);
  }
}

const dir = join(resolve(pkg), "audit", "findings");
mkdirSync(dir, { recursive: true });
const out = join(dir, `${doc.reviewer}-${version}.yaml`);
writeFileSync(out, yaml.dump(doc, { lineWidth: 100 }));
const blockers = doc.findings.filter((f) => f.severity === "blocker").length;
console.log(`✓ 已落盘 ${doc.reviewer} 评审（版本 ${version}）：verdict=${doc.verdict}，blocker=${blockers} → ${out}`);
process.exit(0);
