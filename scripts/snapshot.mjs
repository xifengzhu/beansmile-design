#!/usr/bin/env node
// 冻结当前交付物到只读快照 audit/snapshots/<version>/（规范 5.3）。评审只对快照进行。
// version 须单调递增；目标已存在则拒绝（保证快照不可变）。
// 用法: node scripts/snapshot.mjs --package <目录> --version <artifact_version>
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package"), version = arg("--version");
if (!pkg || !version) { console.error("用法: node scripts/snapshot.mjs --package <目录> --version <v>"); process.exit(2); }
const root = resolve(pkg);
const snapRoot = join(root, "audit", "snapshots");
mkdirSync(snapRoot, { recursive: true });

// 单调性：新版本号必须大于已有最大值
const existing = existsSync(snapRoot) ? readdirSync(snapRoot).filter((d) => /^\d+$/.test(d)).map(Number) : [];
if (existing.length && Number(version) <= Math.max(...existing)) {
  console.error(`✗ 版本 ${version} 不大于已有快照最大版本 ${Math.max(...existing)}，拒绝（须单调递增）`);
  process.exit(1);
}
const dest = join(snapRoot, String(version));
if (existsSync(dest)) { console.error(`✗ 快照 ${dest} 已存在，拒绝覆盖（快照不可变）`); process.exit(1); }
mkdirSync(dest, { recursive: true });

const items = ["prototype", "design-tokens.json", "decisions.md", "brief.md", "flows.md"];
const copied = [];
for (const it of items) {
  const src = join(root, it);
  if (existsSync(src)) { cpSync(src, join(dest, it), { recursive: true }); copied.push(it); }
}
console.log(`✓ 已冻结快照 v${version} → ${dest}（含 ${copied.join(", ")}）。评审仅授予此目录只读权限。`);
