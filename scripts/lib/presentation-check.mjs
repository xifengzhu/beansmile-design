// PPTX 结构校验的唯一实现：check-presentation.mjs CLI 与 deliveryAcceptance 共用，
// 避免验收门 spawn 子进程重验整包、再手搓伪 inspected 对象喂 QA 检查的双实现漂移。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { implementationReadyIssues, parseDesignDocument } from "./design-document.mjs";
import { deliveryArtifactVersionIssues } from "./delivery.mjs";
import { sha256File } from "./hash.mjs";
import { inspectPptx, presentationStructureIssues } from "./presentation.mjs";

export function presentationPaths(rootPath) {
  const root = resolve(rootPath);
  return {
    context: join(root, "context.yaml"),
    design: join(root, "Design.md"),
    source: join(root, "audit", "delivery", "source-manifest.json"),
    pptx: join(root, "presentation", "design-system.pptx"),
    manifest: join(root, "audit", "presentation", "manifest.json"),
    qa: join(root, "audit", "presentation", "qa.json"),
    rendered: join(root, "audit", "presentation", "rendered"),
    directorReview: join(root, "audit", "presentation", "director-review.json"),
  };
}

// 返回 { issues, inspected }；inspected 仅在 PPTX 可读时非 null，可直接供 QA 检查复用。
export async function presentationPackageStructure(rootPath) {
  const root = resolve(rootPath);
  const paths = presentationPaths(root);
  const missing = ["context", "design", "source", "pptx", "manifest"]
    .filter((key) => !existsSync(paths[key]));
  if (missing.length) return { issues: [`PPTX 结构校验缺文件: ${missing.join(", ")}`], inspected: null };

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
    // implementationReadyIssues 内部已含 verifyDeliverySource（allowFinalDesign），不再显式重验。
    const issues = [
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
    return { issues: [...new Set(issues)], inspected };
  } catch (error) {
    return { issues: [`PPTX 结构校验失败: ${error.message}`], inspected: null };
  }
}
