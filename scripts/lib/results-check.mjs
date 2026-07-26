// results.json 的 fail-closed 结构校验（规范 27.11）。此前验收只对"存在的字段"做
// 信号判断——focus_visible_ratio/reflow_ok/zoom_ok/task_flows 缺失即静默通过，伪造一份
// 只含 checks_version+哈希+键盘比例的最小文档就能绕过大量浏览器证据。本模块反转默认：
// 当前版本产物的**每个**证据字段都必须在场、类型正确、且与交付物对账（页面清单、
// 场景数、逐页 CLS/页边距记录），缺任何一项都是 fail，不是 pass。
// 纯函数（文件系统无关），browser-check 的真实产物必须恒过——有对应测试守着。
import { diffHashMaps } from "./hash.mjs";

// 7 = 场景执行期错误捕获 + 空断言场景判废（27.11）。旧版产物一律要求重跑。
export const MIN_CHECKS_VERSION = 7;

const fmtRatio = (x) => (typeof x === "number" ? `${(x * 100).toFixed(0)}%` : "缺失");

// r: 解析后的 results.json；上下文由调用方提供：
// currentVersion 当前 artifact_version、activeHashes 交付物指纹、
// prototypePages 当前原型页面名清单、scenarios/scenarioErrors 为 loadScenarios 的现算结果。
export function resultsIssues(r, { currentVersion, activeHashes, prototypePages, scenarios, scenarioErrors }) {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return ["results.json 不是对象"];
  const problems = [];

  if (!Number.isInteger(r.checks_version) || r.checks_version < MIN_CHECKS_VERSION) {
    // 旧版产物字段形状不同，结构校验无意义，直接要求重跑（沿用 v1.5 起的拒旧惯例）。
    return [`results.json 为旧版检查产物（checks_version=${r.checks_version ?? 1} < ${MIN_CHECKS_VERSION}，缺场景执行期错误捕获/空断言场景判废（27.11）或更早能力），请重跑 browser-check`];
  }
  if (r.artifact_version !== currentVersion) {
    problems.push(`artifact_version 缺失或不符: results=${r.artifact_version ?? "(缺)"}, 当前=${currentVersion}`);
  }

  // 同源：检查时的原型指纹必须与当前交付原型一致（拒绝陈旧/异次运行的审计产物冒充）。
  if (!r.page_hashes || typeof r.page_hashes !== "object" || !Object.keys(r.page_hashes).length) {
    problems.push("缺 page_hashes（无法判定同源）");
  } else {
    const drift = diffHashMaps(r.page_hashes, activeHashes, ["prototype"]);
    if (drift.length) problems.push(`results.json 与当前原型不同源: ${drift.slice(0, 3).join("; ")}`);
  }

  // 页面对账：巡检访问过的页面必须与当前原型页面清单一一对应——漏页=有页面没被检查。
  const expected = [...prototypePages].sort();
  if (!Array.isArray(r.pages)) problems.push("缺 pages[]（无法判定逐页巡检覆盖）");
  else {
    const got = [...r.pages].sort();
    const missing = expected.filter((p) => !got.includes(p));
    const extra = got.filter((p) => !expected.includes(p));
    if (missing.length) problems.push(`巡检未覆盖页面: ${missing.slice(0, 3).join(",")}${missing.length > 3 ? "…" : ""}`);
    if (extra.length) problems.push(`巡检记录了原型中不存在的页面: ${extra.slice(0, 3).join(",")}`);
  }

  if (r.keyboard_reachable_ratio !== 1) problems.push(`键盘可达 ${fmtRatio(r.keyboard_reachable_ratio)}`);
  if (r.focus_visible_ratio !== 1) problems.push(`可见焦点 ${fmtRatio(r.focus_visible_ratio)}`);
  if (r.reflow_ok !== true) problems.push(`320px 重排${r.reflow_ok === false ? "失败" : "结果缺失"}`);
  if (r.zoom_ok !== true) problems.push(`200% 缩放重排${r.zoom_ok === false ? "失败" : "结果缺失"}`);

  for (const key of ["violations", "console_errors", "clipped_text", "screenshots"]) {
    if (!Array.isArray(r[key])) problems.push(`缺 ${key}[]`);
  }
  const severe = (Array.isArray(r.violations) ? r.violations : []).filter((v) => ["critical", "serious"].includes(v?.impact)).length;
  if (severe > 0) problems.push(`axe/检查严重违规 ${severe}`);
  if (Array.isArray(r.console_errors) && r.console_errors.length) problems.push(`控制台错误 ${r.console_errors.length} 条`);
  if (Array.isArray(r.clipped_text) && r.clipped_text.length) problems.push(`文本裁切 ${r.clipped_text.length} 处`);
  if (Array.isArray(r.screenshots) && r.screenshots.length !== expected.length * 2) {
    problems.push(`审计截图 ${r.screenshots.length} 张 ≠ 页面数 ${expected.length} × 2（每页桌面+移动）`);
  }

  // 逐页记录对账：cls 与 edge_insets 必须每页在场——省略记录与记录为 0 不是一回事。
  for (const [key, label] of [["cls", "CLS"], ["edge_insets", "页边距"]]) {
    if (!r[key] || typeof r[key] !== "object") { problems.push(`缺 ${key}（逐页${label}记录）`); continue; }
    const absent = expected.filter((p) => !(p in r[key]));
    if (absent.length) problems.push(`${key} 缺页面记录: ${absent.slice(0, 3).join(",")}${absent.length > 3 ? "…" : ""}`);
  }
  const clsValues = Object.values(r.cls ?? {}).filter((x) => typeof x === "number");
  const maxCls = Math.max(0, ...clsValues);
  if (maxCls >= 0.1) problems.push(`CLS=${maxCls}（阈值 0.1）`);
  for (const [pg, e] of Object.entries(r.edge_insets ?? {})) {
    if (!Array.isArray(e?.offenders)) { problems.push(`edge_insets[${pg}] 缺 offenders[]`); continue; }
    if (e.offenders.length) problems.push(`移动视口文本贴边 ${pg}: ${e.offenders.length} 处`);
  }

  // 核心任务对账：task_flows 必须完整在场，且 total 等于**现算**的 scenarios.json 场景数
  // （scenarios.json 在 prototype/ 内、被同源指纹锚定）——{}、0/0、漏场景都过不去。
  const tf = r.task_flows;
  if (!tf || typeof tf !== "object") problems.push("缺 task_flows（核心任务场景执行记录）");
  else {
    if (!Number.isInteger(tf.total) || !Number.isInteger(tf.passed)) problems.push("task_flows.total/passed 缺失或非整数");
    if (!Array.isArray(tf.definition_errors)) problems.push("task_flows 缺 definition_errors[]");
    else if (tf.definition_errors.length) problems.push(`核心任务场景定义问题: ${tf.definition_errors.slice(0, 3).join("; ")}`);
    if (!Array.isArray(tf.failures)) problems.push("task_flows 缺 failures[]");
    else if (tf.failures.length) problems.push(`核心任务执行失败 ${tf.failures.length}/${tf.total}: ${tf.failures.slice(0, 3).map((x) => `${x?.id}(${x?.error})`).join("; ")}`);
    if (scenarioErrors.length) problems.push(`当前 scenarios.json 定义不合法: ${scenarioErrors.slice(0, 3).join("; ")}`);
    else if (Number.isInteger(tf.total) && tf.total !== scenarios.length) {
      problems.push(`task_flows.total=${tf.total} ≠ 当前 scenarios.json 场景数 ${scenarios.length}——执行记录与场景定义脱钩`);
    }
    if (Number.isInteger(tf.total) && Number.isInteger(tf.passed) && tf.passed !== tf.total) {
      problems.push(`核心任务通过 ${tf.passed}/${tf.total}（须全过）`);
    }
  }
  return problems;
}
