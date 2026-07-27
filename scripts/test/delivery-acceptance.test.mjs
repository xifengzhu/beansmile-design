import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import PptxGenJS from "pptxgenjs";
import yaml from "js-yaml";
import {
  deliveryRevisionHistory,
  deliveryAcceptance,
} from "../lib/delivery.mjs";
import { buildDeliverySource } from "../lib/design-source.mjs";
import { canonicalDigest, hashPaths, sha256File } from "../lib/hash.mjs";
import { inspectPptx, REQUIRED_NARRATIVE_ROLES } from "../lib/presentation.mjs";
import { makeReviewedDesignPackage } from "./design-delivery-fixture.mjs";

const AVAILABLE = {
  presentation_degraded: false,
  presentation: { available: true, rendering: true },
};
const ACCEPTANCE = resolve(import.meta.dirname, "..", "acceptance.mjs");
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function write(root, path, value) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, value);
}

function context(root) {
  return yaml.load(readFileSync(join(root, "context.yaml"), "utf8"));
}

function saveContext(root, ctx) {
  writeFileSync(join(root, "context.yaml"), yaml.dump(ctx, { lineWidth: 100 }));
}

function implementationMarkdown(root, source) {
  const approved = readFileSync(join(root, "Design.md"), "utf8");
  const sourceManifestDigest = sha256File(join(root, "audit", "delivery", "source-manifest.json"));
  return [
    approved
      .replace("phase: approved_contract", "phase: implementation_ready")
      .replace('artifact_version: "1"', 'artifact_version: "2"')
      .replace(
        "platforms: [web]",
        `realizes_prototype_version: "3"\nsource_manifest_digest: "${sourceManifestDigest}"\nsource_bundle_digest: "${source.source_bundle_digest}"\nplatforms: [web]`,
      ),
    "# 第二部分：实施规格", "", "## 已选视觉方向", "", "- `direction_id`: `D3`", "",
    "## 设计令牌", "", "- `token`: `semantic.color.primary`", "",
    "## 组件实施契约", "", "- `component_id`: `inquiry-form`", "",
    "## 资源清单", "", "- `asset_path`: `prototype/assets/logo.png`", "",
    "## 页面与原型映射", "", "- `page_id`: `home`", "- `prototype_path`: `prototype/index.html`", "",
    "## 开发验收用例", "", "- `flow`: `提交询价`", "- `scenario_id`: `inquiry-success`", "- `scenario_id`: `inquiry-error`", "",
    "## 评审、例外与人工验证", "", "- `decision_id`: `direction-D3`", "- `finding_id`: `visual-warning-1`",
    "- `manual_check`: `screen-reader-announcement-order`", "",
  ].join("\n");
}

function makeFinalizedPackage() {
  const pkg = makeReviewedDesignPackage();
  const source = buildDeliverySource(pkg.root);
  write(pkg.root, "Design.md", implementationMarkdown(pkg.root, source));
  const ctx = context(pkg.root);
  ctx.artifacts.design_document = {
    path: "Design.md",
    artifact_version: "2",
    phase: "implementation_ready",
    contract_revision: 1,
    contract_digest: pkg.digest,
    contract_source_digest: pkg.context.artifacts.design_document.contract_source_digest,
    source_manifest_digest: sha256File(join(pkg.root, "audit", "delivery", "source-manifest.json")),
    source_bundle_digest: source.source_bundle_digest,
    realizes_prototype_version: "3",
    sha256: sha256File(join(pkg.root, "Design.md")),
    updated_by: "design_specification",
  };
  saveContext(pkg.root, ctx);
  return { ...pkg, context: ctx, source };
}

