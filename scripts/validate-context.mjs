#!/usr/bin/env node
// 校验一个 context.yaml 是否符合 schema（规范 8）。
// 用法: node scripts/validate-context.mjs <path/to/context.yaml>
import { loadYaml, validateContext } from "./lib/context.mjs";

const path = process.argv[2];
if (!path) {
  console.error("用法: node scripts/validate-context.mjs <context.yaml>");
  process.exit(2);
}

const ctx = loadYaml(path);
const { ok, errors } = validateContext(ctx);
if (ok) {
  console.log(`✓ ${path} 通过 context schema 校验（stage=${ctx.stage}）`);
  process.exit(0);
}
console.error(`✗ ${path} 校验失败：`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
