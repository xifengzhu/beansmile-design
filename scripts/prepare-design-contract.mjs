#!/usr/bin/env node
import { resolve } from "node:path";
import { buildContractSource } from "./lib/design-source.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
if (!pkg) {
  console.error("用法: node scripts/prepare-design-contract.mjs --package <目录> [--overwrite]");
  process.exit(2);
}

try {
  const root = resolve(pkg);
  const manifest = buildContractSource(root, { overwrite: process.argv.includes("--overwrite") });
  console.log(`✓ 已冻结 Design.md 来源 → ${root}/audit/design/contract-source.json`);
  console.log(`  contract_revision=${manifest.contract_revision}, digest=${manifest.contract_source_digest}`);
} catch (error) {
  console.error(`✗ Design.md 来源冻结失败: ${error.message}`);
  process.exit(1);
}
