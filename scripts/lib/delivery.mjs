import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import {
  canonicalDigest,
  hashPaths,
  sha256File,
} from "./hash.mjs";
import { checkDesignContractBinding } from "./design-contract-binding.mjs";
import {
  designContractDigest,
  implementationReadyIssues,
  parseDesignDocument,
} from "./design-document.mjs";
import { verifyDeliverySource } from "./design-source.mjs";
import { presentationQaIssues } from "./presentation-render.mjs";

export const DELIVERY_OUTPUTS = Object.freeze([
  "design_specification",
  "design_presentation",
]);

export const DELIVERY_PACKAGE_VERSION = 3;
const DELIVERY_DIMENSIONS = Object.freeze(["设计前契约", "开发交接文档", "设计方案演示"]);
const CHECK_PRESENTATION = resolve(import.meta.dirname, "..", "check-presentation.mjs");

export function requiredDeliveryOutputs(ctx) {
  const requested = new Set(ctx?.project?.delivery_outputs ?? []);
  if (ctx?.project?.mode === "professional") return [...DELIVERY_OUTPUTS];
  if (requested.has("design_presentation")) requested.add("design_specification");
  return DELIVERY_OUTPUTS.filter((id) => requested.has(id));
}

export function deliveryModeIssues(ctx, { enforce = false } = {}) {
  if (!enforce) return [];
  const requested = ctx?.project?.delivery_outputs ?? [];
  const unknown = requested.filter((id) => !DELIVERY_OUTPUTS.includes(id));
  const duplicate = requested.filter((id, index) => requested.indexOf(id) !== index);
  const missing = ctx?.project?.mode === "professional"
    ? DELIVERY_OUTPUTS.filter((id) => !requested.includes(id))
    : [];
  return [
    ...(unknown.length ? [`未知 delivery_outputs: ${unknown.join(", ")}`] : []),
    ...(duplicate.length ? [`重复 delivery_outputs: ${[...new Set(duplicate)].join(", ")}`] : []),
    ...(missing.length ? [`专业模式缺少 delivery_outputs: ${missing.join(", ")}`] : []),
  ];
}

export function requiresDesignContract(ctx) {
  if ((ctx?.project?.package_format_version ?? 0) < DELIVERY_PACKAGE_VERSION) return false;
  return requiredDeliveryOutputs(ctx).includes("design_specification");
}

export function deliveryArtifactVersionIssues(before, next, { kind, prototypeVersion } = {}) {
  if (kind === "design_document") {
    const previousText = before?.artifact_version ?? "0";
    const currentText = next?.artifact_version;
    const previous = /^[0-9]+$/.test(previousText) ? Number(previousText) : Number.NaN;
    const current = /^[1-9][0-9]*$/.test(currentText ?? "") ? Number(currentText) : Number.NaN;
    return Number.isInteger(current) && current === previous + 1
      ? []
      : [`design_document artifact_version 必须从 ${previousText} 递增到 ${Number.isInteger(previous) ? previous + 1 : "有效整数"}`];
  }

  if (kind === "presentation") {
    const expectedRevision = before?.artifact_version === prototypeVersion
      ? Number(before.artifact_revision) + 1
      : 1;
    return next?.artifact_version === prototypeVersion
      && Number.isInteger(next?.artifact_revision)
      && next.artifact_revision === expectedRevision
      ? []
      : [`presentation 必须绑定 prototype ${prototypeVersion} 且 artifact_revision=${expectedRevision}`];
  }

  return [`未知 delivery artifact kind: ${kind}`];
}

