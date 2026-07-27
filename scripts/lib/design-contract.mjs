import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { canonicalDigest, sha256File, sha256Text } from "./hash.mjs";
import { hardenedGate, loadYaml, validateContext } from "./context.mjs";
import { resolveManifest } from "./manifests.mjs";
import { designContractDigest, parseDesignDocument, proposedContractIssues } from "./design-document.mjs";
import { verifyContractSource } from "./design-source.mjs";
import {
  checkDesignContractBinding,
  designContractLockDigest,
  validateDesignContractLock,
} from "./design-contract-binding.mjs";

export { checkDesignContractBinding } from "./design-contract-binding.mjs";

const LOCK_REL = "audit/design/contract-lock.json";

function hasEntries(path) {
  return existsSync(path) && readdirSync(path).some((entry) => !entry.startsWith("."));
}

function sealedMarkdown(markdown, approvedAt) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(markdown);
  if (!match) throw new Error("Design.md 缺 frontmatter，无法 seal");
  const lines = match[1].split(/\r?\n/);
  if (lines.some((line) => /^approved_at\s*:/.test(line))) throw new Error("proposed Design.md 不得预填 approved_at");
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (/^phase\s*:\s*proposed_contract\s*$/.test(line)) {
      replaced = true;
      return "phase: approved_contract";
    }
    return line;
  });
  if (!replaced) throw new Error("Design.md phase 不是 proposed_contract");
  nextLines.push(`approved_at: "${approvedAt}"`);
  return `---\n${nextLines.join("\n")}\n---${match[2]}${markdown.slice(match[0].length)}`;
}

function restore(path, bytes) {
  if (bytes === null) rmSync(path, { force: true });
  else writeFileSync(path, bytes);
}

