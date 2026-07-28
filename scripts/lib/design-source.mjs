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
import { isAbsolute, join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import {
  canonicalDigest,
  diffHashMaps,
  hashPaths,
  manifestDigest,
  sha256File,
  sha256Text,
  verifyManifest,
} from "./hash.mjs";
import { loadYaml, projectContext, validateContext } from "./context.mjs";
import { resolveManifest } from "./manifests.mjs";
import { loadRules, makeValidator } from "./rules.mjs";
import { applicableRules, loadRulePacks } from "./rule-packs.mjs";
import { SCHEMAS } from "./paths.mjs";
import { checkDesignContractBinding } from "./design-contract.mjs";
import { requiresDesignContract } from "./delivery.mjs";
import {
  countBlockers,
  loadFindingsForVersion,
  semanticIssuesStandards,
  semanticIssuesVisual,
} from "./findings.mjs";
import { loadFrozenRules } from "./frozen-rules.mjs";
import { templateClosureIssues } from "./coverage-template.mjs";

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

function artifactPathSha256(root, path) {
  const target = safePath(root, path);
  if (!target) throw new Error(`artifact 路径非法或越界: ${path}`);
  if (!existsSync(target)) throw new Error(`artifact 文件不存在: ${path}`);
  return statSync(target).isDirectory()
    ? canonicalDigest(hashPaths(root, [path]))
    : sha256File(target);
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
    const oldDesign = ctx.artifacts?.design_document;
    if (!oldDesign || record.old_contract_digest !== oldDesign.contract_digest) {
      throw new Error("revision record 的 old contract digest 与 stale Design.md 不符");
    }
    if (!Array.isArray(record.affected_artifacts)) throw new Error("revision record 缺 affected_artifacts");
    const byKey = new Map(record.affected_artifacts.map((entry) => [entry?.key, entry]));
    for (const key of staleArtifacts) {
      const artifact = ctx.artifacts[key];
      const entry = byKey.get(key);
      if (!entry || entry.path !== artifact.path) throw new Error(`revision record 未绑定 stale artifact: ${key}`);
      let currentSha;
      try { currentSha = artifactPathSha256(root, artifact.path); }
      catch (error) { throw new Error(`revision record 的 ${key} 证据不可验证: ${error.message}`); }
      if (entry.sha256 !== currentSha) throw new Error(`revision record 的 affected artifact 哈希不符: ${key}`);
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

const DELIVERY_CONTEXT_PATH = "audit/delivery/context.yaml";
const DELIVERY_MANIFEST_PATH = "audit/delivery/source-manifest.json";

function deliverySourceDigest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const { generated_at, source_bundle_digest, ...payload } = manifest;
  return canonicalDigest(payload);
}

function serializeDeliveryContext(ctx) {
  const manifest = resolveManifest("design_specification", "finalize");
  return yaml.dump(projectContext(ctx, manifest.reads), { lineWidth: 120, sortKeys: true });
}

function validateDeliveryManifest(manifest) {
  const validator = makeValidator().compile(
    JSON.parse(readFileSync(SCHEMAS.deliverySource, "utf8")),
  );
  if (validator(manifest)) return [];
  return validator.errors.map((error) =>
    `delivery-source schema ${error.instancePath || "(root)"} ${error.message}`);
}

function lockedContractContextIssues(root, ctx, design) {
  const issues = [];
  const manifestPath = join(root, MANIFEST_PATH);
  let manifest;
  if (!existsSync(manifestPath)) return [`缺 ${MANIFEST_PATH}`];
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (error) { return [`${MANIFEST_PATH} 非法 JSON: ${error.message}`]; }
  issues.push(...validateManifest(manifest));
  if (manifest.contract_source_digest !== sourceDigest(manifest)) {
    issues.push("contract source manifest 摘要不符");
  }
  if (design?.contract_source_digest !== manifest.contract_source_digest) {
    issues.push("Design.md contract_source_digest 与 contract source manifest 不符");
  }

  const frozenContextPath = safePath(root, manifest.context?.path);
  if (!frozenContextPath || manifest.context?.path !== CONTEXT_PATH) {
    issues.push(`contract source context 必须使用 ${CONTEXT_PATH}`);
    return issues;
  }
  if (!existsSync(frozenContextPath)) return [...issues, `缺 ${CONTEXT_PATH}`];
  if (sha256File(frozenContextPath) !== manifest.context?.sha256) {
    issues.push("冻结 contract context SHA-256 与 source manifest 不符");
  }
  try {
    const frozen = loadYaml(frozenContextPath);
    const prepareManifest = resolveManifest("design_specification", "prepare");
    const postLockFactFields = new Set(["decisions", "assumptions", "exceptions"]);
    const lockedReads = prepareManifest.reads.filter((path) => !postLockFactFields.has(path));
    const currentLocked = projectContext(ctx, lockedReads);
    const frozenLocked = projectContext(frozen, lockedReads);
    if (canonicalDigest(currentLocked) !== canonicalDigest(frozenLocked)) {
      issues.push("当前 prepare context 相对冻结 contract context 漂移，必须修订设计契约");
    }
    for (const field of postLockFactFields) {
      const beforeEntries = Array.isArray(frozen[field]) ? frozen[field] : [];
      const currentEntries = Array.isArray(ctx[field]) ? ctx[field] : [];
      const ids = currentEntries.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) issues.push(`${field} 含重复 id`);
      const currentById = new Map(currentEntries.map((entry) => [entry.id, entry]));
      for (const before of beforeEntries) {
        const current = currentById.get(before.id);
        if (!current) {
          issues.push(`冻结 contract context 的 ${field}.${before.id} 被删除`);
          continue;
        }
        for (const [key, value] of Object.entries(before)) {
          const assumptionResolved = field === "assumptions"
            && key === "status"
            && value === "tentative"
            && ["tentative", "confirmed", "rejected"].includes(current[key]);
          if (!assumptionResolved && canonicalDigest(current[key]) !== canonicalDigest(value)) {
            issues.push(`冻结 contract context 的 ${field}.${before.id}.${key} 被改写`);
          }
        }
      }
    }
  } catch (error) {
    issues.push(`冻结 contract context 非法: ${error.message}`);
  }
  return issues;
}

function deliveryInputIssues(root, ctx, { allowFinalDesign = false, approvedDesign = null } = {}) {
  const issues = [];
  const contextCheck = validateContext(ctx);
  if (!contextCheck.ok) issues.push(...contextCheck.errors.map((error) => `context: ${error}`));
  if (ctx.stage !== "review" && !(allowFinalDesign && ctx.stage === "delivered")) {
    issues.push(`delivery source 要求 stage=review，当前为 ${ctx.stage}`);
  }
  if (!requiresDesignContract(ctx)) issues.push("当前包未启用 design_specification");
  const activeDesign = ctx.artifacts?.design_document;
  const design = approvedDesign ?? activeDesign;
  const version = ctx.artifacts?.prototype?.artifact_version;
  issues.push(...lockedContractContextIssues(root, ctx, design));
  if (!allowFinalDesign && (!activeDesign || activeDesign.phase !== "approved_contract" || activeDesign.stale === true)) {
    issues.push(`最终交付来源要求 active approved_contract Design.md，当前为 ${activeDesign?.phase ?? "缺失"}`);
  }
  if (allowFinalDesign) {
    if (!design || design.phase !== "approved_contract" || design.stale === true) {
      issues.push(`冻结 delivery context 缺 active approved_contract Design.md，当前为 ${design?.phase ?? "缺失"}`);
    }
    if (!activeDesign || !["approved_contract", "implementation_ready"].includes(activeDesign.phase) || activeDesign.stale === true) {
      issues.push(`finalize 校验要求 approved_contract 或 implementation_ready Design.md，当前为 ${activeDesign?.phase ?? "缺失"}`);
    } else if (design) {
      if (activeDesign.contract_revision !== design.contract_revision) issues.push("active Design.md contract_revision 与冻结 approved baseline 不符");
      if (activeDesign.contract_digest !== design.contract_digest) issues.push("active Design.md contract_digest 与冻结 approved baseline 不符");
      if (activeDesign.contract_source_digest !== design.contract_source_digest) issues.push("active Design.md contract_source_digest 与冻结 approved baseline 不符");
    }
  }
  if (allowFinalDesign) {
    const lockPath = join(root, "audit", "design", "contract-lock.json");
    const lockSha = ctx.confirmations?.flows?.contract_lock_sha256;
    if (!existsSync(lockPath)) issues.push("缺 audit/design/contract-lock.json");
    else if (sha256File(lockPath) !== lockSha) issues.push("active contract lock SHA-256 与 confirmation 不符");
    for (const [key, artifact] of [["tokens", ctx.artifacts?.tokens], ["prototype", ctx.artifacts?.prototype]]) {
      if (!artifact) issues.push(`缺 artifacts.${key}`);
      else {
        if (artifact.design_contract_digest !== design?.contract_digest) issues.push(`artifacts.${key} contract digest 不符`);
        if (artifact.contract_lock_sha256 !== lockSha) issues.push(`artifacts.${key} contract lock SHA-256 不符`);
      }
    }
  } else {
    for (const artifact of [null, ctx.artifacts?.tokens, ctx.artifacts?.prototype]) {
      issues.push(...checkDesignContractBinding(root, ctx, artifact));
    }
  }
  if (!version) return { issues: [...new Set(issues)], version, design, snapshot: null, frozen: null, findings: null };

  const snapDir = join(root, "audit", "snapshots", String(version));
  const snapshotPath = join(snapDir, "manifest.json");
  let snapshot = null;
  if (!existsSync(snapshotPath)) issues.push(`缺当前 snapshot manifest: audit/snapshots/${version}/manifest.json`);
  else {
    try { snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")); }
    catch (error) { issues.push(`snapshot manifest 非法 JSON: ${error.message}`); }
  }
  if (snapshot) {
    if (snapshot.digest !== manifestDigest(snapshot)) issues.push("snapshot manifest digest 不符");
    issues.push(...verifyManifest(snapDir, snapshot));
    for (const required of ["Design.md", "audit/design/contract-source.json", "audit/design/contract-lock.json"]) {
      if (!Object.keys(snapshot.files ?? {}).some((path) => path === required || path.startsWith(`${required}/`))) {
        issues.push(`version-3 snapshot 缺 ${required}`);
      }
    }
    const bindingContext = approvedDesign
      ? { ...ctx, artifacts: { ...ctx.artifacts, design_document: approvedDesign } }
      : ctx;
    for (const artifact of [null, ctx.artifacts?.tokens, ctx.artifacts?.prototype]) {
      issues.push(...checkDesignContractBinding(snapDir, bindingContext, artifact).map((issue) => `snapshot: ${issue}`));
    }
    const activeHashes = hashPaths(root, ["prototype", "design-tokens.json"]);
    issues.push(...diffHashMaps(snapshot.files ?? {}, activeHashes, ["prototype", "design-tokens.json"])
      .map((issue) => `活动产物相对 reviewed snapshot ${issue}`));
  }

  const frozen = loadFrozenRules(root, version);
  if (!frozen.ok) issues.push(...frozen.errors.map((error) => `snapshot rules: ${error}`));
  else if ((frozen.manifest.snapshot_version ?? 1) < 3) issues.push(`snapshot v${version} 不是 snapshot_version 3`);

  const findings = loadFindingsForVersion(root, version);
  if (findings.errors.length) issues.push(...findings.errors.map((error) => `findings: ${error}`));
  const decisionsPath = join(root, "decisions.md");
  const decisions = existsSync(decisionsPath) ? readFileSync(decisionsPath, "utf8") : "";
  for (const reviewer of ["standards", "visual"]) {
    const doc = findings[reviewer];
    if (!doc) continue;
    if (doc.verdict !== "pass") issues.push(`${reviewer} findings verdict=${doc.verdict}`);
    if (countBlockers(doc) > 0) issues.push(`${reviewer} findings 存在 blocker`);
    const unhandled = (doc.findings ?? [])
      .filter((finding) => finding.severity === "warning" && !decisions.includes(`[finding:${finding.id}]`))
      .map((finding) => finding.id);
    if (unhandled.length) issues.push(`${reviewer} findings 有未处理 warning，decisions.md 缺 ${unhandled.map((id) => `[finding:${id}]`).join(", ")}`);
  }
  if (frozen.ok && findings.standards) {
    issues.push(...semanticIssuesStandards(findings.standards, frozen.cards));
    issues.push(...templateClosureIssues(
      findings.standards.rule_coverage,
      frozen.scope?.rule_coverage_template ?? [],
      findings.standards.findings,
    ));
  }
  if (findings.visual) issues.push(...semanticIssuesVisual(findings.visual, root));

  for (const required of ["decisions.md", "audit/results.json", "audit/report.md"]) {
    if (!existsSync(join(root, required))) issues.push(`缺最终交付来源 ${required}`);
  }
  const reportPath = join(root, "audit", "report.md");
  if (existsSync(reportPath)) {
    const report = readFileSync(reportPath, "utf8");
    if (!report.includes(`artifact_version ${version}`) || !report.includes("可交付")) {
      issues.push(`audit/report.md 未绑定当前 artifact_version ${version} 的可交付聚合结论`);
    }
  }
  const screenshotsDir = join(root, "audit", "screenshots");
  if (!existsSync(screenshotsDir) || !readdirSync(screenshotsDir).some((name) => !name.startsWith("."))) {
    issues.push("缺实际 screenshots 交付证据");
  }
  return { issues: [...new Set(issues)], version, design, snapshot, frozen, findings };
}

function deliveryFilePaths(root, version, contextText) {
  const snapDir = join(root, "audit", "snapshots", String(version));
  const snapshotFiles = hashPaths(root, [`audit/snapshots/${version}`]);
  const currentFiles = hashPaths(root, [
    "decisions.md",
    "audit/results.json",
    "audit/report.md",
    `audit/findings/standards-${version}.yaml`,
    `audit/findings/visual-${version}.yaml`,
    "audit/screenshots",
  ]);
  if (!existsSync(snapDir)) return [];
  const entries = new Map(Object.entries({ ...snapshotFiles, ...currentFiles }));
  entries.set(DELIVERY_CONTEXT_PATH, sha256Text(contextText));
  return [...entries.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, sha256]) => ({ path, sha256 }));
}

