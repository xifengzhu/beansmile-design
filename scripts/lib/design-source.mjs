import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { canonicalDigest, sha256File, sha256Text } from "./hash.mjs";
import { loadYaml, projectContext, validateContext } from "./context.mjs";
import { resolveManifest } from "./manifests.mjs";
import { loadRules, makeValidator } from "./rules.mjs";
import { applicableRules, loadRulePacks } from "./rule-packs.mjs";
import { SCHEMAS } from "./paths.mjs";

const SOURCE_VERSION = 1;
const CONTEXT_PATH = "audit/design/context.yaml";
const RULES_PATH = "audit/design/rules.yaml";
const MANIFEST_PATH = "audit/design/contract-source.json";
const DOWNSTREAM_ARTIFACTS = ["design_document", "tokens", "prototype", "presentation"];

function sourceDigest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const { generated_at, contract_source_digest, ...payload } = manifest;
  return canonicalDigest(payload);
}

function safePath(root, path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) return null;
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

function serializeContext(ctx) {
  const manifest = resolveManifest("design_specification", "prepare");
  return yaml.dump(projectContext(ctx, manifest.reads), { lineWidth: 120, sortKeys: true });
}

function frozenRules(ctx) {
  const applicable = applicableRules(
    ctx.project,
    loadRules().rules,
    loadRulePacks().packs,
  );
  const rules = applicable.map((entry) => {
    const { _file, ...card } = entry.rule;
    return {
      rule_id: entry.rule_id,
      pack_id: entry.pack_id,
      file: entry.file,
      sha256: entry.rule_sha256,
      rule: card,
    };
  });
  return {
    text: yaml.dump({ source_version: SOURCE_VERSION, rules }, { lineWidth: 120, sortKeys: true }),
    ruleIds: applicable.map((entry) => entry.rule_id),
  };
}

function validateNewSourceContext(root, ctx, contractRevision) {
  const validated = validateContext(ctx);
  if (!validated.ok) throw new Error(`context.yaml 非法: ${validated.errors.join("; ")}`);
  if (ctx.stage !== "ux") throw new Error(`design contract source 要求 stage=ux，当前为 ${ctx.stage}`);
  if ((ctx.project?.package_format_version ?? 0) < 3) {
    throw new Error("Design.md source 只适用于 package_format_version >= 3；历史包须先迁移");
  }

  for (const [key, expectedPath, owner] of [
    ["brief", "brief.md", "requirements_research"],
    ["flows", "flows.md", "ux_architecture"],
  ]) {
    const artifact = ctx.artifacts?.[key];
    if (!artifact) throw new Error(`缺 artifacts.${key} 登记`);
    if (artifact.path !== expectedPath) throw new Error(`artifacts.${key}.path 必须为 ${expectedPath}`);
    if (!/^[1-9][0-9]*$/.test(artifact.artifact_version ?? "")) {
      throw new Error(`artifacts.${key}.artifact_version 非法`);
    }
    if (artifact.updated_by !== owner) throw new Error(`artifacts.${key}.updated_by 必须为 ${owner}`);
    if (!existsSync(join(root, expectedPath))) throw new Error(`缺 ${expectedPath}`);
  }

  const staleArtifacts = [];
  for (const key of DOWNSTREAM_ARTIFACTS) {
    const artifact = ctx.artifacts?.[key];
    if (!artifact) continue;
    const staleForRevision = artifact.stale === true
      && artifact.superseded_contract_revision === contractRevision - 1;
    if (!staleForRevision) throw new Error(`存在未失效的下游 artifact: artifacts.${key}`);
    staleArtifacts.push(key);
  }
  if (staleArtifacts.length) {
    const oldRevision = contractRevision - 1;
    const recordPath = join(root, "audit", "revisions", `contract-${oldRevision}-to-${contractRevision}.json`);
    if (!existsSync(recordPath)) throw new Error(`缺匹配的 revision record: ${relative(root, recordPath)}`);
    let record;
    try { record = JSON.parse(readFileSync(recordPath, "utf8")); }
    catch (error) { throw new Error(`revision record 非法 JSON: ${error.message}`); }
    if (record.old_contract_revision !== oldRevision || record.new_contract_revision !== contractRevision) {
      throw new Error("revision record 的 old/new contract revision 与本次 source 不符");
    }
  }
}

function validateManifest(manifest) {
  const validator = makeValidator().compile(
    JSON.parse(readFileSync(SCHEMAS.designContractSource, "utf8")),
  );
  if (validator(manifest)) return [];
  return validator.errors.map((error) =>
    `contract-source schema ${error.instancePath || "(root)"} ${error.message}`);
}

function currentRevision(ctx) {
  const stale = ctx.artifacts?.design_document;
  if (!stale) return 1;
  return Number(stale.superseded_contract_revision ?? stale.contract_revision ?? 0) + 1;
}

