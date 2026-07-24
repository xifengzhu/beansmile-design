#!/usr/bin/env node
// Director 作为 context 唯一 owner，推进 stage（如 review→delivered）。
// 不走 Skill 白名单，但仍受阶段状态机 + 合并后 schema 约束。
// 用法: node scripts/director-advance.mjs --package <目录> --stage <目标阶段>
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { loadYaml, validateContext, validateStageTransition } from "./lib/context.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), stage = arg("--stage");
if (!pkg || !stage) { console.error("用法: node scripts/director-advance.mjs --package <目录> --stage <阶段>"); process.exit(2); }
const ctxPath = join(resolve(pkg), "context.yaml");
const ctx = loadYaml(ctxPath);
const mode = ctx.project?.mode || "professional";

const t = validateStageTransition(ctx.stage, stage, mode);
if (!t.ok) { console.error(`✗ ${t.reason}`); process.exit(1); }
const next = { ...ctx, stage };
const v = validateContext(next);
if (!v.ok) { console.error("✗ 合并后 context 非法：\n  " + v.errors.join("\n  ")); process.exit(1); }
writeFileSync(ctxPath, yaml.dump(next, { lineWidth: 100 }));
console.log(`✓ Director 推进阶段 ${ctx.stage} → ${stage}`);