export function designDocumentArtifactIssues(rootPath, ctx, artifact) {
  const root = resolve(rootPath);
  const issues = [];
  const designPath = join(root, "Design.md");
  const sourcePath = join(root, "audit", "delivery", "source-manifest.json");
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return ["缺 finalize artifacts.design_document"];
  if (!existsSync(designPath)) return ["缺 Design.md，无法验证 finalize artifact"];
  if (!existsSync(sourcePath)) return ["缺 audit/delivery/source-manifest.json，无法验证 finalize artifact"];

  let frontmatter;
  let source;
  try {
    const markdown = readFileSync(designPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!match) return ["Design.md 缺 YAML frontmatter"];
    frontmatter = yaml.load(match[1]);
    source = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    return [`无法读取 finalize artifact 来源: ${error.message}`];
  }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return ["Design.md frontmatter 必须为对象"];
  }

  const expected = {
    path: "Design.md",
    artifact_version: frontmatter.artifact_version,
    phase: "implementation_ready",
    contract_revision: frontmatter.contract_revision,
    contract_digest: frontmatter.contract_digest,
    contract_source_digest: frontmatter.contract_source_digest,
    source_manifest_digest: sha256File(sourcePath),
    source_bundle_digest: source.source_bundle_digest,
    realizes_prototype_version: ctx?.artifacts?.prototype?.artifact_version,
    sha256: sha256File(designPath),
    updated_by: "design_specification",
  };
  if (frontmatter.phase !== "implementation_ready") issues.push("Design.md frontmatter phase 不是 implementation_ready");
  if (frontmatter.source_manifest_digest !== expected.source_manifest_digest) issues.push("Design.md source_manifest_digest 与冻结文件不符");
  if (frontmatter.source_bundle_digest !== expected.source_bundle_digest) issues.push("Design.md source_bundle_digest 与 delivery source 不符");
  if (frontmatter.realizes_prototype_version !== expected.realizes_prototype_version) issues.push("Design.md realizes_prototype_version 与当前 prototype 不符");
  for (const [key, value] of Object.entries(expected)) {
    if (artifact[key] !== value) issues.push(`artifacts.design_document.${key} 与最终 Design.md 不符`);
  }
  if (source.contract_revision !== frontmatter.contract_revision) issues.push("Design.md contract_revision 与 delivery source 不符");
  if (source.contract_digest !== frontmatter.contract_digest) issues.push("Design.md contract_digest 与 delivery source 不符");
  return [...new Set(issues)];
}

function gate(dimension, issues, success) {
  const unique = [...new Set(issues.filter(Boolean))];
  return {
    dimension,
    status: unique.length ? "fail" : "pass",
    detail: unique.length ? unique.slice(0, 8).join("; ") : success,
  };
}

function readJson(path, label, issues) {
  if (!existsSync(path)) {
    issues.push(`缺 ${label}`);
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(`${label} 必须为对象`);
      return null;
    }
    return value;
  } catch (error) {
    issues.push(`${label} 非法 JSON: ${error.message}`);
    return null;
  }
}

function positiveVersions(values, label, issues) {
  if (!Array.isArray(values)) {
    issues.push(`${label} 必须为数组`);
    return [];
  }
  const versions = values.filter((value) => Number.isInteger(value) && value > 0);
  if (versions.length !== values.length) issues.push(`${label} 只能包含正整数`);
  if (new Set(versions).size !== versions.length) issues.push(`${label} 不得重复`);
  return [...new Set(versions)].sort((a, b) => a - b);
}

