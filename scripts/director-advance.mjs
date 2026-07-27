#!/usr/bin/env node
// Director 作为 context 唯一 owner：记录用户确认门（--confirm）与推进 stage（--stage）。
// 不走 Skill 白名单，但仍受阶段状态机 + 确认门 + 合并后 schema 约束。
// 专业模式下：research→ux 需 confirmations.requirements；ux→visual 需 flows；visual→prototype 需 direction。
// 用法:
//   node scripts/director-advance.mjs --package <目录> --stage <目标阶段>
//   node scripts/director-advance.mjs --package <目录> --confirm requirements|flows|mode --summary <摘要> --reply <用户答复原文>
//   version-3 Design.md 包确认 flows 时还须 --design-patch <provisional-patch.yaml>，命令会执行 seal。
//   node scripts/director-advance.mjs --package <目录> --confirm direction --summary .. --reply .. --candidates D1,D3,D5 --chosen D3
// mode 门（规范 27.8）：快速模式必须先经用户确认落盘，验收对 v1.8 quick 包核对 confirmations.mode。
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { loadYaml, validateContext, validateStageTransition } from "./lib/context.mjs";
import { requiresDesignContract } from "./lib/delivery.mjs";
import { checkDesignContractBinding, sealDesignContract } from "./lib/design-contract.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), stage = arg("--stage"), confirm = arg("--confirm");
if (!pkg || (!stage && !confirm)) {
  console.error("用法: node scripts/director-advance.mjs --package <目录> (--stage <阶段> | --confirm <gate> --summary .. --reply ..)");
  process.exit(2);
}
const root = resolve(pkg);
const ctxPath = join(root, "context.yaml");
const ctx = loadYaml(ctxPath);
const mode = ctx.project?.mode || "professional";

let next;
if (confirm) {
  if (!["requirements", "flows", "direction", "mode"].includes(confirm)) { console.error(`✗ 未知确认门: ${confirm}（可选 requirements|flows|direction|mode）`); process.exit(2); }
  const summary = arg("--summary"), reply = arg("--reply");
  if (!summary || !reply) { console.error("✗ --confirm 需要 --summary 与 --reply（用户答复原文，不得由 Agent 代拟）"); process.exit(2); }
  if (confirm === "flows" && requiresDesignContract(ctx)) {
    const designPatchPath = arg("--design-patch");
    if (!designPatchPath) {
      console.error("✗ 本包要求 Design.md；--confirm flows 必须提供 --design-patch <provisional-patch.yaml>");
      process.exit(2);
    }
    try {
      const provisionalPatch = yaml.load(readFileSync(resolve(designPatchPath), "utf8"));
      sealDesignContract(root, ctx, { summary, userReply: reply, provisionalPatch });
      console.log("✓ Director 已记录 flows/Design.md 确认并 seal contract lock");
      process.exit(0);
    } catch (error) {
      console.error(`✗ Design.md seal 失败: ${error.message}`);
      process.exit(1);
    }
  }
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
  const contractBoundary = requiresDesignContract(ctx)
    && (stage === "visual" || stage === "prototype");
  if (contractBoundary) {
    const issues = checkDesignContractBinding(root, ctx);
    if (issues.length) {
      console.error("✗ Design.md contract lock 未通过，禁止进入创作阶段：");
      for (const issue of issues) console.error(`  - ${issue}`);
      process.exit(1);
    }
  }
  const t = validateStageTransition(ctx.stage, stage, mode, ctx);
  if (!t.ok) { console.error(`✗ ${t.reason}`); process.exit(1); }
  next = { ...ctx, stage };
}

const v = validateContext(next);
if (!v.ok) { console.error("✗ 合并后 context 非法：\n  " + v.errors.join("\n  ")); process.exit(1); }
writeFileSync(ctxPath, yaml.dump(next, { lineWidth: 100 }));
console.log(confirm ? `✓ Director 记录确认门 ${confirm}` : `✓ Director 推进阶段 ${ctx.stage} → ${stage}`);
