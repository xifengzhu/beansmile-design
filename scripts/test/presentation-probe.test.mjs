import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import PptxGenJS from "pptxgenjs";
import yaml from "js-yaml";
import {
  presentationQaIssues,
  renderPptx,
  resolvePresentationTools,
} from "../lib/presentation-render.mjs";
import { checkEnvironment } from "../env-check.mjs";
import { sha256File } from "../lib/hash.mjs";
import { inspectPptx, REQUIRED_NARRATIVE_ROLES } from "../lib/presentation.mjs";
import { buildDeliverySource } from "../lib/design-source.mjs";
import { makeReviewedDesignPackage } from "./design-delivery-fixture.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const PROBE = resolve(ROOT, "scripts/presentation-probe.mjs");
const CHECK_PRESENTATION = resolve(ROOT, "scripts/check-presentation.mjs");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const ADAPTER = resolve(ROOT, "skills/design-presentation/references/codex-adapter.md");

function makeRoot(name) {
  const root = join(tmpdir(), `beansmile-presentation-${name}-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeExecutable(path, source) {
  writeFileSync(path, `#!/usr/bin/env node\n${source}\n`);
  chmodSync(path, 0o755);
}

function fakeTools(root, { pages = 2 } = {}) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const soffice = join(bin, "soffice");
  const pdftoppm = join(bin, "pdftoppm");
  writeExecutable(soffice, String.raw`
const { copyFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const args = process.argv.slice(2);
const out = args[args.indexOf("--outdir") + 1];
const input = args.at(-1);
copyFileSync(input, join(out, basename(input).replace(/\.pptx$/i, ".pdf")));
`);
  writeExecutable(pdftoppm, String.raw`
const { writeFileSync } = require("node:fs");
const prefix = process.argv.at(-1);
for (let number = 1; number <= ${pages}; number += 1) {
  writeFileSync(prefix + "-" + String(number).padStart(2, "0") + ".png", Buffer.from("89504e470d0a1a0a0000000d4948445" + (number % 10), "hex"));
}
`);
  return { soffice, pdftoppm };
}

