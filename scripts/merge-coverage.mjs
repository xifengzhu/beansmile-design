#!/usr/bin/env node
// 受控合并 CLI（分层扩展 §8.3）：Director 用它把 reviewer 对 review_required 行的更新
// 合并进快照覆盖模板，产出完整 rule_coverage（findings schema 形状）。
// 单向阀：拒绝增行/缺行/重复行/改锁定字段/覆盖自动证据/遗留 null/未确认 N/A 候选；
// prefilled_automated 只允许 pass→fail 升级（附实测证据）。
// 用法: node scripts/merge-coverage.mjs --package <dir> --version <v> --in <reviewer-rows.yaml> --out <coverage.yaml>
// reviewer-rows.yaml: { rows: [{ rule_id, result, checked_via, evidence, na_confirmed? }] }（或顶层数组）
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { loadFrozenRules } from "./lib/frozen-rules.mjs";
import { mergeCoverage } from "./lib/coverage-template.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), version = arg("--version"), input = arg("--in"), out = arg("--out");
if (!pkg || !version || !input || !out) {
  console.error("用法: node scripts/merge-coverage.mjs --package <dir> --version <v> --in <reviewer-rows.yaml> --out <coverage.yaml>");
  process.exit(2);
}

const frozen = loadFrozenRules(resolve(pkg), version);
if (!frozen.ok) {
  console.error("✗ 无法读取冻结规则快照：");
  for (const e of frozen.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const template = frozen.scope?.rule_coverage_template;
if (!Array.isArray(template)) {
  console.error("✗ review-scope.yaml 缺 rule_coverage_template");
  process.exit(1);
}

const inDoc = yaml.load(readFileSync(input, "utf8"));
const rows = Array.isArray(inDoc) ? inDoc : inDoc?.rows;
if (!Array.isArray(rows)) { console.error("✗ 输入须为顶层数组或 { rows: [...] }"); process.exit(1); }

const r = mergeCoverage(template, rows);
if (!r.ok) {
  console.error("✗ 受控合并被拒（单向阀）：");
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}

writeFileSync(resolve(out), yaml.dump({ artifact_version: String(version), rule_coverage: r.coverage }, { lineWidth: 120 }));
console.log(`✓ 覆盖模板闭合合并完成（v${version}）→ ${out}`);
console.log(`  total=${r.stats.total_rules}, 自动证据原样=${r.stats.from_automated}, reviewer 闭合=${r.stats.from_reviewer}（其中 pass→fail 升级 ${r.stats.upgraded_to_fail}）, not_applicable=${r.stats.not_applicable}`);