export function sealDesignContract(rootPath, ctx, {
  summary,
  userReply,
  provisionalPatch,
  now = new Date().toISOString(),
  beforeCommit,
} = {}) {
  const root = resolve(rootPath);
  if (typeof summary !== "string" || !summary.trim()) throw new Error("缺确认摘要 summary");
  if (typeof userReply !== "string" || !userReply.trim()) throw new Error("缺用户答复原文 user reply");
  if (!provisionalPatch || typeof provisionalPatch !== "object") throw new Error("缺 design provisional 补丁");
  if (ctx?.stage !== "ux") throw new Error(`seal 要求 stage=ux，当前为 ${ctx?.stage}`);

  const contextPath = join(root, "context.yaml");
  const designPath = join(root, "Design.md");
  const sourcePath = join(root, "audit", "design", "contract-source.json");
  const lockPath = join(root, LOCK_REL);
  if (!existsSync(contextPath) || !existsSync(designPath) || !existsSync(sourcePath)) throw new Error("seal 缺 context.yaml、Design.md 或 contract-source.json");
  if (existsSync(lockPath)) throw new Error(`${LOCK_REL} 已存在，拒绝覆盖旧 lock`);
  if (JSON.stringify(loadYaml(contextPath)) !== JSON.stringify(ctx)) throw new Error("调用方 context 与磁盘 context.yaml 不一致");
  for (const key of ["design_document", "tokens", "prototype", "presentation"]) {
    if (ctx.artifacts?.[key]) throw new Error(`seal 前存在下游 artifact: artifacts.${key}`);
  }
  if (hasEntries(join(root, "audit", "snapshots"))) throw new Error("seal 前已存在 snapshot/快照");
  if (hasEntries(join(root, "audit", "findings"))) throw new Error("seal 前已存在 findings");

  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const sourceIssues = verifyContractSource(root, source);
  if (sourceIssues.length) throw new Error(`contract source 漂移: ${sourceIssues.join("; ")}`);
  const originalMarkdown = readFileSync(designPath, "utf8");
  const parsed = parseDesignDocument(originalMarkdown);
  const documentIssues = proposedContractIssues(root, parsed, source);
  if (documentIssues.length) throw new Error(`proposed Design.md 非法: ${documentIssues.join("; ")}`);

  const manifest = resolveManifest("design_specification", "prepare");
  const patchResult = hardenedGate(manifest, ctx, { patch: provisionalPatch, packageRoot: root });
  if (!patchResult.ok) {
    throw new Error(`provisional 补丁未通过门禁: ${[...patchResult.violations, ...patchResult.reasons].join("; ")}`);
  }
  const proposedArtifact = patchResult.after.artifacts?.design_document;
  if (proposedArtifact?.path !== "Design.md"
    || proposedArtifact?.phase !== "proposed_contract"
    || proposedArtifact?.updated_by !== "design_specification") {
    throw new Error("provisional 补丁的 Design.md path/phase/updated_by 不合法");
  }
  if (proposedArtifact.sha256 !== sha256File(designPath)) throw new Error("provisional 补丁 sha256 与 Design.md 不符");
  if (proposedArtifact.contract_digest !== designContractDigest(parsed)) throw new Error("provisional 补丁 contract_digest 不符");
  if (proposedArtifact.contract_source_digest !== source.contract_source_digest) throw new Error("provisional 补丁 contract_source_digest 不符");
  if (proposedArtifact.contract_revision !== source.contract_revision) throw new Error("provisional 补丁 contract_revision 不符");

  const sealedAt = new Date(now).toISOString();
  const nextMarkdown = sealedMarkdown(originalMarkdown, sealedAt);
  const nextParsed = parseDesignDocument(nextMarkdown);
  const lockedDigest = designContractDigest(parsed);
  if (designContractDigest(nextParsed) !== lockedDigest) throw new Error("seal 改变了第一部分锁定正文");
  if (nextParsed.frontmatter.phase !== "approved_contract") throw new Error("seal 后 phase 不是 approved_contract");
  const designSha = sha256Text(nextMarkdown);
  const flowsSha = sha256File(join(root, "flows.md"));
  const confirmationBase = {
    summary,
    user_reply: userReply,
    decided_at: sealedAt,
    flows_sha256: flowsSha,
    design_contract_digest: lockedDigest,
  };
  const lockPayload = {
    lock_version: 1,
    contract_revision: source.contract_revision,
    contract_digest: lockedDigest,
    contract_source_digest: source.contract_source_digest,
    design_document_sha256: designSha,
    flows_sha256: flowsSha,
    confirmation_digest: canonicalDigest(confirmationBase),
    sealed_at: sealedAt,
    sealed_at_stage: "ux",
    transition_target: "visual",
    downstream_absent: true,
  };
  const lock = { ...lockPayload, lock_digest: canonicalDigest(lockPayload) };
  const lockIssues = validateDesignContractLock(lock);
  if (lockIssues.length || lock.lock_digest !== designContractLockDigest(lock)) throw new Error(`contract lock 非法: ${lockIssues.join("; ")}`);
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;
  const lockSha = sha256Text(lockText);
  const confirmation = { ...confirmationBase, contract_lock_sha256: lockSha };
  const nextContext = {
    ...patchResult.after,
    artifacts: {
      ...patchResult.after.artifacts,
      design_document: {
        ...proposedArtifact,
        phase: "approved_contract",
        sha256: designSha,
      },
    },
    confirmations: { ...(patchResult.after.confirmations ?? {}), flows: confirmation },
  };
  const contextIssues = validateContext(nextContext);
  if (!contextIssues.ok) throw new Error(`seal 后 context 非法: ${contextIssues.errors.join("; ")}`);
  const contextText = yaml.dump(nextContext, { lineWidth: 100 });

  mkdirSync(join(root, "audit", "design"), { recursive: true });
  const suffix = `.tmp-seal-${process.pid}-${Date.now()}`;
  const tempDesign = `${designPath}${suffix}`;
  const tempLock = `${lockPath}${suffix}`;
  const tempContext = `${contextPath}${suffix}`;
  const oldDesign = readFileSync(designPath);
  const oldContext = readFileSync(contextPath);
  const oldLock = existsSync(lockPath) ? readFileSync(lockPath) : null;
  try {
    writeFileSync(tempDesign, nextMarkdown);
    writeFileSync(tempLock, lockText);
    writeFileSync(tempContext, contextText);
    beforeCommit?.({ root, nextContext, lock, markdown: nextMarkdown });
    if (!readFileSync(designPath).equals(oldDesign) || !readFileSync(contextPath).equals(oldContext) || existsSync(lockPath)) {
      throw new Error("seal 提交前源文件发生漂移");
    }
    renameSync(tempDesign, designPath);
    renameSync(tempLock, lockPath);
    renameSync(tempContext, contextPath);
  } catch (error) {
    restore(designPath, oldDesign);
    restore(lockPath, oldLock);
    restore(contextPath, oldContext);
    rmSync(tempDesign, { force: true });
    rmSync(tempLock, { force: true });
    rmSync(tempContext, { force: true });
    throw error;
  }
  return { context: nextContext, lock, markdown: nextMarkdown };
}
