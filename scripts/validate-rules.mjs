#!/usr/bin/env node
// 校验依据库：schema 合规、id 唯一、conflicts_with 可解析。退出码非 0 表示失败。
import { validateRules } from "./lib/rules.mjs";

const { ok, errors, count, files } = validateRules();

if (ok) {
  console.log(`✓ 依据库校验通过：${count} 条规则，来自 ${files.length} 个文件（${files.join(", ")}）`);
  process.exit(0);
}

console.error(`✗ 依据库校验失败，共 ${errors.length} 处问题：`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
