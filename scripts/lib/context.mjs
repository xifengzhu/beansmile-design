// context.yaml 加载/校验、字段级 diff、以及基于白名单的 diff 门禁（规范 5.2、8）。
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { makeValidator } from "./rules.mjs";
import { SCHEMAS } from "./paths.mjs";

export function loadYaml(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

export function validateContext(ctx) {
  const ajv = makeValidator();
  const schema = JSON.parse(readFileSync(SCHEMAS.context, "utf8"));
  const validate = ajv.compile(schema);
  const ok = validate(ctx);
  const errors = ok ? [] : validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`);
  return { ok, errors };
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 深度比较，返回发生变化的叶路径数组（数组整体视为叶）。
export function changedPaths(before, after, prefix = []) {
  const paths = [];
  const keys = new Set([
    ...(isObject(before) ? Object.keys(before) : []),
    ...(isObject(after) ? Object.keys(after) : []),
  ]);
  for (const k of keys) {
    const b = isObject(before) ? before[k] : undefined;
    const a = isObject(after) ? after[k] : undefined;
    const here = [...prefix, k];
    if (isObject(b) && isObject(a)) {
      paths.push(...changedPaths(b, a, here));
    } else if (JSON.stringify(b) !== JSON.stringify(a)) {
      paths.push(here);
    }
  }
  return paths;
}

// 深合并：对象递归合并；标量/数组/null 直接替换（null 替换后会被 schema 校验拦截非法置空）。
export function deepMerge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = isObject(patch[k]) && isObject(base[k]) ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

// reads 白名单投影：只暴露 Skill 声明可读的字段（顶层或二级），实现输入字段最小化。
export function projectContext(ctx, reads = []) {
  const view = {};
  for (const path of reads) {
    const [top, second] = path.split(".");
    if (ctx[top] === undefined) continue;
    if (!second) {
      view[top] = ctx[top];
    } else if (isObject(ctx[top]) && ctx[top][second] !== undefined) {
      view[top] = { ...(view[top] || {}), [second]: ctx[top][second] };
    }
  }
  return view;
}

// 阶段状态机（规范 8、9）。不允许回退；delivered 只能从 review 到达。
const STAGES = ["intake", "research", "ux", "visual", "prototype", "review", "delivered"];
const NEXT_PROFESSIONAL = {
  intake: ["research"], research: ["ux"], ux: ["visual"], visual: ["prototype"],
  prototype: ["review"], review: ["delivered"], delivered: [],
};
const NEXT_QUICK = {
  intake: ["research", "prototype"], research: ["prototype"], ux: ["prototype"], visual: ["prototype"],
  prototype: ["review"], review: ["delivered"], delivered: [],
};
// 专业模式确认门 → 阶段推进映射：缺对应确认记录时禁止推进（规范 9.1 的 A/B/C 门）。
const CONFIRMATION_GATES = { ux: "requirements", visual: "flows", prototype: "direction" };

export function checkConfirmationGate(to, mode, ctx) {
  if (mode !== "professional" || !ctx) return { ok: true };
  const gate = CONFIRMATION_GATES[to];
  if (!gate) return { ok: true };
  const rec = ctx.confirmations?.[gate];
  if (!rec) return { ok: false, reason: `进入 ${to} 需先记录确认门 confirmations.${gate}（用户确认${{ requirements: "需求与成功标准", flows: "流程与页面范围", direction: "视觉方向" }[gate]}）` };
  if (gate === "direction") {
    if (!Array.isArray(rec.candidates) || rec.candidates.length < 2) return { ok: false, reason: "确认门 direction 需 ≥2 个候选方向（candidates）" };
    if (!rec.candidates.includes(rec.chosen)) return { ok: false, reason: `确认门 direction 的 chosen=${rec.chosen} 不在 candidates 中` };
  }
  return { ok: true };
}

export function validateStageTransition(from, to, mode = "professional", ctx = null) {
  if (from === to) return { ok: true };
  if (!STAGES.includes(from) || !STAGES.includes(to)) return { ok: false, reason: `未知阶段 ${from}→${to}` };
  if (STAGES.indexOf(to) < STAGES.indexOf(from)) return { ok: false, reason: `禁止回退 ${from}→${to}` };
  const next = (mode === "quick" ? NEXT_QUICK : NEXT_PROFESSIONAL)[from] || [];
  if (!next.includes(to)) return { ok: false, reason: `非法阶段跳转 ${from}→${to}（${mode} 模式）` };
  const gate = checkConfirmationGate(to, mode, ctx);
  if (!gate.ok) return gate;
  return { ok: true };
}

// artifact_version 单调性：同一 artifact 若被改动，版本必须严格递增。
export function checkArtifactMonotonic(before, after) {
  const violations = [];
  const b = before.artifacts || {}, a = after.artifacts || {};
  for (const k of Object.keys(a)) {
    if (!b[k]) continue;
    const bv = b[k].artifact_version, av = a[k].artifact_version;
    if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue; // 未变
    if (bv === undefined || av === undefined) { violations.push(`artifacts.${k}: 改动但缺 artifact_version`); continue; }
    if (!(Number(av) > Number(bv))) violations.push(`artifacts.${k}: 版本未递增 ${bv}→${av}`);
  }
  return violations;
}

// 硬化门禁：路径白名单 + reads 越读检测 + 合并后 schema + 阶段状态机 + 版本单调性。
// after 可由 before + patch 得到（传 patch）或直接传 after。
export function hardenedGate(manifest, before, { after, patch } = {}) {
  const merged = after ?? deepMerge(before, patch ?? {});
  const violations = [];
  const reasons = [];

  // 1. 写路径白名单
  const writes = new Set(manifest.writes ?? []);
  const changes = changedPaths(before, merged);
  for (const p of changes) {
    const top = p[0], second = p.length > 1 ? `${p[0]}.${p[1]}` : null;
    if (!(writes.has(top) || (second && writes.has(second)))) violations.push(p.join("."));
  }

  // 2. 合并后 context schema 校验（拦截 users:null 等非法置空）
  const schemaCheck = validateContext(merged);
  if (!schemaCheck.ok) for (const e of schemaCheck.errors) reasons.push(`schema: ${e}`);

  // 3. 阶段状态机（含专业模式确认门：合并后的 context 须已有对应 confirmations 记录）
  const mode = before.project?.mode || merged.project?.mode || "professional";
  if (before.stage !== merged.stage) {
    const t = validateStageTransition(before.stage, merged.stage, mode, merged);
    if (!t.ok) reasons.push(t.reason);
  }

  // 4. artifact 版本单调性
  for (const v of checkArtifactMonotonic(before, merged)) reasons.push(v);

  return {
    ok: violations.length === 0 && reasons.length === 0,
    violations,
    reasons,
    changes: changes.map((p) => p.join(".")),
    after: merged,
  };
}

// 兼容旧接口（仅路径检查）。
export function checkDiffGate(manifest, before, after) {
  const r = hardenedGate(manifest, before, { after });
  return { ok: r.violations.length === 0, violations: r.violations, changes: r.changes };
}
