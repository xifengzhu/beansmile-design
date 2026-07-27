// Skill/Agent 注册表加载与一致性校验。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { REPO_ROOT } from "./paths.mjs";
import { loadManifests } from "./manifests.mjs";

const REGISTRY_PATH = resolve(REPO_ROOT, "skills/registry.yaml");

export function loadRegistry() {
  const doc = yaml.load(readFileSync(REGISTRY_PATH, "utf8"));
  const byId = new Map();
  for (const s of doc.skills) byId.set(s.id, s);
  return { skills: doc.skills, byId };
}

// 会返回 context 补丁的 flow/deliverable 必须与 manifest 一一对应；其余角色不得有 manifest。
export function validateRegistry() {
  const { skills } = loadRegistry();
  const { manifests, bySkill } = loadManifests();
  const errors = [];
  const patchCapableIds = skills
    .filter((s) => ["flow", "deliverable"].includes(s.kind))
    .map((s) => s.id);
  const seenRegistry = new Set();
  for (const skill of skills) {
    if (seenRegistry.has(skill.id)) errors.push(`重复 registry id: ${skill.id}`);
    seenRegistry.add(skill.id);
  }
  const seenManifests = new Set();
  for (const manifest of manifests) {
    if (seenManifests.has(manifest.skill)) errors.push(`重复 manifest skill: ${manifest.skill}`);
    seenManifests.add(manifest.skill);
  }
  for (const id of patchCapableIds) {
    if (!bySkill.has(id)) errors.push(`registry patch-capable id ${id} 在 manifest 中缺失`);
  }
  for (const skill of bySkill.keys()) {
    if (!patchCapableIds.includes(skill)) errors.push(`manifest skill ${skill} 未声明为 flow/deliverable`);
  }
  for (const s of skills) {
    const dir = resolve(REPO_ROOT, "skills", s.dir, "SKILL.md");
    if (!existsSync(dir)) errors.push(`${s.id}: 目录 skills/${s.dir}/SKILL.md 不存在`);
  }
  return { ok: errors.length === 0, errors, count: skills.length };
}
