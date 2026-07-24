#!/usr/bin/env node
// 聚合当前版本的两份评审 findings，生成 audit/report.md，并给出可否交付的综合判定。
// 只有两评审 blocker 均为 0 才可交付（规范 7.8、14.2）。不做多数票，冲突由 Director 裁决。
// 用法: node scripts/aggregate-reviews.mjs --package <目录> --version <artifact_version>
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadFindingsForVersion, countBlockers } from "./lib/findings.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), version = arg("--version");
if (!pkg || !version) { console.error("用法: node scripts/aggregate-reviews.mjs --package <目录> --version <v>"); process.exit(2); }
const root = resolve(pkg);

const f = loadFindingsForVersion(root, version);
if (f.errors.length) { console.error("✗ 无法聚合评审：\n  " + f.errors.join("\n  ")); process.exit(1); }

const sev = (doc, s) => (doc.findings ?? []).filter((x) => x.severity === s);
function section(doc) {
  const lines = [];
  for (const s of ["blocker", "warning", "note"]) {
    const items = sev(doc, s);
    if (!items.length) continue;
    lines.push(`\n**${s.toUpperCase()}（${items.length}）**\n`);
    for (const x of items) lines.push(`- \`${x.location}\`${x.rule_id ? ` [${x.rule_id}]` : ""}：${x.evidence} — 影响：${x.user_impact}；建议：${x.recommendation}`);
  }
  return lines.join("\n") || "\n（无）";
}

const sB = countBlockers(f.standards), vB = countBlockers(f.visual);
const deliverable = sB === 0 && vB === 0;
const md = `# 评审聚合报告（artifact_version ${version}）

综合判定：${deliverable ? "**可交付**（两评审 blocker 均为 0）" : "**不可交付**（存在 blocker）"}

- 规范审计：verdict=${f.standards.verdict}，blocker=${sB}，warning=${sev(f.standards, "warning").length}，note=${sev(f.standards, "note").length}
- 视觉评审：verdict=${f.visual.verdict}，blocker=${vB}，warning=${sev(f.visual, "warning").length}，note=${sev(f.visual, "note").length}

## 规范审计 findings
${section(f.standards)}

## 视觉评审 findings
${section(f.visual)}

---
> 两评审独立、只读、互不可见。冲突与覆盖由 Director 裁决并记入 decisions.md（规范 5.5）。warning 可带说明交付，note 为非必要改进。
`;

mkdirSync(join(root, "audit"), { recursive: true });
writeFileSync(join(root, "audit", "report.md"), md);
console.log(`✓ 已生成 audit/report.md：${deliverable ? "可交付" : "不可交付"}（standards blocker=${sB}, visual blocker=${vB}）`);
process.exit(deliverable ? 0 : 1);
