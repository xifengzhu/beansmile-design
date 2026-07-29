#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { presentationPackageStructure, presentationPaths } from "./lib/presentation-check.mjs";
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
const paths = presentationPaths(root);

try {
  // 结构校验与 deliveryAcceptance 共用同一实现（lib/presentation-check.mjs）。
  const { issues, inspected } = await presentationPackageStructure(root);
  if (issues.length) {
    console.error("✗ PPTX 结构校验失败:");
    for (const issue of issues) console.error(`  - ${issue}`);
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
