// 加载并校验 5 个流程 Skill 的读写白名单清单。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { makeValidator } from "./rules.mjs";
import { SCHEMA_DIR, SCHEMAS } from "./paths.mjs";

const MANIFESTS_PATH = resolve(SCHEMA_DIR, "skill-manifests.yaml");

export function loadManifests() {
  const doc = yaml.load(readFileSync(MANIFESTS_PATH, "utf8"));
  if (!doc || !Array.isArray(doc.manifests)) {
    throw new Error("skill-manifests.yaml: 缺少顶层 manifests 数组");
  }
  const bySkill = new Map();
  for (const m of doc.manifests) bySkill.set(m.skill, m);
  return { manifests: doc.manifests, bySkill };
}

export function resolveManifest(skill, operation) {
  const { bySkill } = loadManifests();
  const manifest = bySkill.get(skill);
  if (!manifest) throw new Error(`未知 Skill: ${skill}`);

  if (manifest.operations) {
    if (!operation) throw new Error(`${skill} 需要 --operation`);
    const selected = manifest.operations[operation];
    if (!selected) throw new Error(`${skill} 未知 operation: ${operation}`);
    return {
      skill: manifest.skill,
      operation,
      reads: selected.reads,
      writes: selected.writes,
      produces: manifest.produces,
      required_modes: manifest.required_modes ?? [],
    };
  }

  if (operation) throw new Error(`${skill} 不支持 operation: ${operation}`);
  return { ...manifest, operation: null };
}

export function validateManifests() {
  const ajv = makeValidator();
  const schema = JSON.parse(readFileSync(SCHEMAS.skillManifest, "utf8"));
  const validate = ajv.compile(schema);
  const { manifests } = loadManifests();
  const errors = [];
  const seen = new Set();
  for (const m of manifests) {
    if (!validate(m)) {
      for (const e of validate.errors) {
        errors.push(`${m.skill ?? "(缺 skill)"}: ${e.instancePath || "(root)"} ${e.message}`);
      }
    }
    if (seen.has(m.skill)) errors.push(`重复 skill: ${m.skill}`);
    seen.add(m.skill);
  }
  return { ok: errors.length === 0, errors, count: manifests.length };
}
