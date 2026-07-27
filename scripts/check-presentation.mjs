#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { implementationReadyIssues, parseDesignDocument } from "./lib/design-document.mjs";
import { verifyDeliverySource } from "./lib/design-source.mjs";
import { deliveryArtifactVersionIssues } from "./lib/delivery.mjs";
import { sha256File } from "./lib/hash.mjs";
import { inspectPptx, presentationStructureIssues } from "./lib/presentation.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
const structureOnly = process.argv.includes("--structure-only");
if (!pkg || !structureOnly) {
  console.error("用法: node scripts/check-presentation.mjs --package <目录> --structure-only");
  process.exit(2);
}

const root = resolve(pkg);
const paths = {
  context: join(root, "context.yaml"),
  design: join(root, "Design.md"),
  source: join(root, "audit", "delivery", "source-manifest.json"),
  pptx: join(root, "presentation", "design-system.pptx"),
  manifest: join(root, "audit", "presentation", "manifest.json"),
};
const missing = Object.entries(paths).filter(([, path]) => !existsSync(path)).map(([key]) => key);
if (missing.length) {
  console.error(`✗ PPTX 结构校验缺文件: ${missing.join(", ")}`);
  process.exit(1);
}

try {
  const context = yaml.load(readFileSync(paths.context, "utf8"));
  const source = JSON.parse(readFileSync(paths.source, "utf8"));
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const parsed = parseDesignDocument(readFileSync(paths.design, "utf8"));
  const inspected = await inspectPptx(paths.pptx);
  const designSha = sha256File(paths.design);
  const sourceManifestDigest = sha256File(paths.source);
  const prototypeVersion = context?.artifacts?.prototype?.artifact_version;
  const issues = [
    ...verifyDeliverySource(root, source, { allowFinalDesign: true }),
    ...implementationReadyIssues(root, parsed, source, context?.artifacts?.design_document ?? null),
    ...presentationStructureIssues(inspected, manifest, {
      designDocumentSha256: designSha,
      prototypeVersion,
      sourceBundleDigest: source.source_bundle_digest,
    }),
    ...deliveryArtifactVersionIssues(
      context?.artifacts?.presentation ?? null,
      { artifact_version: manifest.artifact_version, artifact_revision: manifest.artifact_revision },
      { kind: "presentation", prototypeVersion },
    ),
  ];
  if (context?.artifacts?.design_document?.phase !== "implementation_ready") {
    issues.push("artifacts.design_document.phase 必须为 implementation_ready");
  }
  if (context?.artifacts?.design_document?.sha256 !== designSha) {
    issues.push("artifacts.design_document.sha256 与最终 Design.md 不符");
  }
  if (manifest.source_manifest_digest !== sourceManifestDigest) {
    issues.push("manifest.source_manifest_digest 与 audit/delivery/source-manifest.json 不符");
  }

  const unique = [...new Set(issues)];
  if (unique.length) {
    console.error("✗ PPTX 结构校验失败:");
    for (const issue of unique) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(`✓ PPTX 结构校验通过 (${inspected.slides.length} slides)`);
} catch (error) {
  console.error(`✗ PPTX 结构校验失败: ${error.message}`);
  process.exit(1);
}
