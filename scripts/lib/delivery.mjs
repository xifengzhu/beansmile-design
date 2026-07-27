import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { sha256File } from "./hash.mjs";

export const DELIVERY_OUTPUTS = Object.freeze([
  "design_specification",
  "design_presentation",
]);

export const DELIVERY_PACKAGE_VERSION = 3;

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