export function deliveryRevisionHistory(rootPath, ctx, { snapshotVersion, reviewVersions = [] } = {}) {
  const root = resolve(rootPath);
  const revisionsDir = join(root, "audit", "revisions");
  const requestedVersions = [...new Set(reviewVersions
    .filter((value) => Number.isInteger(Number(value)) && Number(value) > 0)
    .map(Number))].sort((a, b) => a - b);
  const empty = {
    issues: [],
    invalidatedVersions: [],
    reviewVersions: requestedVersions,
    currentChainStart: requestedVersions[0] ?? null,
  };
  if (!existsSync(revisionsDir)) return empty;

  const issues = [];
  const records = [];
  for (const name of readdirSync(revisionsDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const match = /^contract-([1-9][0-9]*)-to-([1-9][0-9]*)\.json$/.exec(name);
    if (!match) {
      issues.push(`revision record 文件名非法: audit/revisions/${name}`);
      continue;
    }
    const path = join(revisionsDir, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      issues.push(`revision record 必须是包内普通文件: audit/revisions/${name}`);
      continue;
    }
    const record = readJson(path, `audit/revisions/${name}`, issues);
    if (record) records.push({ name, path, oldRevision: Number(match[1]), newRevision: Number(match[2]), record });
  }
  records.sort((left, right) => left.oldRevision - right.oldRevision);
  if (records.length === 0) {
    return { ...empty, issues };
  }

  const invalidated = new Set();
  let previousNew = null;
  for (const entry of records) {
    const { name, oldRevision, newRevision, record } = entry;
    if (newRevision !== oldRevision + 1) issues.push(`${name} revision 必须连续递增 1`);
    if (previousNew !== null && oldRevision !== previousNew) issues.push(`${name} 与前一 revision record 不连续`);
    previousNew = newRevision;
    if (record.record_version !== 1) issues.push(`${name} record_version 必须为 1`);
    if (record.old_contract_revision !== oldRevision || record.new_contract_revision !== newRevision) {
      issues.push(`${name} 文件名与 contract revision 字段不符`);
    }
    if (!/^[a-f0-9]{64}$/.test(record.old_contract_digest ?? "")) issues.push(`${name} old_contract_digest 非法`);
    if (typeof record.reason !== "string" || !record.reason.trim()) issues.push(`${name} 缺修订原因`);
    if (!Number.isFinite(Date.parse(record.revised_at ?? ""))) issues.push(`${name} revised_at 非法`);

    const invalidatedVersions = positiveVersions(
      record.invalidated_snapshot_versions,
      `${name} invalidated_snapshot_versions`,
      issues,
    );
    const snapshots = Array.isArray(record.snapshots) ? record.snapshots : [];
    if (!Array.isArray(record.snapshots)) issues.push(`${name} snapshots 必须为数组`);
    const snapshotVersions = positiveVersions(snapshots.map((item) => item?.version), `${name} snapshots.version`, issues);
    if (JSON.stringify(snapshotVersions) !== JSON.stringify(invalidatedVersions)) {
      issues.push(`${name} snapshots 与 invalidated_snapshot_versions 不一致`);
    }
    for (const item of snapshots) {
      const version = item?.version;
      const expectedPath = `audit/snapshots/${version}`;
      if (item?.path !== expectedPath) {
        issues.push(`${name} snapshot v${version} path 非法`);
        continue;
      }
      const target = join(root, expectedPath);
      if (!existsSync(target)) {
        issues.push(`${name} 记录的 snapshot v${version} 已丢失`);
        continue;
      }
      const expectedSha = canonicalDigest(hashPaths(root, [expectedPath]));
      if (item?.sha256 !== expectedSha) issues.push(`${name} snapshot v${version} 审计哈希漂移`);
    }
    for (const version of invalidatedVersions) invalidated.add(version);
  }

  const currentRevision = ctx?.artifacts?.design_document?.contract_revision;
  if (!Number.isInteger(currentRevision) || currentRevision !== records.at(-1).newRevision) {
    issues.push(`当前 Design.md contract_revision 必须等于最新 revision ${records.at(-1).newRevision}`);
  }
  const currentSnapshot = Number(snapshotVersion);
  if (Number.isInteger(currentSnapshot) && currentSnapshot > 0 && invalidated.has(currentSnapshot)) {
    issues.push(`当前 snapshot v${currentSnapshot} 被 revision record 标记失效`);
  }

  const invalidatedVersions = [...invalidated].sort((a, b) => a - b);
  const filteredVersions = requestedVersions.filter((version) => !invalidated.has(version));
  const latestInvalidated = invalidatedVersions.at(-1) ?? 0;
  if (requestedVersions.length > 0 && (filteredVersions.length === 0 || filteredVersions[0] <= latestInvalidated)) {
    issues.push(`当前契约评审链必须从失效 snapshot v${latestInvalidated} 之后开始`);
  }
  const valid = issues.length === 0;
  return {
    issues: [...new Set(issues)],
    invalidatedVersions: valid ? invalidatedVersions : [],
    reviewVersions: valid ? filteredVersions : requestedVersions,
    currentChainStart: (valid ? filteredVersions : requestedVersions)[0] ?? null,
  };
}

function contractSourceIssues(root, design) {
  const issues = [];
  const sourcePath = join(root, "audit", "design", "contract-source.json");
  const source = readJson(sourcePath, "audit/design/contract-source.json", issues);
  if (!source) return issues;
  const { generated_at, contract_source_digest, ...payload } = source;
  if (contract_source_digest !== canonicalDigest(payload)) {
    issues.push("contract-source contract_source_digest 与规范化内容不符");
  }
  if (design?.contract_source_digest !== contract_source_digest) {
    issues.push("Design.md contract_source_digest 与 contract-source 不符");
  }
  for (const entry of [
    ...(Array.isArray(source.files) ? source.files : []),
    source.context,
    source.rules,
  ].filter(Boolean)) {
    if (entry.path === "decisions.md") continue;
    const path = typeof entry.path === "string" ? resolve(root, entry.path) : null;
    if (!path || (path !== root && !path.startsWith(`${root}/`))) issues.push(`contract-source 路径非法: ${entry.path}`);
    else if (!existsSync(path)) issues.push(`contract-source 冻结文件缺失: ${entry.path}`);
    else if (sha256File(path) !== entry.sha256) issues.push(`contract-source 冻结文件漂移: ${entry.path}`);
  }
  return issues;
}

function preDesignContractIssues(root, ctx, snapshotVersion, revisionHistory) {
  const issues = [];
  const active = ctx?.artifacts?.design_document;
  const snapshotRoot = join(root, "audit", "snapshots", String(snapshotVersion));
  const snapshotDesignPath = join(snapshotRoot, "Design.md");
  const activeLockPath = join(root, "audit", "design", "contract-lock.json");
  const snapshotLockPath = join(snapshotRoot, "audit", "design", "contract-lock.json");
  if (!active) issues.push("缺 artifacts.design_document");
  if (!existsSync(join(root, "Design.md"))) issues.push("缺 Design.md");
  if (!existsSync(snapshotDesignPath)) issues.push(`当前 snapshot v${snapshotVersion} 缺 approved Design.md`);
  if (!existsSync(activeLockPath)) issues.push("缺 audit/design/contract-lock.json");
  else {
    const activeLock = readJson(activeLockPath, "audit/design/contract-lock.json", issues);
    if (activeLock?.downstream_absent !== true) issues.push("contract lock 不是在下游 artifacts 缺席时创建");
    const confirmedLockSha = ctx?.confirmations?.flows?.contract_lock_sha256;
    if (confirmedLockSha !== sha256File(activeLockPath)) issues.push("活动 contract lock 与用户确认记录不符");
    if (existsSync(snapshotLockPath) && sha256File(snapshotLockPath) !== sha256File(activeLockPath)) {
      issues.push("活动 contract lock 相对 reviewed snapshot 漂移");
    }
  }

  let activeParsed = null;
  let snapshotParsed = null;
  try {
    if (existsSync(join(root, "Design.md"))) activeParsed = parseDesignDocument(readFileSync(join(root, "Design.md"), "utf8"));
    if (existsSync(snapshotDesignPath)) snapshotParsed = parseDesignDocument(readFileSync(snapshotDesignPath, "utf8"));
  } catch (error) {
    issues.push(`Design.md 无法读取: ${error.message}`);
  }
  issues.push(...(activeParsed?.errors ?? []));
  issues.push(...(snapshotParsed?.errors ?? []).map((issue) => `snapshot: ${issue}`));
  const activeDigest = activeParsed ? designContractDigest(activeParsed) : null;
  const snapshotDigest = snapshotParsed ? designContractDigest(snapshotParsed) : null;
  if (activeDigest && snapshotDigest && activeDigest !== snapshotDigest) {
    issues.push("当前 Design.md 第一部分相对 reviewed snapshot 契约漂移");
  }
  if (active?.contract_digest && activeDigest && active.contract_digest !== activeDigest) {
    issues.push("artifacts.design_document.contract_digest 与当前锁定正文不符");
  }
  if (active?.stale === true || active?.phase === "stale") issues.push("Design.md 已标记 stale，必须重跑设计契约");

  if (snapshotParsed && active) {
    const approvedArtifact = {
      ...active,
      artifact_version: snapshotParsed.frontmatter.artifact_version,
      phase: "approved_contract",
      contract_revision: snapshotParsed.frontmatter.contract_revision,
      contract_digest: snapshotDigest,
      contract_source_digest: snapshotParsed.frontmatter.contract_source_digest,
      sha256: sha256File(snapshotDesignPath),
    };
    const bindingCtx = {
      ...ctx,
      artifacts: { ...ctx.artifacts, design_document: approvedArtifact },
    };
    for (const artifact of [null, ctx?.artifacts?.tokens, ctx?.artifacts?.prototype]) {
      issues.push(...checkDesignContractBinding(snapshotRoot, bindingCtx, artifact).map((issue) => `snapshot: ${issue}`));
    }
    issues.push(...contractSourceIssues(root, approvedArtifact));
  }
  for (const key of ["tokens", "prototype", "presentation"]) {
    if (ctx?.artifacts?.[key]?.stale === true) issues.push(`artifacts.${key} 已标记 stale`);
  }
  issues.push(...(revisionHistory?.issues ?? []));
  return [...new Set(issues)];
}

function implementationHandoffIssues(root, ctx) {
  const issues = [];
  const designPath = join(root, "Design.md");
  const sourcePath = join(root, "audit", "delivery", "source-manifest.json");
  if (!existsSync(designPath)) return ["缺 Design.md"];
  if (!existsSync(sourcePath)) return ["缺 audit/delivery/source-manifest.json"];
  let parsed;
  let source;
  try {
    parsed = parseDesignDocument(readFileSync(designPath, "utf8"));
    source = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    return [`开发交接输入无法读取: ${error.message}`];
  }
  issues.push(...verifyDeliverySource(root, source, { allowFinalDesign: true }));
  issues.push(...implementationReadyIssues(root, parsed, source, ctx?.artifacts?.design_document ?? null));
  issues.push(...designDocumentArtifactIssues(root, ctx, ctx?.artifacts?.design_document));
  if (ctx?.artifacts?.design_document?.stale === true) issues.push("最终 Design.md 已标记 stale");
  return [...new Set(issues)];
}

function presentationIssues(root, ctx) {
  const issues = [];
  const paths = {
    pptx: join(root, "presentation", "design-system.pptx"),
    manifest: join(root, "audit", "presentation", "manifest.json"),
    qa: join(root, "audit", "presentation", "qa.json"),
    director: join(root, "audit", "presentation", "director-review.json"),
  };
  const artifact = ctx?.artifacts?.presentation;
  if (!artifact) issues.push("缺 artifacts.presentation");
  if (!existsSync(paths.pptx)) issues.push("缺 presentation/design-system.pptx");
  const manifest = readJson(paths.manifest, "audit/presentation/manifest.json", issues);
  const qa = readJson(paths.qa, "audit/presentation/qa.json", issues);
  const director = readJson(paths.director, "audit/presentation/director-review.json", issues);
  if (issues.length) return issues;

  const design = ctx?.artifacts?.design_document;
  const lockSha = ctx?.confirmations?.flows?.contract_lock_sha256;
  const prototypeVersion = ctx?.artifacts?.prototype?.artifact_version;
  if (artifact.path !== "presentation/design-system.pptx") issues.push("artifacts.presentation.path 非法");
  if (artifact.stale === true) issues.push("artifacts.presentation 已标记 stale");
  if (artifact.artifact_version !== prototypeVersion) issues.push("presentation artifact_version 未绑定当前 prototype");
  if (!Number.isInteger(artifact.artifact_revision) || artifact.artifact_revision < 1) issues.push("presentation artifact_revision 非法");
  if (artifact.design_contract_digest !== design?.contract_digest) issues.push("presentation design_contract_digest 与最终 Design.md 不符");
  if (artifact.contract_lock_sha256 !== lockSha) issues.push("presentation contract_lock_sha256 不符");
  if (artifact.design_document_sha256 !== design?.sha256) issues.push("presentation design_document_sha256 与最终 Design.md SHA 不符");
  if (manifest.artifact_version !== artifact.artifact_version || manifest.artifact_revision !== artifact.artifact_revision) {
    issues.push("presentation manifest 版本与 context artifact 不符");
  }
  if (manifest.design_document_sha256 !== design?.sha256) issues.push("presentation manifest 绑定旧 Design.md");
  if (manifest.pptx_sha256 !== sha256File(paths.pptx)) issues.push("presentation manifest PPTX SHA 不符");

  const structure = spawnSync(process.execPath, [CHECK_PRESENTATION, "--package", root, "--structure-only"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (structure.status !== 0) {
    issues.push(`PPTX 结构校验失败: ${(structure.stderr || structure.stdout).trim() || `exit ${structure.status}`}`);
  }
  const inspected = {
    pptxSha256: sha256File(paths.pptx),
    slides: Array.isArray(manifest.slides)
      ? manifest.slides.map((slide, index) => ({ number: slide?.slide_number ?? index + 1 }))
      : [],
  };
  issues.push(...presentationQaIssues(root, inspected, qa, director));
  return [...new Set(issues)];
}

export function deliveryAcceptance(rootPath, ctx, { snapshotVersion, environment = {} } = {}) {
  const root = resolve(rootPath);
  const packageVersion = Number(ctx?.project?.package_format_version ?? 0);
  const snapshotFormatVersion = Number(snapshotVersion ?? 0);
  const artifactVersion = Number(ctx?.artifacts?.prototype?.artifact_version ?? 0);
  if ((snapshotFormatVersion > 0 && snapshotFormatVersion < DELIVERY_PACKAGE_VERSION)
    || (packageVersion > 0 && packageVersion < DELIVERY_PACKAGE_VERSION)) {
    return DELIVERY_DIMENSIONS.map((dimension) => ({
      dimension,
      status: "pass",
      detail: `历史 package/snapshot format ${snapshotFormatVersion || packageVersion} 不追溯新交付门；如需新产物须重跑设计流程迁移`,
    }));
  }

  const required = new Set(requiredDeliveryOutputs(ctx));
  const designRequired = required.has("design_specification");
  const presentationRequired = required.has("design_presentation");
  if (!designRequired && !presentationRequired) {
    return DELIVERY_DIMENSIONS.map((dimension) => ({ dimension, status: "pass", detail: "quick mode 未请求该交付输出" }));
  }

  const revisionHistory = deliveryRevisionHistory(root, ctx, { snapshotVersion: artifactVersion });

  const contract = gate(
    DELIVERY_DIMENSIONS[0],
    designRequired ? preDesignContractIssues(root, ctx, artifactVersion, revisionHistory) : [],
    designRequired ? "Design.md 已在创作前确认并锁定，snapshot 与下游绑定完整" : "未请求 Design.md",
  );
  const handoff = gate(
    DELIVERY_DIMENSIONS[1],
    designRequired ? implementationHandoffIssues(root, ctx) : [],
    designRequired ? "同一 Design.md 已闭合为 implementation_ready 并绑定 reviewed source" : "未请求开发交接文档",
  );
  const presentationProblems = presentationRequired ? presentationIssues(root, ctx) : [];
  const presentation = gate(
    DELIVERY_DIMENSIONS[2],
    presentationProblems,
    presentationRequired ? "PPTX 结构、render QA 与 Director 逐页复核均绑定当前交付" : "未请求设计方案演示",
  );
  const unavailable = environment?.presentation_degraded === true
    || environment?.presentation?.available === false
    || environment?.presentation?.rendering === false;
  if (presentationRequired && presentation.status === "pass" && unavailable) {
    presentation.status = "unverified";
    presentation.detail = "Presentation 渲染能力不可用；结构与已有证据有效，但当前环境未验证，不能判定通过";
  }
  return [contract, handoff, presentation];
}
