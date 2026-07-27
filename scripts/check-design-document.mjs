#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  implementationReadyIssues,
  parseDesignDocument,
  proposedContractIssues,
} from "./lib/design-document.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
const phase = arg("--phase");
if (!pkg || !["proposed_contract", "implementation_ready"].includes(phase)) {
  console.error("用法: node scripts/check-design-document.mjs --package <目录> --phase proposed_contract|implementation_ready");
  process.exit(2);
}

const root = resolve(pkg);
const designPath = join(root, "Design.md");
const sourcePath = phase === "proposed_contract"
  ? join(root, "audit", "design", "contract-source.json")
  : join(root, "audit", "delivery", "source-manifest.json");
if (!existsSync(designPath) || !existsSync(sourcePath)) {
  console.error(`✗ 缺 ${!existsSync(designPath) ? "Design.md" : sourcePath}`);
  process.exit(1);
}

try {
  const parsed = parseDesignDocument(readFileSync(designPath, "utf8"));
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const issues = phase === "proposed_contract"
    ? proposedContractIssues(root, parsed, source)
    : implementationReadyIssues(root, parsed, source, null);
  if (issues.length) {
    console.error(`✗ Design.md ${phase} 校验失败:`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(`✓ Design.md ${phase} 校验通过`);
} catch (error) {
  console.error(`✗ Design.md 校验失败: ${error.message}`);
  process.exit(1);
}
