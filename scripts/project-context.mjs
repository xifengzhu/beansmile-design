#!/usr/bin/env node
// 最小上下文投影 CLI（规范 27.6）：按 Skill manifest 的 reads 白名单生成 context.yaml
// 字段投影视图。Director 派发流程 Skill 时用投影 + 声明的输入产物路径，不再传完整
// context.yaml——投影与 hardenedGate 的越权检测共用同一份 manifest，无第二实现。
// 评审 Agent 本就禁读 context（§5.3），不在本 CLI 服务范围。
// 用法: node scripts/project-context.mjs --package <目录> --skill <canonical id> [--out <文件>]
// 退出码: 0 成功；2 参数错误/未知 skill。
import { existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { loadYaml, projectContext } from "./lib/context.mjs";
import { loadManifests } from "./lib/manifests.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), skill = arg("--skill"), out = arg("--out");
if (!pkg || !skill) {
  console.error("用法: node scripts/project-context.mjs --package <目录> --skill <canonical id，如 html_prototype> [--out <文件>]");
  process.exit(2);
}
const { bySkill } = loadManifests();
const manifest = bySkill.get(skill);
if (!manifest) {
  console.error(`✗ 未知 skill: ${skill}（可选: ${[...bySkill.keys()].join(", ")}；注意用 canonical snake_case ID）`);
  process.exit(2);
}
const ctxPath = join(resolve(pkg), "context.yaml");
if (!existsSync(ctxPath)) { console.error(`✗ 缺 ${ctxPath}`); process.exit(2); }

const view = projectContext(loadYaml(ctxPath), manifest.reads);
const header = `# ${skill} 的 reads 投影视图（规范 27.6）：只含该 Skill 声明可读的字段。\n# 这不是完整 context.yaml——不要回写、不要据此推断未投影字段不存在。\n# reads: [${manifest.reads.join(", ")}]\n`;
const text = header + yaml.dump(view, { lineWidth: 120 });

if (out) {
  writeFileSync(resolve(out), text);
  console.log(`✓ ${skill} 上下文投影（${manifest.reads.length} 个 reads 路径）→ ${resolve(out)}`);
} else {
  process.stdout.write(text);
}