export function buildContractSource(rootPath, {
  contractRevision,
  now = new Date().toISOString(),
  overwrite = true,
  beforeCommit,
} = {}) {
  const root = resolve(rootPath);
  const contextPath = join(root, "context.yaml");
  if (!existsSync(contextPath)) throw new Error("缺 context.yaml");
  const ctx = loadYaml(contextPath);
  const revision = contractRevision ?? currentRevision(ctx);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("contractRevision 必须为正整数");
  validateNewSourceContext(root, ctx, revision);

  const designDir = join(root, "audit", "design");
  if (existsSync(designDir) && !overwrite) {
    throw new Error(`${MANIFEST_PATH} 已存在；显式传 --overwrite 才可重建`);
  }

  const auditDir = join(root, "audit");
  mkdirSync(auditDir, { recursive: true });
  const work = join(auditDir, `.tmp-design-${process.pid}-${Date.now()}`);
  const backup = join(auditDir, `.tmp-design-backup-${process.pid}-${Date.now()}`);
  rmSync(work, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  let movedExisting = false;
  try {
    const contextText = serializeContext(ctx);
    const rules = frozenRules(ctx);
    writeFileSync(join(work, "context.yaml"), contextText);
    writeFileSync(join(work, "rules.yaml"), rules.text);

    const files = ["brief.md", "flows.md", ...(existsSync(join(root, "decisions.md")) ? ["decisions.md"] : [])]
      .sort()
      .map((path) => ({ path, sha256: sha256File(join(root, path)) }));
    const manifest = {
      source_version: SOURCE_VERSION,
      contract_revision: revision,
      generated_at: new Date(now).toISOString(),
      files,
      context: { path: CONTEXT_PATH, sha256: sha256Text(contextText) },
      rules: { path: RULES_PATH, sha256: sha256Text(rules.text), rule_ids: rules.ruleIds },
    };
    manifest.contract_source_digest = sourceDigest(manifest);
    const schemaIssues = validateManifest(manifest);
    if (schemaIssues.length) throw new Error(schemaIssues.join("; "));
    writeFileSync(join(work, "contract-source.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    beforeCommit?.({ root, work, manifest });
    if (existsSync(designDir)) {
      renameSync(designDir, backup);
      movedExisting = true;
    }
    renameSync(work, designDir);
    rmSync(backup, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    if (movedExisting && !existsSync(designDir) && existsSync(backup)) renameSync(backup, designDir);
    else rmSync(backup, { recursive: true, force: true });
    throw error;
  }
}

export function verifyContractSource(rootPath, suppliedManifest = null) {
  const root = resolve(rootPath);
  const issues = [];
  const manifestPath = join(root, MANIFEST_PATH);
  let manifest = suppliedManifest;
  if (!manifest) {
    if (!existsSync(manifestPath)) return [`缺 ${MANIFEST_PATH}`];
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch (error) { return [`${MANIFEST_PATH} 非法 JSON: ${error.message}`]; }
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["contract-source manifest 须为对象"];
  }

  issues.push(...validateManifest(manifest));
  if (manifest.contract_source_digest !== sourceDigest(manifest)) {
    issues.push("contract_source_digest 与 manifest 规范化内容不符");
  }

  const inputs = [
    ...(Array.isArray(manifest.files) ? manifest.files : []),
    manifest.context,
    manifest.rules,
  ].filter(Boolean);
  const filePaths = (Array.isArray(manifest.files) ? manifest.files : []).map((entry) => entry?.path);
  const sortedPaths = [...filePaths].sort();
  if (JSON.stringify(filePaths) !== JSON.stringify(sortedPaths)) issues.push("files 必须按 path 排序");
  if (new Set(filePaths).size !== filePaths.length) issues.push("files 含重复 path");
  if (manifest.context?.path !== CONTEXT_PATH) issues.push(`context 必须使用固定路径 ${CONTEXT_PATH}`);
  if (manifest.rules?.path !== RULES_PATH) issues.push(`rules 必须使用固定路径 ${RULES_PATH}`);
  for (const entry of inputs) {
    const target = safePath(root, entry.path);
    if (!target) {
      issues.push(`非法路径或越界到包外: ${entry.path}`);
      continue;
    }
    if (!existsSync(target)) issues.push(`冻结来源缺文件: ${entry.path}`);
    else if (sha256File(target) !== entry.sha256) issues.push(`冻结来源漂移: ${entry.path}`);
  }

  const contextPath = join(root, "context.yaml");
  if (!existsSync(contextPath)) return [...issues, "缺 context.yaml"];
  try {
    const ctx = loadYaml(contextPath);
    const contextText = serializeContext(ctx);
    if (manifest.context?.sha256 !== sha256Text(contextText)) issues.push("当前 context 投影与冻结 audit/design/context.yaml 漂移");
    const rules = frozenRules(ctx);
    if (manifest.rules?.sha256 !== sha256Text(rules.text)) issues.push("当前适用规则与冻结 audit/design/rules.yaml 漂移");
    if (JSON.stringify(manifest.rules?.rule_ids ?? []) !== JSON.stringify(rules.ruleIds)) {
      issues.push("当前适用 rule_ids 与冻结规则集合漂移");
    }
  } catch (error) {
    issues.push(`重算当前 context/规则失败: ${error.message}`);
  }
  return [...new Set(issues)];
}
