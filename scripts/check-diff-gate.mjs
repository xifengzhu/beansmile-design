#!/usr/bin/env node
// 硬化字段级 diff 门禁（规范 5.2、8、9）。校验某 Skill 对 context 的改动满足：
// 写路径白名单 + 合并后 schema 合法 + 阶段状态机 + artifact 版本单调性。
// 用法:
//   node scripts/check-diff-gate.mjs [--package <目录>] --skill <id> --before <before.yaml> --patch <patch.yaml>
//   node scripts/check-diff-gate.mjs [--package <目录>] --skill <id> --before <before.yaml> --after <after.yaml>
import { resolve } from "node:path";
import { resolveManifest } from "./lib/manifests.mjs";
import { loadYaml, hardenedGate } from "./lib/context.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const skill = arg("--skill");
const operation = arg("--operation");
const packagePath = arg("--package");
const beforePath = arg("--before");
const afterPath = arg("--after");
const patchPath = arg("--patch");
if (!skill || !beforePath || (!afterPath && !patchPath)) {
  console.error("用法: node scripts/check-diff-gate.mjs --skill <id> --before <before.yaml> (--patch <patch.yaml> | --after <after.yaml>)");
  process.exit(2);
}

let manifest;
try {
  manifest = resolveManifest(skill, operation);
} catch (error) {
  console.error(`✗ ${error.message}（注意用 canonical snake_case id）`);
  process.exit(2);
}

const before = loadYaml(beforePath);
const opts = afterPath ? { after: loadYaml(afterPath) } : { patch: loadYaml(patchPath) };
if (packagePath) opts.packageRoot = resolve(packagePath);
const r = hardenedGate(manifest, before, opts);

const label = operation ? `${skill}/${operation}` : skill;
if (r.ok) {
  console.log(`✓ diff 门禁通过：${label} 改动 [${r.changes.join(", ") || "无"}]（白名单 [${manifest.writes.join(", ")}]，合并后 schema/阶段/版本均合法）`);
  process.exit(0);
}
console.error(`✗ diff 门禁失败：${label}`);
if (r.violations.length) {
  console.error(`  越权写字段（不在白名单 [${manifest.writes.join(", ")}]）：`);
  for (const v of r.violations) console.error(`    - ${v}`);
}
for (const reason of r.reasons) console.error(`  - ${reason}`);
process.exit(1);
