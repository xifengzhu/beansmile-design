// 核心任务场景（规范 17"核心任务可以完成"的可执行证明）。html-prototype 产出
// prototype/scenarios.json（成功路径 + 错误路径），browser-check 用 Playwright 逐步
// 执行"填写 → 提交 → 断言成功/报错"。本文件只做定义加载与静态校验（浏览器无关，可单测）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// action → 必填字段。expect_* 是断言步骤；每个场景至少一步断言。
export const STEP_ACTIONS = {
  fill: ["selector", "value"],
  click: ["selector"],
  press: ["key"],
  expect_visible: ["selector"],
  expect_hidden: ["selector"],
  expect_text: ["selector", "text"],
};

// 返回 { scenarios, errors }；errors 非空即定义不合法（验收按 fail 处理）。
export function loadScenarios(pkgRoot) {
  const p = join(pkgRoot, "prototype", "scenarios.json");
  if (!existsSync(p)) {
    return { scenarios: [], errors: ['缺 prototype/scenarios.json：核心任务场景未定义（规范 17"核心任务可以完成"需要可执行证明）'] };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { return { scenarios: [], errors: [`scenarios.json 非法 JSON: ${e.message}`] }; }
  if (!Array.isArray(raw) || !raw.length) return { scenarios: [], errors: ["scenarios.json 须为非空数组"] };

  const errors = [];
  const ids = new Set();
  for (const [i, s] of raw.entries()) {
    const where = `scenarios[${i}]${s?.id ? `(${s.id})` : ""}`;
    if (!s?.id) errors.push(`${where} 缺 id`);
    else if (ids.has(s.id)) errors.push(`${where} id 重复: ${s.id}`);
    else ids.add(s.id);
    if (!s?.name) errors.push(`${where} 缺 name`);
    if (!["success", "error"].includes(s?.kind)) errors.push(`${where} kind 须为 success|error`);
    if (!s?.page) errors.push(`${where} 缺 page（相对 prototype/ 的路径）`);
    else if (!existsSync(join(pkgRoot, "prototype", s.page))) errors.push(`${where} page 不存在: prototype/${s.page}`);
    if (!Array.isArray(s?.steps) || !s.steps.length) { errors.push(`${where} steps 须为非空数组`); continue; }
    for (const [j, st] of s.steps.entries()) {
      const req = STEP_ACTIONS[st?.action];
      if (!req) { errors.push(`${where}.steps[${j}] 未知 action: ${st?.action}`); continue; }
      for (const k of req) if (st[k] === undefined || st[k] === "") errors.push(`${where}.steps[${j}] (${st.action}) 缺 ${k}`);
    }
    if (!s.steps.some((st) => String(st?.action).startsWith("expect_"))) {
      errors.push(`${where} 无任何 expect_* 断言步骤（跑完不验证等于没跑）`);
    }
  }
  if (!raw.some((s) => s?.kind === "success")) errors.push("缺 kind=success 场景（核心任务成功路径）");
  if (!raw.some((s) => s?.kind === "error")) errors.push("缺 kind=error 场景（错误路径也要证明会正确报错，对应 wcag-3.3.1）");
  return { scenarios: raw, errors };
}
