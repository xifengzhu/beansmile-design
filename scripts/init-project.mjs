#!/usr/bin/env node
// 初始化一个交付包骨架 + 起始 context.yaml（stage=intake）。仅 Director 调用。
// 用法: node scripts/init-project.mjs --package <目录> --name <名> --mode professional|quick \
//        --task-type new_design|redesign --platforms web,mobile_web --primary-user <描述> \
//        --industry ecommerce|saas_b2b|general|<slug>（专业模式验收「行业依据」要求必填） \
//        --reference-system none|ant_design|carbon（主参考系统，默认 none，分层扩展 §6）
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { validateContext } from "./lib/context.mjs";

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

const pkg = arg("--package");
if (!pkg) { console.error("用法见文件头"); process.exit(2); }
const root = resolve(pkg);

const industry = arg("--industry");
const REFERENCE_SYSTEMS = ["none", "ant_design", "carbon"];
const referenceSystem = arg("--reference-system", "none");
if (!REFERENCE_SYSTEMS.includes(referenceSystem)) {
  console.error(`✗ 非法 --reference-system: ${referenceSystem}（合法值: ${REFERENCE_SYSTEMS.join("|")}）`);
  process.exit(2);
}
const ctx = {
  project: {
    name: arg("--name", "untitled"),
    mode: arg("--mode", "professional"),
    task_type: arg("--task-type", "new_design"),
    ...(industry ? { industry } : {}),
    reference_system: referenceSystem,
    platforms: arg("--platforms", "web").split(",").map((s) => s.trim()),
  },
  users: { primary: arg("--primary-user", "待定") },
  goals: {},
  stage: "intake",
  artifacts: {},
};

const v = validateContext(ctx);
if (!v.ok) { console.error("✗ 起始 context 非法：\n  " + v.errors.join("\n  ")); process.exit(1); }

for (const d of ["", "prototype", "audit", "audit/snapshots", "audit/findings", "audit/screenshots"]) {
  mkdirSync(join(root, d), { recursive: true });
}
const ctxPath = join(root, "context.yaml");
if (existsSync(ctxPath)) { console.error(`✗ ${ctxPath} 已存在，拒绝覆盖`); process.exit(1); }
writeFileSync(ctxPath, yaml.dump(ctx, { lineWidth: 100 }));
console.log(`✓ 已初始化交付包 ${root}（stage=intake, platforms=${ctx.project.platforms.join("/")}${industry ? `, industry=${industry}` : ""}, reference_system=${referenceSystem}）`);
if (!industry && ctx.project.mode === "professional") {
  console.log("  ! 未指定 --industry：专业模式验收「行业依据」会 fail。识别行业后补写 context.project.industry（通用产品用 general）。");
}
