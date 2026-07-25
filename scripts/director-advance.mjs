#!/usr/bin/env node
// Director 作为 context 唯一 owner：记录用户确认门（--confirm）与推进 stage（--stage）。
// 不走 Skill 白名单，但仍受阶段状态机 + 确认门 + 合并后 schema 约束。
// 专业模式下：research→ux 需 confirmations.requirements；ux→visual 需 flows；visual→prototype 需 direction。
// 用法:
//   node scripts/director-advance.mjs --package <目录> --stage <目标阶段>
//   node scripts/director-advance.mjs --package <目录> --confirm requirements|flows --summary <摘要> --reply <用户答复原文>
//   node scripts/director-advance.mjs --package <目录> --confirm direction --summary .. --reply .. --candidates D1,D3,D5 --chosen D3
import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { loadYaml, validateContext, validateStageTransition } from "./lib/context.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), stage = arg("--stage"), confirm = arg("--confirm");
if (!pkg || (!stage && !confirm)) {
  console.error("用法: node scripts/director-advance.mjs --package <目录> (--stage <阶段> | --confirm <gate> --summary .. --reply ..)");
  process.exit(2);
}
const ctxPath = join(resolve(pkg), "context.yaml");
const ctx = loadYaml(ctxPath);
const mode = ctx.project?.mode || "professional";

let next;
if (confirm) {
  if (!["requirements", "flows", "direction"].includes(confirm)) { console.error(`✗ 未知确认门: ${confirm}（可选 requirements|flows|direction）`); process.exit(2); }
  const summary = arg("--summary"), reply = arg("--reply");
  if (!summary || !reply) { console.error("✗ --confirm 需要 --summary 与 --reply（用户答复原文，不得由 Agent 代拟）"); process.exit(2); }
  const rec = { summary, user_reply: reply, decided_at: new Date().toISOString() };
  if (confirm === "direction") {
    const candidates = (arg("--candidates") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const chosen = arg("--chosen");
    if (candidates.length < 2 || !chosen) { console.error("✗ --confirm direction 需要 --candidates（≥2 个，逗号分隔）与 --chosen"); process.exit(2); }
    if (!candidates.includes(chosen)) { console.error(`✗ chosen=${chosen} 不在 candidates [${candidates.join(",")}] 中`); process.exit(2); }
    rec.candidates = candidates;
    rec.chosen = chosen;
  }
  next = { ...ctx, confirmations: { ...(ctx.confirmations || {}), [confirm]: rec } };
} else {
  const t = validateStageTransition(ctx.stage, stage, mode, ctx);
  if (!t.ok) { console.error(`✗ ${t.reason}`); process.exit(1); }
  next = { ...ctx, stage };
}

const v = validateContext(next);
if (!v.ok) { console.error("✗ 合并后 context 非法：\n  " + v.errors.join("\n  ")); process.exit(1); }
writeFileSync(ctxPath, yaml.dump(next, { lineWidth: 100 }));
console.log(confirm ? `✓ Director 记录确认门 ${confirm}` : `✓ Director 推进阶段 ${ctx.stage} → ${stage}`);
