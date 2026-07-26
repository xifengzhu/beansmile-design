// N/A 候选扫描（分层扩展 §8.3）：对冻结原型的 html 做结构化扫描，标记 not_applicable_candidate。
// 候选只是提示，不能直接成为最终 not_applicable——reviewer 必须确认范围并填写证据。
// 保守起步，首批仅两条零歧义规则（元素/声明完全不存在才提示）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listFilesRecursive } from "./hash.mjs";

// 返回 Map<rule_id, reason>。prototypeDir 为冻结原型目录（audit/snapshots/<v>/prototype）。
export function naCandidates(prototypeDir) {
  const out = new Map();
  if (!existsSync(prototypeDir)) return out;
  const htmls = listFilesRecursive(prototypeDir).filter((f) => /\.html?$/i.test(f));
  if (!htmls.length) return out;

  let hasTable = false;
  let hasFontFace = false;
  for (const rel of htmls) {
    const text = readFileSync(join(prototypeDir, rel), "utf8");
    if (/<table\b/i.test(text)) hasTable = true;
    if (/@font-face\b/i.test(text)) hasFontFace = true;
    if (hasTable && hasFontFace) break;
  }
  if (!hasTable) out.set("web-data-table-semantics", "原型无数据表元素（全部 html 无 <table）");
  if (!hasFontFace) out.set("web-font-display-swap", "零 webfont，无字体加载风险面（全部 html 无 @font-face 声明）");
  return out;
}
