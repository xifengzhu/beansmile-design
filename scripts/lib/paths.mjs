// 运行时共享路径常量。所有 schema 以 docs/superpowers/specs/schemas 为单一来源。
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export const SCHEMA_DIR = resolve(REPO_ROOT, "docs/superpowers/specs/schemas");
export const RULES_DIR = resolve(REPO_ROOT, "evidence/rules");
export const RULE_PACKS_FILE = resolve(REPO_ROOT, "evidence/rule-packs.yaml");

export const SCHEMAS = {
  ruleCard: resolve(SCHEMA_DIR, "rule-card.schema.json"),
  rulePack: resolve(SCHEMA_DIR, "rule-pack.schema.json"),
  context: resolve(SCHEMA_DIR, "context.schema.json"),
  skillManifest: resolve(SCHEMA_DIR, "skill-manifest.schema.json"),
  findings: resolve(SCHEMA_DIR, "findings.schema.json"),
};
