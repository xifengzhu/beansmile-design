#!/usr/bin/env node
// Director 应用某 Skill 的 context 补丁：经硬化门禁校验后合并写回 context.yaml。
// context.yaml 是唯一可写状态，唯一由此脚本（Director）写入。
// 用法: node scripts/apply-patch.mjs --package <目录> --skill <canonical id> --patch <patch.yaml>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { loadManifests } from "./lib/manifests.mjs";
import { loadYaml, hardenedGate } from "./lib/context.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), skill = arg("--skill"), patchPath = arg("--patch");
if (!pkg || !skill || !patchPath) { console.error("用法: node scripts/apply-patch.mjs --package <目录> --skill <id> --patch <patch.yaml>"); process.exit(2); }
const root = resolve(pkg);
const ctxPath = join(root, "context.yaml");

const { bySkill } = loadManifests();
const manifest = bySkill.get(skill);
if (!manifest) { console.error(`✗ 未知 Skill: ${skill}（用 canonical snake_case id）`); process.exit(2); }

const before = loadYaml(ctxPath);
const patch = yaml.load(readFileSync(patchPath, "utf8"));
const r = hardenedGate(manifest, before, { patch });

if (!r.ok) {
  console.error(`✗ 门禁拒绝 ${skill} 的补丁：`);
  if (r.violations.length) console.error(`  越权字段: ${r.violations.join(", ")}`);
  for (const reason of r.reasons) console.error(`  - ${reason}`);
  process.exit(1);
}

writeFileSync(ctxPath, yaml.dump(r.after, { lineWidth: 100 }));
console.log(`✓ ${skill} 补丁已合并（改动 [${r.changes.join(", ")}]）→ stage=${r.after.stage}`);
