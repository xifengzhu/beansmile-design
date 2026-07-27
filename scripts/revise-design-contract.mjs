#!/usr/bin/env node
import { resolve } from "node:path";
import { loadYaml } from "./lib/context.mjs";
import { reviseDesignContract } from "./lib/design-revision.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
const from = arg("--from");
const reason = arg("--reason");
if (!pkg || from !== "design_contract" || !reason?.trim()) {
  console.error("用法: node scripts/revise-design-contract.mjs --package <目录> --from design_contract --reason <原因>");
  process.exit(2);
}

try {
  const root = resolve(pkg);
  const ctx = loadYaml(resolve(root, "context.yaml"));
  const result = reviseDesignContract(root, ctx, { reason });
  console.log(`✓ 已审计 Design.md 契约修订 ${result.record.old_contract_revision}→${result.record.new_contract_revision}，stage 回退到 ux`);
  console.log(`  ${result.recordPath}`);
} catch (error) {
  console.error(`✗ Design.md 契约修订失败: ${error.message}`);
  process.exit(1);
}