test("resolvePresentationTools accepts injected executables and reports missing tools", () => {
  const root = makeRoot("tools");
  try {
    const injected = fakeTools(root);
    assert.deepEqual(resolvePresentationTools(injected), { available: true, ...injected, error: null });
    const missing = resolvePresentationTools({
      soffice: join(root, "missing-soffice"),
      pdftoppm: join(root, "missing-pdftoppm"),
      path: "",
    });
    assert.equal(missing.available, false);
    assert.match(missing.error, /soffice|pdftoppm|LibreOffice|Poppler/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderPptx uses fresh output, normalizes slide names, and records hashes", async () => {
  const root = makeRoot("render");
  try {
    const pptx = join(root, "sample.pptx");
    const out = join(root, "audit", "presentation", "rendered");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "stale.png"), "stale");
    writeFileSync(pptx, "fake-pptx");
    const rendered = await renderPptx(pptx, out, { available: true, ...fakeTools(root), error: null });
    assert.deepEqual(Object.keys(rendered.pdf).sort(), ["retained", "sha256"]);
    assert.match(rendered.pdf.sha256, /^[a-f0-9]{64}$/);
    assert.equal(rendered.pdf.retained, false);
    assert.equal(existsSync(join(out, "presentation.pdf")), false);
    assert.deepEqual(rendered.renders.map((entry) => ({ slideNumber: entry.slideNumber, name: basename(entry.path) })), [
      { slideNumber: 1, name: "slide-1.png" },
      { slideNumber: 2, name: "slide-2.png" },
    ]);
    assert.ok(rendered.renders.every((entry) => entry.sha256 === sha256File(entry.path)));
    assert.equal(existsSync(join(out, "stale.png")), false);
    assert.equal(existsSync(join(root, "audit", "presentation", ".tmp-render")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function validQaFixture() {
  const root = makeRoot("qa");
  const rendered = join(root, "audit", "presentation", "rendered");
  mkdirSync(rendered, { recursive: true });
  const files = [1, 2].map((number) => {
    const path = join(rendered, `slide-${number}.png`);
    writeFileSync(path, `png-${number}`);
    return {
      slide_number: number,
      path: `audit/presentation/rendered/slide-${number}.png`,
      sha256: sha256File(path),
    };
  });
  const pptxSha = "a".repeat(64);
  return {
    root,
    inspected: { pptxSha256: pptxSha, slides: [{ number: 1 }, { number: 2 }] },
    qa: {
      pptx_sha256: pptxSha,
      slide_count: 2,
      renders: files,
      status: "pass",
      checks: {
        overlap: "pass",
        clipping: "pass",
        title_wrap: "pass",
        font_substitution: "pass",
      },
      slides: [1, 2].map((number) => ({ slide_number: number, status: "pass", manual_items: [] })),
      tools: { soffice: "/tools/soffice", pdftoppm: "/tools/pdftoppm" },
      checker: "presentation-qa-v1",
      generated_at: "2026-07-27T00:00:00.000Z",
    },
    director: {
      completed: true,
      pptx_sha256: pptxSha,
      reviewed_slide_numbers: [1, 2],
      findings: [],
    },
  };
}

test("presentationQaIssues accepts current renders and complete Director review", () => {
  const fixture = validQaFixture();
  try {
    assert.deepEqual(presentationQaIssues(fixture.root, fixture.inspected, fixture.qa, fixture.director), []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("presentationQaIssues rejects stale bindings, render drift, and unverified checks", () => {
  const fixture = validQaFixture();
  try {
    const cases = [];
    const stalePptx = structuredClone(fixture.qa);
    stalePptx.pptx_sha256 = "b".repeat(64);
    cases.push([stalePptx, fixture.director, /PPTX|pptx_sha256/]);
    const wrongCount = structuredClone(fixture.qa);
    wrongCount.slide_count = 1;
    cases.push([wrongCount, fixture.director, /slide.*count|页数/i]);
    const missingRender = structuredClone(fixture.qa);
    missingRender.renders.pop();
    cases.push([missingRender, fixture.director, /render|渲染/]);
    const drift = structuredClone(fixture.qa);
    writeFileSync(join(fixture.root, drift.renders[0].path), "changed");
    cases.push([drift, fixture.director, /hash|SHA|漂移/i]);
    for (const check of ["overlap", "clipping", "title_wrap", "font_substitution"]) {
      const qa = structuredClone(fixture.qa);
      qa.checks[check] = "unverified";
      cases.push([qa, fixture.director, new RegExp(check.replace("_", ".?"), "i")]);
    }
    for (const [qa, director, pattern] of cases) {
      const issues = presentationQaIssues(fixture.root, fixture.inspected, qa, director);
      assert.ok(issues.some((issue) => pattern.test(issue)), issues.join("\n"));
      assert.deepEqual(issues, presentationQaIssues(fixture.root, fixture.inspected, qa, director));
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("presentationQaIssues rejects incomplete, duplicate, extra, stale, or unresolved Director review", () => {
  const fixture = validQaFixture();
  try {
    const reviews = [
      [{ ...fixture.director, completed: false }, /completed|完成/],
      [{ ...fixture.director, reviewed_slide_numbers: [1] }, /页码|slide|逐页/i],
      [{ ...fixture.director, reviewed_slide_numbers: [1, 1] }, /重复|duplicate/i],
      [{ ...fixture.director, reviewed_slide_numbers: [1, 2, 3] }, /额外|extra|页码|slide/i],
      [{ ...fixture.director, pptx_sha256: "b".repeat(64) }, /PPTX|旧|stale/i],
      [{ ...fixture.director, findings: [{ severity: "warning", summary: "Title wraps" }] }, /finding|问题|未处理/i],
    ];
    for (const [director, pattern] of reviews) {
      const issues = presentationQaIssues(fixture.root, fixture.inspected, fixture.qa, director);
      assert.ok(issues.some((issue) => pattern.test(issue)), issues.join("\n"));
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("presentationQaIssues requires complete per-slide status, tools, and output time", () => {
  const fixture = validQaFixture();
  try {
    const cases = [];
    const missingTool = structuredClone(fixture.qa);
    delete missingTool.tools.soffice;
    cases.push([missingTool, /soffice|tool|renderer/i]);
    const badTime = structuredClone(fixture.qa);
    badTime.generated_at = "not-a-time";
    cases.push([badTime, /generated_at|time|时间/i]);
    const missingSlide = structuredClone(fixture.qa);
    missingSlide.slides.pop();
    cases.push([missingSlide, /slide.*status|逐页|页码/i]);
    const unverifiedSlide = structuredClone(fixture.qa);
    unverifiedSlide.slides[0].status = "unverified";
    cases.push([unverifiedSlide, /slide 1.*status|unverified/i]);
    const manualItem = structuredClone(fixture.qa);
    manualItem.slides[0].manual_items = ["check title wrapping"];
    cases.push([manualItem, /slide 1.*manual|人工/i]);
    for (const [qa, pattern] of cases) {
      const issues = presentationQaIssues(fixture.root, fixture.inspected, qa, fixture.director);
      assert.ok(issues.some((issue) => pattern.test(issue)), issues.join("\n"));
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("presentationQaIssues rejects noncanonical timestamps and symlinked render evidence", () => {
  const fixture = validQaFixture();
  const externalPath = join(dirname(fixture.root), `${basename(fixture.root)}-external.png`);
  try {
    const badTime = structuredClone(fixture.qa);
    badTime.generated_at = "0";
    assert.ok(presentationQaIssues(fixture.root, fixture.inspected, badTime, fixture.director)
      .some((issue) => /generated_at|time|\u65f6\u95f4/i.test(issue)));

    const firstRender = fixture.qa.renders[0];
    const renderPath = join(fixture.root, firstRender.path);
    writeFileSync(externalPath, "external-png");
    rmSync(renderPath);
    symlinkSync(externalPath, renderPath);
    firstRender.sha256 = sha256File(externalPath);
    assert.ok(presentationQaIssues(fixture.root, fixture.inspected, fixture.qa, fixture.director)
      .some((issue) => /render|path|\u8def\u5f84|\u6587\u4ef6/i.test(issue)));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(externalPath, { force: true });
  }
});

test("environment reports browser and presentation degradation independently", async () => {
  const environment = await checkEnvironment({
    browserProbe: async () => ({ available: true, method: "fake-browser", error: null }),
    presentationProbe: async () => ({
      available: false,
      tools_available: true,
      generation: true,
      reread: true,
      rendering: false,
      error: "fake render failure",
    }),
  });
  assert.equal(environment.degraded, false);
  assert.equal(environment.browser_automation, true);
  assert.equal(environment.presentation_degraded, true);
  assert.deepEqual(environment.presentation, {
    available: false,
    tools_available: true,
    generation: true,
    reread: true,
    rendering: false,
    error: "fake render failure",
  });
});

test("environment fails closed when presentation stage flags contradict available", async () => {
  const environment = await checkEnvironment({
    browserProbe: async () => ({ available: true, method: "fake-browser", error: null }),
    presentationProbe: async () => ({
      available: true,
      tools_available: true,
      generation: true,
      reread: true,
      rendering: false,
      error: null,
    }),
  });
  assert.equal(environment.presentation_degraded, true);
});

test("presentation probe exits 3 when render tools are unavailable", () => {
  const root = makeRoot("probe-missing");
  try {
    const result = spawnSync(process.execPath, [PROBE], {
      encoding: "utf8",
      env: { ...process.env, PATH: root },
    });
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /unavailable|未验证|soffice|pdftoppm|LibreOffice|Poppler/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

async function makeFullPresentationPackage() {
  const pkg = makeReviewedDesignPackage();
  const source = buildDeliverySource(pkg.root);
  const designPath = join(pkg.root, "Design.md");
  writeFileSync(designPath, implementationMarkdown(pkg.root, source));
  const contextPath = join(pkg.root, "context.yaml");
  const context = yaml.load(readFileSync(contextPath, "utf8"));
  context.artifacts.design_document = {
    path: "Design.md",
    artifact_version: "2",
    phase: "implementation_ready",
    contract_revision: 1,
    contract_digest: pkg.digest,
    contract_source_digest: context.artifacts.design_document.contract_source_digest,
    source_manifest_digest: sha256File(join(pkg.root, "audit", "delivery", "source-manifest.json")),
    source_bundle_digest: source.source_bundle_digest,
    realizes_prototype_version: "3",
    sha256: sha256File(designPath),
    updated_by: "design_specification",
  };
  writeFileSync(contextPath, yaml.dump(context));

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
    slide.addNotes(`[Sources]\n- internal: Design.md@${context.artifacts.design_document.sha256}\n- internal: prototype/index.html@v3`);
  }
  await pptx.writeFile({ fileName: pptxPath, compression: false });
  const inspected = await inspectPptx(pptxPath);
  const manifest = {
    path: "presentation/design-system.pptx",
    pptx_sha256: inspected.pptxSha256,
    artifact_version: "3",
    artifact_revision: 1,
    source_manifest_digest: context.artifacts.design_document.source_manifest_digest,
    source_bundle_digest: source.source_bundle_digest,
    design_document_sha256: context.artifacts.design_document.sha256,
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
  writeFileSync(join(auditDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...pkg, inspected, manifest, auditDir };
}

test("full presentation check regenerates QA and waits for independent Director review", async () => {
  const pkg = await makeFullPresentationPackage();
  const toolsRoot = makeRoot("full-cli-tools");
  try {
    const tools = fakeTools(toolsRoot, { pages: 8 });
    const env = {
      ...process.env,
      PATH: [dirname(tools.soffice), dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    };
    let result = spawnSync(process.execPath, [CHECK_PRESENTATION, "--package", pkg.root], { encoding: "utf8", env });
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    const qaPath = join(pkg.auditDir, "qa.json");
    const directorPath = join(pkg.auditDir, "director-review.json");
    assert.equal(existsSync(qaPath), true);
    assert.equal(existsSync(directorPath), false, "check command must not create Director evidence");
    let qa = JSON.parse(readFileSync(qaPath, "utf8"));
    assert.equal(qa.pptx_sha256, pkg.inspected.pptxSha256);
    assert.deepEqual(qa.renders.map((render) => render.slide_number), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(qa.renders.every((render) => render.sha256 === sha256File(join(pkg.root, render.path))));

    const partialReview = `${JSON.stringify({
      completed: true,
      pptx_sha256: pkg.inspected.pptxSha256,
      reviewed_slide_numbers: [1, 2],
      findings: [],
    }, null, 2)}\n`;
    writeFileSync(directorPath, partialReview);
    result = spawnSync(process.execPath, [CHECK_PRESENTATION, "--package", pkg.root], { encoding: "utf8", env });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(directorPath, "utf8"), partialReview);

    const completeReview = `${JSON.stringify({
      completed: true,
      pptx_sha256: pkg.inspected.pptxSha256,
      reviewed_slide_numbers: [1, 2, 3, 4, 5, 6, 7, 8],
      findings: [],
    }, null, 2)}\n`;
    writeFileSync(directorPath, completeReview);
    result = spawnSync(process.execPath, [CHECK_PRESENTATION, "--package", pkg.root], { encoding: "utf8", env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(directorPath, "utf8"), completeReview);
    qa = JSON.parse(readFileSync(qaPath, "utf8"));
    assert.ok(Object.values(qa.checks).every((status) => status === "pass"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
    rmSync(toolsRoot, { recursive: true, force: true });
  }
});

test("full presentation check never records passing QA for incomplete render coverage", async () => {
  const pkg = await makeFullPresentationPackage();
  const toolsRoot = makeRoot("incomplete-render-tools");
  try {
    const directorPath = join(pkg.auditDir, "director-review.json");
    const completeReview = `${JSON.stringify({
      completed: true,
      pptx_sha256: pkg.inspected.pptxSha256,
      reviewed_slide_numbers: [1, 2, 3, 4, 5, 6, 7, 8],
      findings: [],
    }, null, 2)}\n`;
    writeFileSync(directorPath, completeReview);
    const tools = fakeTools(toolsRoot, { pages: 7 });
    const env = {
      ...process.env,
      PATH: [dirname(tools.soffice), dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    };
    const result = spawnSync(process.execPath, [CHECK_PRESENTATION, "--package", pkg.root], { encoding: "utf8", env });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const qa = JSON.parse(readFileSync(join(pkg.auditDir, "qa.json"), "utf8"));
    assert.equal(qa.status, "unverified");
    assert.equal(readFileSync(directorPath, "utf8"), completeReview);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
    rmSync(toolsRoot, { recursive: true, force: true });
  }
});

test("package and Codex adapter publish the real presentation probe", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  assert.equal(pkg.scripts["presentation:probe"], "node scripts/presentation-probe.mjs");
  const adapter = readFileSync(ADAPTER, "utf8");
  assert.match(adapter, /LibreOffice|soffice/);
  assert.match(adapter, /Poppler|pdftoppm/);
  assert.match(adapter, /exit code `3`|退出码 `3`/i);
});
