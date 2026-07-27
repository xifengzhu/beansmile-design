#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { implementationReadyIssues, parseDesignDocument } from "./lib/design-document.mjs";
import { verifyDeliverySource } from "./lib/design-source.mjs";
import { deliveryArtifactVersionIssues } from "./lib/delivery.mjs";
import { sha256File } from "./lib/hash.mjs";
import { inspectPptx, presentationStructureIssues } from "./lib/presentation.mjs";
import {
  presentationQaIssues,
  renderPptx,
  resolvePresentationTools,
} from "./lib/presentation-render.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
const structureOnly = process.argv.includes("--structure-only");
if (!pkg) {
  console.error("用法: node scripts/check-presentation.mjs --package <目录> [--structure-only]");
  process.exit(2);
}

const root = resolve(pkg);
const requiredPaths = {
  context: join(root, "context.yaml"),
  design: join(root, "Design.md"),
  source: join(root, "audit", "delivery", "source-manifest.json"),
  pptx: join(root, "presentation", "design-system.pptx"),
  manifest: join(root, "audit", "presentation", "manifest.json"),
};
const paths = {
  ...requiredPaths,
  qa: join(root, "audit", "presentation", "qa.json"),
  rendered: join(root, "audit", "presentation", "rendered"),
  directorReview: join(root, "audit", "presentation", "director-review.json"),
};
const missing = Object.entries(requiredPaths).filter(([, path]) => !existsSync(path)).map(([key]) => key);
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
  const registeredPresentation = context?.artifacts?.presentation ?? null;
  const inspectedVersion = {
    artifact_version: manifest.artifact_version,
    artifact_revision: manifest.artifact_revision,
  };
  const registeredVersionMatches = registeredPresentation?.artifact_version === inspectedVersion.artifact_version
    && registeredPresentation?.artifact_revision === inspectedVersion.artifact_revision;
  const issues = [
    ...verifyDeliverySource(root, source, { allowFinalDesign: true }),
    ...implementationReadyIssues(root, parsed, source, context?.artifacts?.design_document ?? null),
    ...presentationStructureIssues(inspected, manifest, {
      designDocumentSha256: designSha,
      prototypeVersion,
      sourceBundleDigest: source.source_bundle_digest,
    }),
    ...(registeredVersionMatches ? [] : deliveryArtifactVersionIssues(
      registeredPresentation,
      inspectedVersion,
      { kind: "presentation", prototypeVersion },
    )),
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
  if (structureOnly) process.exit(0);

  const tools = resolvePresentationTools();
  if (!tools.available) {
    console.error(`⚠ PPTX 渲染未验证: ${tools.error}`);
    process.exit(3);
  }
  const rendered = await renderPptx(paths.pptx, paths.rendered, tools);
  const directorReview = existsSync(paths.directorReview)
    ? JSON.parse(readFileSync(paths.directorReview, "utf8"))
    : null;
  const expectedSlides = inspected.slides.map((slide) => slide.number);
  const renderCoverageReady = rendered.renders.length === expectedSlides.length
    && rendered.renders.every((entry, index) => entry.slideNumber === expectedSlides[index]);
  const reviewedSlides = directorReview?.reviewed_slide_numbers;
  const directorReady = directorReview?.completed === true
    && directorReview?.pptx_sha256 === inspected.pptxSha256
    && Array.isArray(reviewedSlides)
    && reviewedSlides.length === expectedSlides.length
    && new Set(reviewedSlides).size === reviewedSlides.length
    && expectedSlides.every((number) => reviewedSlides.includes(number))
    && Array.isArray(directorReview?.findings)
    && directorReview.findings.length === 0;
  const qaReady = renderCoverageReady && directorReady;
  const manualStatus = qaReady ? "pass" : "unverified";
  const qa = {
    pptx_sha256: inspected.pptxSha256,
    slide_count: inspected.slides.length,
    renders: rendered.renders.map((entry) => ({
      slide_number: entry.slideNumber,
      path: relative(root, entry.path).split("\\").join("/"),
      sha256: entry.sha256,
    })),
    checks: {
      overlap: "pass",
      overflow: "pass",
      empty_placeholder: "pass",
      clipping: manualStatus,
      title_wrap: manualStatus,
      font_substitution: manualStatus,
    },
    status: qaReady ? "pass" : "unverified",
    slides: expectedSlides.map((number) => ({
      slide_number: number,
      status: qaReady ? "pass" : "unverified",
      manual_items: qaReady ? [] : ["clipping", "title_wrap", "font_substitution"],
    })),
    tools: { soffice: tools.soffice, pdftoppm: tools.pdftoppm },
    checker: "presentation-qa-v1",
    generated_at: new Date().toISOString(),
  };
  mkdirSync(join(root, "audit", "presentation"), { recursive: true });
  const tempQa = `${paths.qa}.tmp-${process.pid}`;
  writeFileSync(tempQa, `${JSON.stringify(qa, null, 2)}\n`);
  renameSync(tempQa, paths.qa);

  if (!directorReview) {
    console.error("⚠ PPTX renders/QA 已重建，等待独立 Director 逐页复核；当前结论为未验证");
    process.exit(3);
  }
  const qaIssues = presentationQaIssues(root, inspected, qa, directorReview);
  if (qaIssues.length) {
    console.error("✗ PPTX QA/Director 复核失败:");
    for (const issue of qaIssues) console.error(`  - ${issue}`);
    process.exit(1);
  }
  console.log(`✓ PPTX 渲染与 Director 逐页复核通过 (${rendered.renders.length} renders)`);
} catch (error) {
  console.error(`✗ PPTX 结构校验失败: ${error.message}`);
  process.exit(1);
}
