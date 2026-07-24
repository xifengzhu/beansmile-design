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

// flow 类 id 必须与 manifest 一一对应；目录必须存在。
export function validateRegistry() {
  const { skills } = loadRegistry();
  const { bySkill } = loadManifests();
  const errors = [];
  const flowIds = skills.filter((s) => s.kind === "flow").map((s) => s.id);
  for (const id of flowIds) if (!bySkill.has(id)) errors.push(`registry flow id ${id} 在 manifest 中缺失`);
  for (const skill of bySkill.keys()) if (!flowIds.includes(skill)) errors.push(`manifest skill ${skill} 未在 registry 声明`);
  for (const s of skills) {
    const dir = resolve(REPO_ROOT, "skills", s.dir, "SKILL.md");
    if (!existsSync(dir)) errors.push(`${s.id}: 目录 skills/${s.dir}/SKILL.md 不存在`);
  }
  return { ok: errors.length === 0, errors, count: skills.length };
}
