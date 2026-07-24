#!/usr/bin/env node
// Director 侧落盘评审结果（规范 5.3 / 7.8）。评审 Agent 只返回结构化 findings（只读），
// 由本脚本校验 schema + 绑定当前 artifact_version 后写入 audit/findings/。
// 用法: node scripts/record-findings.mjs --package <目录> --version <artifact_version> --in <findings.yaml>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { validateFindingsDoc } from "./lib/findings.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pkg = arg("--package");
const version = arg("--version");
const input = arg("--in");
if (!pkg || !version || !input) {
  console.error("用法: node scripts/record-findings.mjs --package <目录> --version <artifact_version> --in <findings.yaml>");
  process.exit(2);
}

const doc = yaml.load(readFileSync(input, "utf8"));
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

const dir = join(resolve(pkg), "audit", "findings");
mkdirSync(dir, { recursive: true });
const out = join(dir, `${doc.reviewer}-${version}.yaml`);
writeFileSync(out, yaml.dump(doc, { lineWidth: 100 }));
const blockers = doc.findings.filter((f) => f.severity === "blocker").length;
console.log(`✓ 已落盘 ${doc.reviewer} 评审（版本 ${version}）：verdict=${doc.verdict}，blocker=${blockers} → ${out}`);
process.exit(0);
