// 快速模式自动分类（规范 27.8）。纯函数，只产生**建议**——Director 须把理由呈给用户，
// 经 director-advance --confirm mode 记录用户确认后才生效，不得静默降级。
// 保守取向：任一输入缺失或超界一律建议专业模式（不猜）。
// 快速模式的硬底线（WCAG AA、多视口截图、溢出/console、依据记录）是验收无条件维度，
// 不受模式建议影响（§9.2）。
export function suggestMode(input = {}) {
  const { platforms, task_type, estimated_pages, estimated_flows, brand_exploration, industry } = input;
  const reasons = [];
  const pro = (reason) => ({ mode: "professional", reasons: [reason] });

  if (!Array.isArray(platforms) || platforms.length === 0) return pro("platforms 未提供——信息不全不猜，走专业模式");
  if (typeof estimated_pages !== "number") return pro("estimated_pages 未提供——信息不全不猜，走专业模式");
  if (typeof estimated_flows !== "number") return pro("estimated_flows 未提供——信息不全不猜，走专业模式");
  if (typeof brand_exploration !== "boolean") return pro("brand_exploration 未明确——是否需要品牌方向探索未定，走专业模式");

  if (platforms.length > 1) return pro(`多平台（${platforms.join(",")}）需要跨平台一致性设计，走专业模式`);
  if (estimated_pages > 1) return pro(`${estimated_pages} 个页面需要 IA 与方向竞争，走专业模式`);
  if (estimated_flows > 2) return pro(`${estimated_flows} 条流程超出简单任务范围，走专业模式`);
  if (brand_exploration) return pro("需要品牌方向探索（2–3 方向竞争是专业模式核心价值），走专业模式");
  if (industry && industry !== "general") return pro(`行业 ${industry} 有领域纪律要求，走专业模式`);

  reasons.push(`单页（${estimated_pages}）`, `流程 ≤2（${estimated_flows}）`, "无品牌探索", `单平台（${platforms[0]}）`);
  if (task_type) reasons.push(`任务类型 ${task_type}`);
  return { mode: "quick", reasons };
}
