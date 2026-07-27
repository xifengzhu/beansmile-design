import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalDigest, sha256File } from "./hash.mjs";
import { designContractDigest, parseDesignDocument } from "./design-document.mjs";
import { makeValidator } from "./rules.mjs";
import { SCHEMAS } from "./paths.mjs";

export function designContractLockDigest(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return null;
  const { lock_digest, ...payload } = lock;
  return canonicalDigest(payload);
}

export function validateDesignContractLock(lock) {
  const validator = makeValidator().compile(
    JSON.parse(readFileSync(SCHEMAS.designContractLock, "utf8")),
  );
  if (validator(lock)) return [];
  return validator.errors.map((error) =>
    `contract-lock schema ${error.instancePath || "(root)"} ${error.message}`);
}

function confirmationDigest(confirmation) {
  const { contract_lock_sha256, ...payload } = confirmation ?? {};
  return canonicalDigest(payload);
}

export function checkDesignContractBinding(rootPath, ctx, artifact = null) {
  const root = resolve(rootPath);
  const issues = [];
  const design = ctx?.artifacts?.design_document;
  if (!design) return ["缺 artifacts.design_document"];
  if (design.path !== "Design.md") issues.push("artifacts.design_document.path 必须为 Design.md");
  if (design.phase !== "approved_contract") issues.push(`下游创作要求 Design.md phase=approved_contract，当前为 ${design.phase ?? "缺失"}`);
  if (design.stale === true) issues.push("Design.md 已标记 stale");

  const designPath = join(root, "Design.md");
  if (!existsSync(designPath)) return [...issues, "缺 Design.md"];
  const markdown = readFileSync(designPath, "utf8");
  const designSha = sha256File(designPath);
  if (design.sha256 !== designSha) issues.push("Design.md SHA-256 与 context 登记不符");
  const parsed = parseDesignDocument(markdown);
  issues.push(...parsed.errors);
  const digest = designContractDigest(parsed);
  if (parsed.frontmatter.phase !== "approved_contract") issues.push("Design.md frontmatter 不是 approved_contract");
  if (parsed.frontmatter.contract_digest !== digest) issues.push("Design.md frontmatter contract_digest 与锁定正文不符");
  if (design.contract_digest !== digest) issues.push("context design_document.contract_digest 与锁定正文不符");
  if (design.contract_revision !== parsed.frontmatter.contract_revision) issues.push("Design.md contract_revision 与 context 不符");
  if (design.contract_source_digest !== parsed.frontmatter.contract_source_digest) issues.push("Design.md contract_source_digest 与 context 不符");

  const lockPath = join(root, "audit", "design", "contract-lock.json");
  if (!existsSync(lockPath)) return [...issues, "缺 audit/design/contract-lock.json"];
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); }
  catch (error) { return [...issues, `contract-lock.json 非法 JSON: ${error.message}`]; }
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    return [...issues, "contract-lock.json 须为对象"];
  }
  issues.push(...validateDesignContractLock(lock));
  if (lock.lock_digest !== designContractLockDigest(lock)) issues.push("contract-lock lock_digest 不匹配");
  if (lock.contract_digest !== digest) issues.push("contract-lock contract_digest 与 Design.md 不符");
  if (lock.contract_revision !== design.contract_revision) issues.push("contract-lock contract_revision 与 context 不符");
  if (lock.contract_source_digest !== design.contract_source_digest) issues.push("contract-lock contract_source_digest 与 context 不符");
  if (lock.design_document_sha256 !== designSha) issues.push("contract-lock Design.md SHA-256 不符");
  const flowsPath = join(root, "flows.md");
  if (!existsSync(flowsPath)) issues.push("缺 flows.md");
  else if (lock.flows_sha256 !== sha256File(flowsPath)) issues.push("contract-lock flows.md SHA-256 不符");

  const confirmation = ctx?.confirmations?.flows;
  if (!confirmation) issues.push("缺 confirmations.flows 契约确认");
  else {
    if (confirmation.design_contract_digest !== digest) issues.push("confirmations.flows contract digest 不符");
    if (confirmation.flows_sha256 !== lock.flows_sha256) issues.push("confirmations.flows flows SHA-256 不符");
    if (confirmationDigest(confirmation) !== lock.confirmation_digest) issues.push("confirmations.flows confirmation digest 不符");
    const lockSha = sha256File(lockPath);
    if (confirmation.contract_lock_sha256 !== lockSha) issues.push("confirmations.flows contract lock SHA-256 不符");
    if (artifact) {
      if (artifact.design_contract_digest !== digest) issues.push("下游 artifact 缺失或绑定错误 design_contract_digest");
      if (artifact.contract_lock_sha256 !== lockSha) issues.push("下游 artifact 缺失或绑定错误 contract_lock_sha256");
    }
  }
  return [...new Set(issues)];
}
