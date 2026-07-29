// 运行时共享路径常量。所有 schema 以仓库根目录 schemas/ 为单一来源。
import { fileURLToPath } from "node:url";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// 包内路径校验（唯一实现，勿再复制词法版本）：相对路径 + 词法不越界 + 已存在的
// 每一段都不得是 symlink——包内种 symlink 指向包外文件即可用包外内容满足冻结哈希，
// 这与 deliveryRevisionHistory 拒绝 symlink 记录同属一个威胁模型。
// 尚不存在的尾段无法是 symlink，直接放行（写入前校验场景）。
export function safePackagePath(rootPath, path) {
  if (typeof path !== "string" || !path || isAbsolute(path)) return null;
  const root = resolve(rootPath);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let stat;
    try { stat = lstatSync(current); } catch { break; }
    if (stat.isSymbolicLink()) return null;
  }
  return target;
}

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export const SCHEMA_DIR = resolve(REPO_ROOT, "schemas");
export const RULES_DIR = resolve(REPO_ROOT, "evidence/rules");
export const RULE_PACKS_FILE = resolve(REPO_ROOT, "evidence/rule-packs.yaml");

export const SCHEMAS = {
  ruleCard: resolve(SCHEMA_DIR, "rule-card.schema.json"),
  rulePack: resolve(SCHEMA_DIR, "rule-pack.schema.json"),
  context: resolve(SCHEMA_DIR, "context.schema.json"),
  skillManifest: resolve(SCHEMA_DIR, "skill-manifest.schema.json"),
  findings: resolve(SCHEMA_DIR, "findings.schema.json"),
  findingsDelta: resolve(SCHEMA_DIR, "findings-delta.schema.json"),
  designContractSource: resolve(SCHEMA_DIR, "design-contract-source.schema.json"),
  designContractLock: resolve(SCHEMA_DIR, "design-contract-lock.schema.json"),
  deliverySource: resolve(SCHEMA_DIR, "delivery-source.schema.json"),
};
