#!/usr/bin/env node
// Director 作为 context 唯一 owner：记录用户确认门（--confirm）与推进 stage（--stage）。
// review -> delivered 前同步执行完整 acceptance；任何非零状态都原样传播且不得写 context。
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { validateContext, validateStageTransition } from "./lib/context.mjs";
import { requiresDesignContract } from "./lib/delivery.mjs";
import { checkDesignContractBinding, sealDesignContract } from "./lib/design-contract.mjs";

const ACCEPTANCE = resolve(import.meta.dirname, "acceptance.mjs");

function arg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function response(status, stdout = "", stderr = "") {
  return { status, stdout, stderr };
}

function defaultAcceptanceRunner(root) {
  return spawnSync(process.execPath, [ACCEPTANCE, "--package", root], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function runDirectorAdvance(argv, { acceptanceRunner = defaultAcceptanceRunner } = {}) {
  const pkg = arg(argv, "--package");
  const stage = arg(argv, "--stage");
  const confirm = arg(argv, "--confirm");
  if (!pkg || (!stage && !confirm)) {
    return response(2, "", "用法: node scripts/director-advance.mjs --package <目录> (--stage <阶段> | --confirm <gate> --summary .. --reply ..)\n");
  }

  const root = resolve(pkg);
  const ctxPath = join(root, "context.yaml");
  let ctx;
  let originalContext;
  try {
    originalContext = readFileSync(ctxPath);
    ctx = yaml.load(originalContext.toString("utf8"));
  } catch (error) {
    return response(1, "", `✗ context.yaml 无法读取: ${error.message}\n`);
  }
  const mode = ctx.project?.mode || "professional";
  let next;
  let acceptedOutput = "";

  if (confirm) {
    if (!["requirements", "flows", "direction", "mode"].includes(confirm)) {
      return response(2, "", `✗ 未知确认门: ${confirm}（可选 requirements|flows|direction|mode）\n`);
    }
    const summary = arg(argv, "--summary");
    const reply = arg(argv, "--reply");
    if (!summary || !reply) {
      return response(2, "", "✗ --confirm 需要 --summary 与 --reply（用户答复原文，不得由 Agent 代拟）\n");
    }
    if (confirm === "flows" && requiresDesignContract(ctx)) {
      const designPatchPath = arg(argv, "--design-patch");
      if (!designPatchPath) {
        return response(2, "", "✗ 本包要求 Design.md；--confirm flows 必须提供 --design-patch <provisional-patch.yaml>\n");
      }
      try {
        const provisionalPatch = yaml.load(readFileSync(resolve(designPatchPath), "utf8"));
        sealDesignContract(root, ctx, { summary, userReply: reply, provisionalPatch });
        return response(0, "✓ Director 已记录 flows/Design.md 确认并 seal contract lock\n");
      } catch (error) {
        return response(1, "", `✗ Design.md seal 失败: ${error.message}\n`);
      }
    }
    const record = { summary, user_reply: reply, decided_at: new Date().toISOString() };
    if (confirm === "direction") {
      const candidates = (arg(argv, "--candidates") || "").split(",").map((value) => value.trim()).filter(Boolean);
      const chosen = arg(argv, "--chosen");
      if (candidates.length < 2 || !chosen) {
        return response(2, "", "✗ --confirm direction 需要 --candidates（≥2 个，逗号分隔）与 --chosen\n");
      }
      if (!candidates.includes(chosen)) {
        return response(2, "", `✗ chosen=${chosen} 不在 candidates [${candidates.join(",")}] 中\n`);
      }
      record.candidates = candidates;
      record.chosen = chosen;
    }
    next = { ...ctx, confirmations: { ...(ctx.confirmations || {}), [confirm]: record } };
  } else {
    const contractBoundary = requiresDesignContract(ctx) && (stage === "visual" || stage === "prototype");
    if (contractBoundary) {
      const issues = checkDesignContractBinding(root, ctx);
      if (issues.length) {
        return response(1, "", `✗ Design.md contract lock 未通过，禁止进入创作阶段：\n${issues.map((issue) => `  - ${issue}`).join("\n")}\n`);
      }
    }
    const transition = validateStageTransition(ctx.stage, stage, mode, ctx);
    if (!transition.ok) return response(1, "", `✗ ${transition.reason}\n`);

    if (stage === "delivered") {
      let acceptance;
      try {
        acceptance = acceptanceRunner(root);
      } catch (error) {
        return response(1, "", `✗ acceptance 无法执行: ${error.message}\n`);
      }
      const status = Number.isInteger(acceptance?.status) ? acceptance.status : 1;
      const stdout = String(acceptance?.stdout ?? "");
      const stderr = String(acceptance?.stderr ?? acceptance?.error?.message ?? "");
      if (status !== 0) return response(status, stdout, stderr);
      acceptedOutput = stdout;
      if (stderr) acceptedOutput += stderr;
    }
    next = { ...ctx, stage };
  }

  const validated = validateContext(next);
  if (!validated.ok) {
    return response(1, "", `✗ 合并后 context 非法：\n  ${validated.errors.join("\n  ")}\n`);
  }
  try {
    if (!readFileSync(ctxPath).equals(originalContext)) {
      return response(1, "", "✗ context.yaml 在 Director 操作期间发生漂移，拒绝覆盖；请基于最新状态重试\n");
    }
  } catch (error) {
    return response(1, "", `✗ context.yaml 在 Director 操作期间不可读: ${error.message}\n`);
  }
  writeFileSync(ctxPath, yaml.dump(next, { lineWidth: 100 }));
  const message = confirm
    ? `✓ Director 记录确认门 ${confirm}`
    : `✓ Director 推进阶段 ${ctx.stage} → ${stage}`;
  return response(0, `${acceptedOutput}${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runDirectorAdvance(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status);
}
