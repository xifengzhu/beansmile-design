// 检查映射登记表（分层扩展 §8.3）：规则 ID → browser-check results.json 判定函数的显式映射。
// 只有"自动信号完全决定规则结论"的规则才入表——机器据此生成 prefilled_automated 覆盖行。
// 保守起步，首批仅三条。刻意不入表的例子：
//   wcag-2.1.1-keyboard —— keyboard_reachable_ratio 只证明"可聚焦元素可达"，不证明"所有功能
//   仅用键盘可完整操作"（拖拽、快捷键、时序交互等自动信号覆盖不到），可达率≠完整可操作性，
//   须人工复核，不得用部分自动信号冒充完整结论。
// decide(results) 返回 { result: "pass"|"fail", evidence } 或 null（信号缺失，无法自动判定 →
// 留给 review_required，不猜）。fail 同样是可信自动证据，照常 prefill。
export const CHECK_MAPPING = [
  {
    rule_id: "wcag-1.4.10-reflow",
    decide(results) {
      const reflowViolations = (results.violations ?? []).filter((v) => v.id === "reflow-320");
      if (results.reflow_ok === true && reflowViolations.length === 0) {
        return { result: "pass", evidence: "320px 实测无横向滚动（results.json reflow_ok=true，violations 无 reflow-320）" };
      }
      if (results.reflow_ok === false || reflowViolations.length > 0) {
        return {
          result: "fail",
          evidence: `320px 实测出现横向滚动（results.json reflow_ok=${results.reflow_ok}，reflow-320 违规 ${reflowViolations.length} 处：${reflowViolations.slice(0, 3).map((v) => v.page).join(",") || "-"}）`,
        };
      }
      return null; // reflow_ok 缺失（旧版产物等）：无自动信号，不判定
    },
  },
  {
    rule_id: "wcag-1.4.4-resize-text",
    decide(results) {
      if (results.zoom_ok === undefined) return null;
      const clipped640 = (results.clipped_text ?? []).filter((c) => c.viewport === 640);
      if (results.zoom_ok === true && clipped640.length === 0) {
        return { result: "pass", evidence: "200% 缩放（640px 视口）实测无横向滚动、无文本裁切（results.json zoom_ok=true, clipped_text@640=0）" };
      }
      return {
        result: "fail",
        evidence: `200% 缩放实测失败（results.json zoom_ok=${results.zoom_ok}，640px 视口文本裁切 ${clipped640.length} 处：${clipped640.slice(0, 3).map((c) => `${c.page} ${c.el}`).join("; ") || "-"}）`,
      };
    },
  },
  {
    rule_id: "wcag-2.4.7-focus-visible",
    decide(results) {
      const ratio = results.focus_visible_ratio;
      if (ratio === undefined) return null;
      if (ratio === 1) {
        return { result: "pass", evidence: "全部可聚焦元素聚焦时有可见样式变化（results.json focus_visible_ratio=1）" };
      }
      return { result: "fail", evidence: `可见焦点比例 ${(ratio * 100).toFixed(0)}% < 100%（results.json focus_visible_ratio=${ratio}）` };
    },
  },
];

export const CHECK_MAPPING_BY_ID = new Map(CHECK_MAPPING.map((m) => [m.rule_id, m]));

// 登记表自身的机器校验（接入 validate-system）：映射的 rule_id 必须存在于依据库、不得重复、
// decide 必须是函数。byIdRules: Map<rule_id, card>（loadRules().byId）。
export function validateCheckMapping(byIdRules) {
  const errors = [];
  const seen = new Set();
  for (const m of CHECK_MAPPING) {
    if (!m.rule_id) { errors.push("映射缺 rule_id"); continue; }
    if (seen.has(m.rule_id)) errors.push(`映射重复: ${m.rule_id}`);
    seen.add(m.rule_id);
    if (!byIdRules.has(m.rule_id)) errors.push(`映射指向依据库不存在的规则: ${m.rule_id}`);
    if (typeof m.decide !== "function") errors.push(`${m.rule_id}: decide 不是函数`);
  }
  return { ok: errors.length === 0, errors, count: CHECK_MAPPING.length };
}
