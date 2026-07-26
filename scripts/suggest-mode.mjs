#!/usr/bin/env node
// 快速模式建议 CLI（规范 27.8）。Director intake 时调用，把建议与理由呈给用户确认；
// 用户答复后经 director-advance --confirm mode 落盘，未确认不得进入快速模式。
// 用法: node scripts/suggest-mode.mjs --platforms web[,mobile_web] --pages <N> --flows <N>
//         --brand-exploration true|false [--task-type <t>] [--industry <slug>]
// 输出: JSON { mode, reasons }。退出码: 0 成功；2 参数错误。
import { suggestMode } from "./lib/mode-classifier.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const platformsArg = arg("--platforms");
const pagesArg = arg("--pages");
const flowsArg = arg("--flows");
const brandArg = arg("--brand-exploration");
if (!platformsArg && !pagesArg && !flowsArg && brandArg === undefined) {
  console.error("用法: node scripts/suggest-mode.mjs --platforms web --pages 1 --flows 2 --brand-exploration false [--task-type ..] [--industry ..]");
  process.exit(2);
}
const num = (v) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
const bool = (v) => (v === "true" ? true : v === "false" ? false : undefined);

const result = suggestMode({
  platforms: platformsArg ? platformsArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  task_type: arg("--task-type"),
  estimated_pages: num(pagesArg),
  estimated_flows: num(flowsArg),
  brand_exploration: bool(brandArg),
  industry: arg("--industry"),
});
console.log(JSON.stringify(result, null, 2));
console.error(`建议模式: ${result.mode}（${result.reasons.join("；")}）。呈给用户确认后用 director-advance.mjs --confirm mode 落盘。`);