export function buildDeliverySource(rootPath, {
  now = new Date().toISOString(),
  overwrite = true,
  beforeCommit,
} = {}) {
  const root = resolve(rootPath);
  const contextPath = join(root, "context.yaml");
  if (!existsSync(contextPath)) throw new Error("缺 context.yaml");
  const ctx = loadYaml(contextPath);
  const checked = deliveryInputIssues(root, ctx);
  if (checked.issues.length) throw new Error(`delivery source 输入未通过: ${checked.issues.join("; ")}`);

  const deliveryDir = join(root, "audit", "delivery");
  const existingManifestPath = join(deliveryDir, "source-manifest.json");
  if (existsSync(deliveryDir) && !overwrite) throw new Error(`${DELIVERY_MANIFEST_PATH} 已存在；显式传 --overwrite 才可重建`);
  if (existsSync(existingManifestPath) && overwrite) {
    let old;
    try { old = JSON.parse(readFileSync(existingManifestPath, "utf8")); }
    catch (error) { throw new Error(`旧 delivery source manifest 非法 JSON: ${error.message}`); }
    if (old.artifact_version !== checked.version || old.contract_digest !== checked.design.contract_digest) {
      throw new Error("--overwrite 只能重建相同 prototype version 与 contract digest 的 delivery source");
    }
  }

  const contextText = serializeDeliveryContext(ctx);
  const manifest = {
    source_version: 1,
    artifact_version: checked.version,
    contract_revision: checked.design.contract_revision,
    contract_digest: checked.design.contract_digest,
    contract_lock_sha256: ctx.confirmations.flows.contract_lock_sha256,
    snapshot_manifest_digest: checked.snapshot.digest,
    files: deliveryFilePaths(root, checked.version, contextText),
    generated_at: new Date(now).toISOString(),
  };
  manifest.source_bundle_digest = deliverySourceDigest(manifest);
  const schemaIssues = validateDeliveryManifest(manifest);
  if (schemaIssues.length) throw new Error(schemaIssues.join("; "));

  const auditDir = join(root, "audit");
  const work = join(auditDir, `.tmp-delivery-${process.pid}-${Date.now()}`);
  const backup = join(auditDir, `.tmp-delivery-backup-${process.pid}-${Date.now()}`);
  rmSync(work, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  let movedExisting = false;
  try {
    writeFileSync(join(work, "context.yaml"), contextText);
    writeFileSync(join(work, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    beforeCommit?.({ root, work, manifest });
    if (existsSync(deliveryDir)) {
      renameSync(deliveryDir, backup);
      movedExisting = true;
    }
    renameSync(work, deliveryDir);
    rmSync(backup, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    if (movedExisting && !existsSync(deliveryDir) && existsSync(backup)) renameSync(backup, deliveryDir);
    else rmSync(backup, { recursive: true, force: true });
    throw error;
  }
}

export function verifyDeliverySource(rootPath, suppliedManifest = null, { allowFinalDesign = false } = {}) {
  const root = resolve(rootPath);
  const issues = [];
  const manifestPath = join(root, DELIVERY_MANIFEST_PATH);
  let manifest = suppliedManifest;
  if (!manifest) {
    if (!existsSync(manifestPath)) return [`缺 ${DELIVERY_MANIFEST_PATH}`];
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch (error) { return [`${DELIVERY_MANIFEST_PATH} 非法 JSON: ${error.message}`]; }
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["delivery source manifest 须为对象"];
  issues.push(...validateDeliveryManifest(manifest));
  if (manifest.source_bundle_digest !== deliverySourceDigest(manifest)) issues.push("source_bundle_digest 与 manifest 规范化内容不符");
  const paths = Array.isArray(manifest.files) ? manifest.files.map((entry) => entry?.path) : [];
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) issues.push("delivery source files 必须按 path 排序");
  if (new Set(paths).size !== paths.length) issues.push("delivery source files 含重复 path");
  for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
    const target = safePath(root, entry.path);
    if (!target) issues.push(`非法路径或越界到包外: ${entry.path}`);
    else if (!existsSync(target)) issues.push(`delivery source 缺文件: ${entry.path}`);
    else if (sha256File(target) !== entry.sha256) issues.push(`delivery source 漂移: ${entry.path}`);
  }
  const contextPath = join(root, "context.yaml");
  if (!existsSync(contextPath)) return [...new Set([...issues, "缺 context.yaml"])];
  try {
    const ctx = loadYaml(contextPath);
    let approvedDesign = null;
    if (allowFinalDesign) {
      const frozenContextPath = join(root, DELIVERY_CONTEXT_PATH);
      if (!existsSync(frozenContextPath)) issues.push(`缺 ${DELIVERY_CONTEXT_PATH}`);
      else {
        try {
          approvedDesign = yaml.load(readFileSync(frozenContextPath, "utf8"))?.artifacts?.design_document ?? null;
        } catch (error) {
          issues.push(`${DELIVERY_CONTEXT_PATH} 非法 YAML: ${error.message}`);
        }
      }
    }
    const checked = deliveryInputIssues(root, ctx, { allowFinalDesign, approvedDesign });
    issues.push(...checked.issues);
    if (checked.version !== manifest.artifact_version) issues.push("delivery source artifact_version 与当前 prototype 不符");
    if (checked.design?.contract_revision !== manifest.contract_revision) issues.push("delivery source contract_revision 与当前 Design.md 不符");
    if (checked.design?.contract_digest !== manifest.contract_digest) issues.push("delivery source contract digest 与当前 Design.md 不符");
    if (checked.snapshot?.digest !== manifest.snapshot_manifest_digest) issues.push("delivery source snapshot manifest digest 不符");
    if (ctx.confirmations?.flows?.contract_lock_sha256 !== manifest.contract_lock_sha256) issues.push("delivery source contract lock SHA-256 不符");
    const projectionContext = allowFinalDesign && approvedDesign
      ? { ...ctx, artifacts: { ...ctx.artifacts, design_document: approvedDesign } }
      : ctx;
    const currentProjection = serializeDeliveryContext(projectionContext);
    const frozenContext = manifest.files?.find((entry) => entry.path === DELIVERY_CONTEXT_PATH);
    if (!frozenContext || frozenContext.sha256 !== sha256Text(currentProjection)) issues.push("当前 finalize context 投影与冻结 delivery context 漂移");
  } catch (error) {
    issues.push(`重算 delivery source 失败: ${error.message}`);
  }
  return [...new Set(issues)];
}