async function makePresentationPackage() {
  const pkg = makeFinalizedPackage();
  const presentationDir = join(pkg.root, "presentation");
  const auditDir = join(pkg.root, "audit", "presentation");
  mkdirSync(presentationDir, { recursive: true });
  mkdirSync(auditDir, { recursive: true });
  const pptxPath = join(presentationDir, "design-system.pptx");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  for (const role of REQUIRED_NARRATIVE_ROLES) {
    const slide = pptx.addSlide();
    slide.addText(`${role} title`, { x: 0.8, y: 0.6, w: 8, h: 0.5, fontSize: 26 });
    slide.addText(`${role} body`, { x: 0.8, y: 1.5, w: 8, h: 0.8, fontSize: 18 });
    slide.addNotes(`[Sources]\n- internal: Design.md@${pkg.context.artifacts.design_document.sha256}\n- internal: prototype/index.html@v3`);
  }
  await pptx.writeFile({ fileName: pptxPath, compression: false });
  const inspected = await inspectPptx(pptxPath);
  const manifest = {
    path: "presentation/design-system.pptx",
    pptx_sha256: inspected.pptxSha256,
    artifact_version: "3",
    artifact_revision: 1,
    source_manifest_digest: pkg.context.artifacts.design_document.source_manifest_digest,
    source_bundle_digest: pkg.source.source_bundle_digest,
    design_document_sha256: pkg.context.artifacts.design_document.sha256,
    slides: inspected.slides.map((slide, index) => ({
      slide_number: slide.number,
      slide_id: slide.stableId,
      relationship_id: slide.relationshipId,
      narrative_role: REQUIRED_NARRATIVE_ROLES[index],
      title_object_id: slide.objects[0].id,
      project_sources: ["Design.md", "prototype/index.html@v3"],
      external_sources: [],
      object_counts: { ...slide.editableObjectCounts },
      full_bleed_background: null,
      allowed_overlaps: [],
    })),
  };
  write(auditDir, "manifest.json", "");
  writeFileSync(join(auditDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const renderedDir = join(auditDir, "rendered");
  mkdirSync(renderedDir, { recursive: true });
  const renders = inspected.slides.map((slide) => {
    const path = join(renderedDir, `slide-${slide.number}.png`);
    writeFileSync(path, VALID_PNG);
    return {
      slide_number: slide.number,
      path: `audit/presentation/rendered/slide-${slide.number}.png`,
      sha256: sha256File(path),
    };
  });
  const qa = {
    pptx_sha256: inspected.pptxSha256,
    slide_count: inspected.slides.length,
    renders,
    checks: { overlap: "pass", clipping: "pass", title_wrap: "pass", font_substitution: "pass" },
    status: "pass",
    slides: inspected.slides.map((slide) => ({ slide_number: slide.number, status: "pass", manual_items: [] })),
    tools: { soffice: "/tools/soffice", pdftoppm: "/tools/pdftoppm" },
    checker: "presentation-qa-v1",
    generated_at: "2026-07-27T00:00:00.000Z",
  };
  const director = {
    completed: true,
    pptx_sha256: inspected.pptxSha256,
    reviewed_slide_numbers: inspected.slides.map((slide) => slide.number),
    findings: [],
  };
  writeFileSync(join(auditDir, "qa.json"), `${JSON.stringify(qa, null, 2)}\n`);
  writeFileSync(join(auditDir, "director-review.json"), `${JSON.stringify(director, null, 2)}\n`);
  pkg.context.artifacts.presentation = {
    path: "presentation/design-system.pptx",
    artifact_version: "3",
    artifact_revision: 1,
    design_contract_digest: pkg.digest,
    contract_lock_sha256: pkg.lockSha,
    design_document_sha256: pkg.context.artifacts.design_document.sha256,
    updated_by: "design_presentation",
  };
  saveContext(pkg.root, pkg.context);
  return { ...pkg, inspected, manifest };
}

function statuses(root, ctx, options = {}) {
  return deliveryAcceptance(root, ctx, {
    snapshotVersion: 3,
    environment: AVAILABLE,
    ...options,
  }).map((gate) => gate.status);
}

test("valid contract revision records exclude only superseded snapshots from the current review chain", () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-revision-history-"));
  try {
    for (const version of [1, 2, 3, 4]) {
      write(root, `audit/snapshots/${version}/manifest.json`, `${JSON.stringify({ snapshot_version: 3, artifact_version: String(version) })}\n`);
    }
    const snapshots = [1, 2].map((version) => ({
      version,
      path: `audit/snapshots/${version}`,
      sha256: canonicalDigest(hashPaths(root, [`audit/snapshots/${version}`])),
    }));
    write(root, "audit/revisions/contract-1-to-2.json", `${JSON.stringify({
      record_version: 1,
      old_contract_revision: 1,
      new_contract_revision: 2,
      old_contract_digest: "a".repeat(64),
      reason: "新增错误恢复状态",
      revised_at: "2026-07-27T00:00:00.000Z",
      stage: "review",
      affected_artifacts: [],
      current_results: null,
      invalidated_snapshot_versions: [1, 2],
      snapshots,
      findings: [],
      presentation_qa: [],
    }, null, 2)}\n`);
    const ctx = { artifacts: { design_document: { contract_revision: 2 } } };
    const history = deliveryRevisionHistory(root, ctx, { snapshotVersion: 4, reviewVersions: [1, 2, 3, 4] });
    assert.deepEqual(history.issues, []);
    assert.deepEqual(history.invalidatedVersions, [1, 2]);
    assert.deepEqual(history.reviewVersions, [3, 4]);
    assert.equal(history.currentChainStart, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("contract revision history fails closed on malformed chains and current-snapshot invalidation", () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-revision-invalid-"));
  try {
    for (const version of [1, 2, 3]) write(root, `audit/snapshots/${version}/manifest.json`, "{}\n");
    write(root, "audit/revisions/contract-1-to-3.json", `${JSON.stringify({
      record_version: 1,
      old_contract_revision: 1,
      new_contract_revision: 3,
      invalidated_snapshot_versions: [1, 3],
      snapshots: [],
    })}\n`);
    const history = deliveryRevisionHistory(
      root,
      { artifacts: { design_document: { contract_revision: 3 } } },
      { snapshotVersion: 3, reviewVersions: [1, 2, 3] },
    );
    assert.ok(history.issues.some((issue) => /连续|文件名|revision/.test(issue)), history.issues.join("\n"));
    assert.ok(history.issues.some((issue) => /当前.*snapshot|snapshot.*当前/.test(issue)), history.issues.join("\n"));
    assert.deepEqual(history.reviewVersions, [1, 2, 3], "invalid history must not suppress review evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("delivery acceptance keeps historical and unrequested packages compatible", () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-acceptance-basic-"));
  try {
    const historical = { project: { package_format_version: 2, mode: "professional" } };
    assert.deepEqual(statuses(root, historical, { snapshotVersion: 2 }), ["pass", "pass", "pass"]);

    const quickEmpty = { project: { package_format_version: 3, mode: "quick", delivery_outputs: [] } };
    assert.deepEqual(statuses(root, quickEmpty), ["pass", "pass", "pass"]);

    const professional = {
      project: {
        package_format_version: 3,
        mode: "professional",
        delivery_outputs: ["design_specification", "design_presentation"],
      },
    };
    assert.deepEqual(statuses(root, professional), ["fail", "fail", "fail"]);

    const quickPpt = {
      project: { package_format_version: 3, mode: "quick", delivery_outputs: ["design_presentation"] },
    };
    assert.deepEqual(statuses(root, quickPpt), ["fail", "fail", "fail"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("complete version-3 package passes all three ordered delivery dimensions", async () => {
  const pkg = await makePresentationPackage();
  try {
    const gates = deliveryAcceptance(pkg.root, pkg.context, { snapshotVersion: 3, environment: AVAILABLE });
    assert.deepEqual(gates.map((gate) => gate.dimension), ["设计前契约", "开发交接文档", "设计方案演示"]);
    assert.deepEqual(gates.map((gate) => gate.status), ["pass", "pass", "pass"], gates.map((gate) => gate.detail).join("\n"));

    const unavailable = deliveryAcceptance(pkg.root, pkg.context, {
      snapshotVersion: 3,
      environment: { presentation_degraded: true, presentation: { available: false, rendering: false } },
    });
    assert.equal(unavailable[2].status, "unverified");
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("snapshot format version is independent from the current prototype artifact version", () => {
  const pkg = makeFinalizedPackage();
  try {
    renameSync(
      join(pkg.root, "audit", "snapshots", "3"),
      join(pkg.root, "audit", "snapshots", "1"),
    );
    pkg.context.artifacts.prototype.artifact_version = "1";
    const gate = deliveryAcceptance(pkg.root, pkg.context, {
      snapshotVersion: 3,
      environment: AVAILABLE,
    })[0];
    assert.equal(gate.status, "pass", gate.detail);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("design contract dimension rejects late locks, drift, stale artifacts, and old snapshots", () => {
  const cases = [
    ["late lock", (pkg) => {
      const path = join(pkg.root, "audit", "design", "contract-lock.json");
      const lock = JSON.parse(readFileSync(path, "utf8"));
      lock.downstream_absent = false;
      writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
    }],
    ["contract drift", (pkg) => {
      const path = join(pkg.root, "Design.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("## 用户、任务与成功标准", "未经确认的新约束。\n\n## 用户、任务与成功标准"));
    }],
    ["stale token", (pkg) => {
      const ctx = context(pkg.root);
      ctx.artifacts.tokens.stale = true;
      saveContext(pkg.root, ctx);
    }],
    ["old snapshot design", (pkg) => {
      const path = join(pkg.root, "audit", "snapshots", "3", "Design.md");
      writeFileSync(path, `${readFileSync(path, "utf8")}\nold snapshot drift\n`);
    }],
    ["migration without rerun", (pkg) => {
      const ctx = context(pkg.root);
      ctx.artifacts.design_document.stale = true;
      ctx.artifacts.design_document.phase = "stale";
      ctx.artifacts.design_document.superseded_contract_revision = 1;
      saveContext(pkg.root, ctx);
    }],
  ];
  for (const [name, mutate] of cases) {
    const pkg = makeFinalizedPackage();
    try {
      mutate(pkg);
      const ctx = context(pkg.root);
      const gate = deliveryAcceptance(pkg.root, ctx, { snapshotVersion: 3, environment: AVAILABLE })[0];
      assert.equal(gate.status, "fail", `${name}: ${gate.detail}`);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("handoff and presentation dimensions reject missing closure and old Design.md bindings", async () => {
  const finalized = makeFinalizedPackage();
  try {
    const designPath = join(finalized.root, "Design.md");
    writeFileSync(designPath, readFileSync(designPath, "utf8").replace("## 资源清单", "## 缺失资源清单"));
    const gate = deliveryAcceptance(finalized.root, context(finalized.root), {
      snapshotVersion: 3,
      environment: AVAILABLE,
    })[1];
    assert.equal(gate.status, "fail");
    assert.match(gate.detail, /资源|implementation|Design/i);
  } finally {
    rmSync(finalized.root, { recursive: true, force: true });
  }

  const presented = await makePresentationPackage();
  try {
    presented.context.artifacts.presentation.design_document_sha256 = "d".repeat(64);
    saveContext(presented.root, presented.context);
    const gate = deliveryAcceptance(presented.root, presented.context, {
      snapshotVersion: 3,
      environment: AVAILABLE,
    })[2];
    assert.equal(gate.status, "fail");
    assert.match(gate.detail, /Design\.md|design_document_sha256|SHA/i);
  } finally {
    rmSync(presented.root, { recursive: true, force: true });
  }
});

test("acceptance CLI appends delivery dimensions and only requires requested delivery products", () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-acceptance-cli-"));
  try {
    const ctx = {
      project: {
        name: "quick probe",
        mode: "quick",
        task_type: "new_design",
        platforms: ["web"],
        industry: "general",
        reference_system: "none",
        package_format_version: 3,
        delivery_outputs: [],
      },
      users: { primary: "访客" },
      goals: {},
      artifacts: { prototype: { path: "prototype", artifact_version: "1", updated_by: "html_prototype" } },
      confirmations: { mode: { summary: "使用快速模式", user_reply: "确认" } },
      stage: "review",
    };
    saveContext(root, ctx);
    const result = spawnSync(process.execPath, [ACCEPTANCE, "--package", root], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    for (const dimension of ["设计前契约", "开发交接文档", "设计方案演示"]) {
      assert.match(result.stdout, new RegExp(dimension));
    }
    const structure = result.stdout.split("\n").find((line) => line.includes("结构稳定")) ?? "";
    assert.doesNotMatch(structure, /Design\.md|presentation\/design-system\.pptx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
