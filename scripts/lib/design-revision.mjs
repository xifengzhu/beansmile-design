import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { canonicalDigest, hashPaths, listFilesRecursive, sha256File } from "./hash.mjs";
import { safePackagePath } from "./paths.mjs";
import { loadYaml, validateContext } from "./context.mjs";

const CONTRACT_ARTIFACT_KEYS = ["design_document", "tokens", "prototype", "presentation"];
const ALLOWED_STAGES = new Set(["ux", "visual", "prototype", "review"]);

export function artifactPathSha256(rootPath, path) {
  const root = resolve(rootPath);
  const target = safePackagePath(root, path);
  if (!target) throw new Error(`artifact 路径非法或越界: ${path}`);
  if (!existsSync(target)) throw new Error(`artifact 文件不存在: ${path}`);
  return statSync(target).isDirectory()
    ? canonicalDigest(hashPaths(root, [path]))
    : sha256File(target);
}

function evidenceFiles(root, dirPath) {
  const dir = join(root, dirPath);
  if (!existsSync(dir)) return [];
  return listFilesRecursive(dir).map((child) => {
    const path = `${dirPath}/${child}`;
    return { path, sha256: sha256File(join(root, path)) };
  });
}

function snapshotEvidence(root) {
  const base = join(root, "audit", "snapshots");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => /^[1-9][0-9]*$/.test(name) && statSync(join(base, name)).isDirectory())
    .map(Number)
    .sort((a, b) => a - b)
    .map((version) => ({
      version,
      path: `audit/snapshots/${version}`,
      sha256: canonicalDigest(hashPaths(root, [`audit/snapshots/${version}`])),
    }));
}

export function affectedContractArtifacts(ctx) {
  return CONTRACT_ARTIFACT_KEYS
    .filter((key) => ctx?.artifacts?.[key])
    .map((key) => ({ key, path: ctx.artifacts[key].path }));
}

function staleArtifact(artifact, key, oldRevision, reason) {
  return {
    ...artifact,
    ...(key === "design_document" ? { phase: "stale" } : {}),
    stale: true,
    stale_reason: reason,
    superseded_contract_revision: oldRevision,
  };
}

function restore(path, bytes) {
  if (bytes === null) rmSync(path, { force: true });
  else writeFileSync(path, bytes);
}

export function reviseDesignContract(rootPath, ctx, {
  reason,
  now = new Date().toISOString(),
  beforeCommit,
} = {}) {
  const root = resolve(rootPath);
  if (typeof reason !== "string" || !reason.trim()) throw new Error("缺少修订原因 reason");
  if (!ALLOWED_STAGES.has(ctx?.stage)) throw new Error(`当前 stage=${ctx?.stage ?? "缺失"} 不允许修订 design contract`);

  const contextPath = join(root, "context.yaml");
  if (!existsSync(contextPath)) throw new Error("缺 context.yaml");
  if (JSON.stringify(loadYaml(contextPath)) !== JSON.stringify(ctx)) throw new Error("调用方 context 与磁盘 context.yaml 不一致");
  const contextCheck = validateContext(ctx);
  if (!contextCheck.ok) throw new Error(`context.yaml 非法: ${contextCheck.errors.join("; ")}`);

  const design = ctx.artifacts?.design_document;
  if (!design) throw new Error("缺少已批准的 artifacts.design_document");
  if (design.stale === true || design.phase === "stale") throw new Error("Design.md contract 已 stale，不能重复修订");
  if (!["approved_contract", "implementation_ready"].includes(design.phase)) {
    throw new Error(`Design.md 不是有效 approved contract，当前 phase=${design.phase ?? "缺失"}`);
  }
  const oldRevision = design.contract_revision;
  if (!Number.isInteger(oldRevision) || oldRevision < 1) throw new Error("Design.md contract_revision 非法");
  if (!/^[a-f0-9]{64}$/.test(design.contract_digest ?? "")) throw new Error("Design.md contract_digest 非法");
  if (ctx.confirmations?.flows?.design_contract_digest !== design.contract_digest) {
    throw new Error("confirmations.flows 未绑定当前 approved contract");
  }
  if (design.sha256 !== artifactPathSha256(root, design.path)) throw new Error("Design.md SHA-256 与 context 登记不符");

  const newRevision = oldRevision + 1;
  const revisionsDir = join(root, "audit", "revisions");
  const recordPath = join(revisionsDir, `contract-${oldRevision}-to-${newRevision}.json`);
  if (existsSync(recordPath)) throw new Error(`revision record 已存在，拒绝覆盖: audit/revisions/contract-${oldRevision}-to-${newRevision}.json`);

  const artifacts = affectedContractArtifacts(ctx).map(({ key, path }) => ({
    key,
    path,
    sha256: artifactPathSha256(root, path),
  }));
  const snapshots = snapshotEvidence(root);
  const resultsPath = join(root, "audit", "results.json");
  const record = {
    record_version: 1,
    old_contract_revision: oldRevision,
    new_contract_revision: newRevision,
    old_contract_digest: design.contract_digest,
    reason: reason.trim(),
    revised_at: new Date(now).toISOString(),
    stage: ctx.stage,
    affected_artifacts: artifacts,
    current_results: existsSync(resultsPath)
      ? { path: "audit/results.json", sha256: sha256File(resultsPath) }
      : null,
    invalidated_snapshot_versions: snapshots.map((entry) => entry.version),
    snapshots,
    findings: evidenceFiles(root, "audit/findings"),
    presentation_qa: evidenceFiles(root, "audit/presentation"),
  };

  const nextArtifacts = { ...(ctx.artifacts ?? {}) };
  for (const key of CONTRACT_ARTIFACT_KEYS) {
    if (nextArtifacts[key]) nextArtifacts[key] = staleArtifact(nextArtifacts[key], key, oldRevision, reason.trim());
  }
  const nextConfirmations = { ...(ctx.confirmations ?? {}) };
  delete nextConfirmations.flows;
  delete nextConfirmations.direction;
  const nextContext = {
    ...ctx,
    artifacts: nextArtifacts,
    confirmations: nextConfirmations,
    stage: "ux",
  };
  const nextCheck = validateContext(nextContext);
  if (!nextCheck.ok) throw new Error(`回退后的 context 非法: ${nextCheck.errors.join("; ")}`);

  mkdirSync(revisionsDir, { recursive: true });
  const suffix = `.tmp-revision-${process.pid}-${Date.now()}`;
  const tempRecord = `${recordPath}${suffix}`;
  const tempContext = `${contextPath}${suffix}`;
  const oldContext = readFileSync(contextPath);
  const recordText = `${JSON.stringify(record, null, 2)}\n`;
  const contextText = yaml.dump(nextContext, { lineWidth: 100 });
  let recordCommitted = false;
  try {
    writeFileSync(tempRecord, recordText);
    writeFileSync(tempContext, contextText);
    beforeCommit?.({ root, record, nextContext });
    if (!readFileSync(contextPath).equals(oldContext) || existsSync(recordPath)) {
      throw new Error("revision 提交前源文件发生漂移");
    }
    renameSync(tempRecord, recordPath);
    recordCommitted = true;
    renameSync(tempContext, contextPath);
  } catch (error) {
    restore(contextPath, oldContext);
    if (recordCommitted) rmSync(recordPath, { force: true });
    rmSync(tempRecord, { force: true });
    rmSync(tempContext, { force: true });
    throw error;
  }
  return { context: nextContext, record, recordPath };
}
