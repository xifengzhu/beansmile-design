#!/usr/bin/env node
// 把 skills/ 下的所有 Skill 以相对符号链接挂进 .claude/skills/ 与 .codex/skills/，
// 让 Claude Code 与 Codex CLI 在本仓库会话中直接发现并调用它们（SKILL.md 开放标准）。
// 幂等：链接正确则跳过，链接过期则重建；目标位置是真实目录/文件时不覆盖，只警告。
// 用法: node scripts/setup-agent-skills.mjs
import { readdirSync, existsSync, lstatSync, readlinkSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(repoRoot, "skills");
const targets = [".claude/skills", ".codex/skills"];

function listSkills() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name);
}

// 返回 linked/kept/skipped，符号链接指向不符时重建
function ensureLink(linkPath, relTarget) {
  if (existsSync(linkPath) || isLink(linkPath)) {
    if (isLink(linkPath)) {
      if (readlinkSync(linkPath) === relTarget) return "kept";
      unlinkSync(linkPath);
    } else {
      return "skipped";
    }
  }
  symlinkSync(relTarget, linkPath, "dir");
  return "linked";
}

function isLink(p) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

const skills = listSkills();
if (skills.length === 0) { console.error("skills/ 下没有含 SKILL.md 的目录"); process.exit(2); }

let hadSkip = false;
for (const target of targets) {
  const dir = join(repoRoot, target);
  mkdirSync(dir, { recursive: true });
  const counts = { linked: 0, kept: 0, skipped: 0 };
  for (const name of skills) {
    const result = ensureLink(join(dir, name), join("..", "..", "skills", name));
    counts[result] += 1;
    if (result === "skipped") {
      hadSkip = true;
      console.warn(`跳过 ${target}/${name}：已存在真实文件/目录，不覆盖，请手动处理`);
    }
  }
  console.log(`${target}: 新建 ${counts.linked}，已就绪 ${counts.kept}，跳过 ${counts.skipped}`);
}

console.log(`\n完成。在本仓库根目录开启会话：`);
console.log(`  Claude Code: /design-director 或直接描述设计任务（按 description 自动触发）`);
console.log(`  Codex CLI:   $design-director 或 /skills 选择器`);
process.exit(hadSkip ? 1 : 0);
