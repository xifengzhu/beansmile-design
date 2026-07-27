import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import yaml from "js-yaml";
import {
  REQUIRED_NARRATIVE_ROLES,
  inspectPptx,
  presentationStructureIssues,
} from "../lib/presentation.mjs";
import { buildDeliverySource } from "../lib/design-source.mjs";
import { sha256File } from "../lib/hash.mjs";
import { makeReviewedDesignPackage } from "./design-delivery-fixture.mjs";

const CLI = resolve(import.meta.dirname, "..", "check-presentation.mjs");
const PACKAGE_JSON = resolve(import.meta.dirname, "..", "..", "package.json");
const CONTRACT = resolve(import.meta.dirname, "..", "..", "skills", "design-presentation", "references", "contract.md");
const DESIGN_SHA = "a".repeat(64);
const SOURCE_BUNDLE_DIGEST = "b".repeat(64);
const PROTOTYPE_VERSION = "3";
const FIXED_ZIP_DATE = new Date("2000-01-01T00:00:00Z");
const PNG_DATA = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X+X7WQAAAABJRU5ErkJggg==";

function expectedFacts(overrides = {}) {
  return {
    designDocumentSha256: DESIGN_SHA,
    prototypeVersion: PROTOTYPE_VERSION,
    sourceBundleDigest: SOURCE_BUNDLE_DIGEST,
    ...overrides,
  };
}

async function normalizeFixture(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const core = await zip.file("docProps/core.xml").async("string");
  zip.file(
    "docProps/core.xml",
    core.replace(/<dcterms:(created|modified)[^>]*>[^<]+<\/dcterms:\1>/g,
      (_match, kind) => `<dcterms:${kind} xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:${kind}>`),
  );
  for (const entry of Object.values(zip.files)) entry.date = FIXED_ZIP_DATE;
  const normalized = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    platform: "UNIX",
  });
  writeFileSync(path, normalized);
}

async function mutateFixtureZip(path, mutate) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  await mutate(zip);
  for (const entry of Object.values(zip.files)) entry.date = FIXED_ZIP_DATE;
  writeFileSync(path, await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    platform: "UNIX",
  }));
}

async function writeFixture(root, {
  fileName = "fixture.pptx",
  roles = REQUIRED_NARRATIVE_ROLES,
  imageOnlyRole = null,
  emptyPlaceholderRole = null,
  missingSourcesRole = null,
  fullBleedRole = null,
  outOfBoundsRole = null,
  overlapRole = null,
  chartRole = null,
  designSha = DESIGN_SHA,
  prototypeVersion = PROTOTYPE_VERSION,
} = {}) {
  const path = join(root, fileName);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "beansmile-design fixture";
  pptx.company = "Beansmile";
  pptx.subject = "Editable presentation structure fixture";
  pptx.title = "Design presentation fixture";
  pptx.revision = "1";
  pptx.lang = "zh-CN";
  pptx.defineSlideMaster({
    title: "TASK7_CONTENT",
    background: { color: "FFFFFF" },
    objects: [
      { placeholder: { options: { name: "fixture_title", type: "title", x: 0.7, y: 0.5, w: 8.5, h: 0.5, fontSize: 26 }, text: "" } },
      { placeholder: { options: { name: "fixture_body", type: "body", x: 0.7, y: 1.3, w: 8.5, h: 2, fontSize: 16 }, text: "" } },
    ],
  });

  for (const role of roles) {
    const slide = pptx.addSlide("TASK7_CONTENT");
    if (role !== imageOnlyRole) {
      slide.addText(`${role} title`, {
        placeholder: "fixture_title",
        x: 0.7,
        y: 0.5,
        w: 8.5,
        h: 0.5,
        fontSize: 26,
      });
      if (role !== emptyPlaceholderRole) {
        slide.addText(`${role} body`, {
          placeholder: "fixture_body",
          x: 0.7,
          y: 1.3,
          w: 8.5,
          h: 2,
          fontSize: 16,
        });
      }
      if (role === overlapRole) {
        slide.addText("intentional overlap callout", {
          x: 0.7,
          y: 0.65,
          w: 8.5,
          h: 0.3,
          fontSize: 12,
        });
      }
    }
    if (role === "system" && role !== imageOnlyRole) {
      slide.addShape(pptx.ShapeType.rect, { x: 10.5, y: 4.7, w: 1.2, h: 0.8, fill: { color: "14532D" } });
    }
    if (role === "value" && role !== imageOnlyRole) {
      slide.addTable([
        ["Metric", "Status"],
        ["Structure", "Verified"],
      ], { x: 9.8, y: 3.7, w: 2.7, h: 1.2, fontSize: 10 });
    }
    if (role === chartRole && role !== imageOnlyRole) {
      slide.addChart(pptx.ChartType.bar, [{
        name: "Readiness",
        labels: ["Structure"],
        values: [1],
      }], { x: 9.7, y: 2, w: 2.7, h: 1.4, showLegend: false, showTitle: false });
    }
    if (role === "core_pages" && role !== imageOnlyRole && role !== fullBleedRole) {
      slide.addImage({ data: PNG_DATA, x: 11.2, y: 5.7, w: 1.2, h: 0.9 });
    }
    if (role === imageOnlyRole || role === fullBleedRole) {
      slide.addImage({ data: PNG_DATA, x: 0, y: 0, w: 13.333333, h: 7.5 });
    }
    if (role === outOfBoundsRole) {
      slide.addShape(pptx.ShapeType.rect, { x: 13, y: 6.9, w: 1, h: 1, fill: { color: "DC2626" } });
    }
    slide.addNotes(role === missingSourcesRole
      ? "Internal references omitted"
      : `[Sources]\n- internal: Design.md@${designSha}\n- internal: prototype/index.html@v${prototypeVersion}`);
  }

  await pptx.writeFile({ fileName: path, compression: false });
  await normalizeFixture(path);
  return path;
}

function presentationManifest(inspected, {
  designSha = DESIGN_SHA,
  prototypeVersion = PROTOTYPE_VERSION,
  sourceBundleDigest = SOURCE_BUNDLE_DIGEST,
  sourceManifestDigest = "c".repeat(64),
  artifactRevision = 1,
  roles = REQUIRED_NARRATIVE_ROLES,
} = {}) {
  return {
    path: "presentation/design-system.pptx",
    pptx_sha256: inspected.pptxSha256,
    artifact_version: prototypeVersion,
    artifact_revision: artifactRevision,
    source_manifest_digest: sourceManifestDigest,
    source_bundle_digest: sourceBundleDigest,
    design_document_sha256: designSha,
    slides: inspected.slides.map((slide, index) => ({
      slide_number: slide.number,
      slide_id: slide.stableId,
      relationship_id: slide.relationshipId,
      narrative_role: roles[index],
      title_object_id: slide.objects.find((object) => object.placeholderType === "title")?.id ?? null,
      project_sources: ["Design.md", `prototype/index.html@v${prototypeVersion}`],
      external_sources: [],
      object_counts: { ...slide.editableObjectCounts },
      full_bleed_background: null,
      allowed_overlaps: [],
    })),
  };
}

async function inspectFixture(options = {}) {
  const pkg = makeReviewedDesignPackage();
  const path = await writeFixture(pkg.root, options);
  const inspected = await inspectPptx(path);
  return { ...pkg, path, inspected };
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
    "# 第二部分：实施规格",
    "",
    "## 已选视觉方向",
    "",
    "- `direction_id`: `D3`",
    "",
    "## 设计令牌",
    "",
    "- `token`: `semantic.color.primary`",
    "",
    "## 组件实施契约",
    "",
    "- `component_id`: `inquiry-form`",
    "",
    "## 资源清单",
    "",
    "- `asset_path`: `prototype/assets/logo.png`",
    "",
    "## 页面与原型映射",
    "",
    "- `page_id`: `home`",
    "- `prototype_path`: `prototype/index.html`",
    "",
    "## 开发验收用例",
    "",
    "- `flow`: `提交询价`",
    "- `scenario_id`: `inquiry-success`",
    "- `scenario_id`: `inquiry-error`",
    "",
    "## 评审、例外与人工验证",
    "",
    "- `decision_id`: `direction-D3`",
    "- `finding_id`: `visual-warning-1`",
    "- `manual_check`: `screen-reader-announcement-order`",
    "",
  ].join("\n");
}

test("inspectPptx returns stable slide identities, editable counts, notes, bounds, and image coverage", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const firstPath = await writeFixture(pkg.root, { fileName: "first.pptx" });
    const secondPath = await writeFixture(pkg.root, { fileName: "second.pptx" });
    const inspected = await inspectPptx(firstPath);
    assert.deepEqual(readFileSync(firstPath), readFileSync(secondPath), "fixture bytes must be deterministic");
    assert.match(inspected.pptxSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(inspected.slideSize, { width: 12192000, height: 6858000 });
    assert.deepEqual(inspected.slides.map((slide) => slide.stableId),
      ["256", "257", "258", "259", "260", "261", "262", "263"]);
    assert.deepEqual(inspected.slides.map((slide) => slide.relationshipId),
      ["rId2", "rId3", "rId4", "rId5", "rId6", "rId7", "rId8", "rId9"]);
    assert.ok(inspected.slides.every((slide) => slide.layoutPath === "ppt/slideLayouts/slideLayout2.xml"));
    assert.deepEqual(inspected.slides.map((slide) => slide.editableObjectCounts), [
      { text: 2, shape: 0, table: 0, chart: 0, image: 0 },
      { text: 2, shape: 0, table: 0, chart: 0, image: 0 },
      { text: 2, shape: 0, table: 0, chart: 0, image: 0 },
      { text: 2, shape: 1, table: 0, chart: 0, image: 0 },
      { text: 2, shape: 0, table: 0, chart: 0, image: 1 },
      { text: 2, shape: 0, table: 1, chart: 0, image: 0 },
      { text: 2, shape: 0, table: 0, chart: 0, image: 0 },
      { text: 2, shape: 0, table: 0, chart: 0, image: 0 },
    ]);
    assert.ok(inspected.slides.every((slide) => slide.notes.includes("[Sources]")));
    assert.ok(inspected.slides.every((slide) => slide.objects.every((object) =>
      object.bounds && Object.values(object.bounds).every(Number.isFinite))));
    assert.equal(inspected.slides[4].imageCoverage > 0, true);
    assert.equal(inspected.slides[4].imageCoverage < 0.9, true);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation structure accepts the exact eight-role editable deck", async () => {
  const pkg = await inspectFixture();
  try {
    assert.deepEqual(REQUIRED_NARRATIVE_ROLES, [
      "cover", "problem", "mainline", "system", "core_pages", "value", "boundaries", "next_steps",
    ]);
    const manifest = presentationManifest(pkg.inspected);
    assert.deepEqual(presentationStructureIssues(pkg.inspected, manifest, expectedFacts()), []);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("nested grouped objects are counted with composed absolute bounds and cannot hide overflow", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const slidePath = "ppt/slides/slide7.xml";
      const xml = await zip.file(slidePath).async("string");
      const nestedGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="90" name="Outer Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="10058400" y="0"/><a:ext cx="1828800" cy="1828800"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="1828800"/></a:xfrm></p:grpSpPr>
<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="91" name="Inner Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="1828800" cy="1828800"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="1828800"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="92" name="Nested Overflow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>
</p:grpSp>
</p:grpSp>`;
      assert.ok(xml.includes("</p:spTree>"));
      zip.file(slidePath, xml.replace("</p:spTree>", `${nestedGroup}</p:spTree>`));
    });
    const inspected = await inspectPptx(path);
    const slide = inspected.slides[6];
    assert.equal(slide.editableObjectCounts.shape, 1);
    const grouped = slide.objects.find((object) => object.id === "92");
    assert.deepEqual(grouped?.bounds, { x: 11887200, y: 0, width: 914400, height: 914400 });
    const issues = presentationStructureIssues(inspected, presentationManifest(inspected), expectedFacts());
    assert.ok(issues.some((issue) => /slide 7.*92.*越出|slide 7.*92.*canvas/.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("rotated grouped objects use absolute axis-aligned bounds for overflow checks", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const slidePath = "ppt/slides/slide7.xml";
      const xml = await zip.file(slidePath).async("string");
      const rotatedGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="90" name="Rotated Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="5400000"><a:off x="10000000" y="0"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="91" name="Rotated Overflow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>
</p:grpSp>`;
      assert.ok(xml.includes("</p:spTree>"));
      zip.file(slidePath, xml.replace("</p:spTree>", `${rotatedGroup}</p:spTree>`));
    });
    const inspected = await inspectPptx(path);
    const object = inspected.slides[6].objects.find((entry) => entry.id === "91");
    assert.deepEqual(object?.bounds, { x: 10500000, y: -500000, width: 1000000, height: 2000000 });
    const issues = presentationStructureIssues(inspected, presentationManifest(inspected), expectedFacts());
    assert.ok(issues.some((issue) => /slide 7.*91.*越出|slide 7.*91.*canvas/.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("missing slide and relationship IDs fail closed", async () => {
  for (const kind of ["slide", "relationship"]) {
    const pkg = makeReviewedDesignPackage();
    try {
      const path = await writeFixture(pkg.root);
      await mutateFixtureZip(path, async (zip) => {
        const presentationPath = "ppt/presentation.xml";
        const relsPath = "ppt/_rels/presentation.xml.rels";
        const presentation = await zip.file(presentationPath).async("string");
        if (kind === "slide") {
          const changed = presentation.replace('<p:sldId id="256" r:id="rId2"/>', '<p:sldId r:id="rId2"/>');
          assert.notEqual(changed, presentation);
          zip.file(presentationPath, changed);
        } else {
          const changed = presentation.replace('id="256" r:id="rId2"', 'id="256" r:id=""');
          assert.notEqual(changed, presentation);
          zip.file(presentationPath, changed);
          const rels = await zip.file(relsPath).async("string");
          const changedRels = rels.replace('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"',
            'Id="" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"');
          assert.notEqual(changedRels, rels);
          zip.file(relsPath, changedRels);
        }
      });
      await assert.rejects(() => inspectPptx(path), /slide.*id|relationship ID|稳定.*ID/i);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("malformed slide and relationship IDs fail closed", async () => {
  for (const kind of ["slide", "relationship"]) {
    const pkg = makeReviewedDesignPackage();
    try {
      const path = await writeFixture(pkg.root);
      await mutateFixtureZip(path, async (zip) => {
        const presentationPath = "ppt/presentation.xml";
        const relsPath = "ppt/_rels/presentation.xml.rels";
        const presentation = await zip.file(presentationPath).async("string");
        if (kind === "slide") {
          const changed = presentation.replace('id="256" r:id="rId2"', 'id="abc" r:id="rId2"');
          assert.notEqual(changed, presentation);
          zip.file(presentationPath, changed);
        } else {
          const changed = presentation.replace('id="256" r:id="rId2"', 'id="256" r:id="bad id"');
          assert.notEqual(changed, presentation);
          zip.file(presentationPath, changed);
          const rels = await zip.file(relsPath).async("string");
          const changedRels = rels.replace('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"',
            'Id="bad id" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"');
          assert.notEqual(changedRels, rels);
          zip.file(relsPath, changedRels);
        }
      });
      await assert.rejects(() => inspectPptx(path), /slide.*ID|relationship ID|OOXML ID/i);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("missing editable object IDs fail closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const slidePath = "ppt/slides/slide1.xml";
      const xml = await zip.file(slidePath).async("string");
      const changed = xml.replace('<p:cNvPr id="2" name="Text 0">', '<p:cNvPr name="Text 0">');
      assert.notEqual(changed, xml);
      zip.file(slidePath, changed);
    });
    const inspected = await inspectPptx(path);
    const issues = presentationStructureIssues(inspected, presentationManifest(inspected), expectedFacts());
    assert.ok(issues.some((issue) => /object.*id|对象.*ID/i.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("malformed leaf and missing root group object IDs fail closed", async () => {
  for (const kind of ["leaf", "root-group"]) {
    const pkg = makeReviewedDesignPackage();
    try {
      const path = await writeFixture(pkg.root);
      await mutateFixtureZip(path, async (zip) => {
        const slidePath = "ppt/slides/slide1.xml";
        const xml = await zip.file(slidePath).async("string");
        const changed = kind === "leaf"
          ? xml.replace('<p:cNvPr id="2" name="Text 0">', '<p:cNvPr id="abc" name="Text 0">')
          : xml.replace(/(<p:spTree><p:nvGrpSpPr><p:cNvPr) id="1"/, "$1");
        assert.notEqual(changed, xml);
        zip.file(slidePath, changed);
      });
      const inspected = await inspectPptx(path);
      const issues = presentationStructureIssues(inspected, presentationManifest(inspected), expectedFacts());
      assert.ok(issues.some((issue) => /object.*ID|对象.*ID|OOXML ID/i.test(issue)), `${kind}: ${issues.join("\n")}`);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("overlaps cannot disappear when one editable object ID is missing", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root, { overlapRole: "value" });
    await mutateFixtureZip(path, async (zip) => {
      const slidePath = "ppt/slides/slide6.xml";
      const xml = await zip.file(slidePath).async("string");
      const changed = xml.replace('<p:cNvPr id="4" name="Text 2">', '<p:cNvPr name="Text 2">');
      assert.notEqual(changed, xml);
      zip.file(slidePath, changed);
    });
    const inspected = await inspectPptx(path);
    const issues = presentationStructureIssues(inspected, presentationManifest(inspected), expectedFacts());
    assert.ok(issues.some((issue) => /object.*id|对象.*ID|overlap.*ID|重叠.*ID/i.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("missing slide layout relationship fails closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const relsPath = "ppt/slides/_rels/slide1.xml.rels";
      const xml = await zip.file(relsPath).async("string");
      const changed = xml.replace(/<Relationship [^>]*Type="[^"]+\/slideLayout"[^>]*\/>/, "");
      assert.notEqual(changed, xml);
      zip.file(relsPath, changed);
    });
    await assert.rejects(() => inspectPptx(path), /slide 1.*layout|layout.*slide 1/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("missing notes-to-slide backlink fails closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const relsPath = "ppt/notesSlides/_rels/notesSlide1.xml.rels";
      const xml = await zip.file(relsPath).async("string");
      const changed = xml.replace(/<Relationship [^>]*Type="[^"]+\/slide"[^>]*\/>/, "");
      assert.notEqual(changed, xml);
      zip.file(relsPath, changed);
    });
    await assert.rejects(() => inspectPptx(path), /notes.*backlink|backlink.*notes|notes.*slide 1/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("missing embedded image target fails closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, (zip) => {
      const media = Object.keys(zip.files).find((entry) => entry.startsWith("ppt/media/") && !zip.files[entry].dir);
      assert.ok(media);
      zip.remove(media);
    });
    await assert.rejects(() => inspectPptx(path), /image|media|图片/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("missing chart target fails closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root, { chartRole: "mainline" });
    await mutateFixtureZip(path, (zip) => {
      const chart = Object.keys(zip.files).find((entry) => /^ppt\/charts\/chart[^/]+\.xml$/.test(entry));
      assert.ok(chart);
      zip.remove(chart);
    });
    await assert.rejects(() => inspectPptx(path), /chart|图表/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("valid package-absolute chart targets are accepted", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root, { chartRole: "mainline" });
    const inspected = await inspectPptx(path);
    assert.equal(inspected.slides[2].editableObjectCounts.chart, 1);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("dangling declared chart relationships fail closed", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root, { chartRole: "mainline" });
    await mutateFixtureZip(path, async (zip) => {
      const relsPath = "ppt/slides/_rels/slide3.xml.rels";
      const xml = await zip.file(relsPath).async("string");
      const relation = '<Relationship Id="rId999" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/ppt/charts/missing.xml"/>';
      zip.file(relsPath, xml.replace("</Relationships>", `${relation}</Relationships>`));
    });
    await assert.rejects(() => inspectPptx(path), /rId999|missing\.xml|target part.*不存在/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation slide relationships cannot be external", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const relsPath = "ppt/_rels/presentation.xml.rels";
      const xml = await zip.file(relsPath).async("string");
      const changed = xml.replace('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"',
        'Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" TargetMode="External"');
      assert.notEqual(changed, xml);
      zip.file(relsPath, changed);
    });
    await assert.rejects(() => inspectPptx(path), /presentation.*package|presentation.*内嵌|slide.*External/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("declared relationship IDs must be unique within a relationship part", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root);
    await mutateFixtureZip(path, async (zip) => {
      const relsPath = "ppt/slides/_rels/slide1.xml.rels";
      const xml = await zip.file(relsPath).async("string");
      const relation = xml.match(/<Relationship [^>]*Id="rId1"[^>]*\/>/)?.[0];
      assert.ok(relation);
      zip.file(relsPath, xml.replace("</Relationships>", `${relation}</Relationships>`));
    });
    await assert.rejects(() => inspectPptx(path), /duplicate.*relationship|relationship.*重复|重复.*relationship/i);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("one full_bleed_background declaration cannot authorize two qualifying images", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const path = await writeFixture(pkg.root, { fullBleedRole: "cover" });
    await mutateFixtureZip(path, async (zip) => {
      const slidePath = "ppt/slides/slide1.xml";
      const xml = await zip.file(slidePath).async("string");
      const picture = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/)?.[0];
      assert.ok(picture);
      const duplicate = picture.replace(/<p:cNvPr id="4"/, '<p:cNvPr id="44"');
      assert.notEqual(duplicate, picture);
      zip.file(slidePath, xml.replace(picture, `${picture}${duplicate}`));
    });
    const inspected = await inspectPptx(path);
    const manifest = presentationManifest(inspected);
    const slide = inspected.slides[0];
    const images = slide.objects.filter((object) => object.type === "image" && object.imageCoverage >= 0.9);
    assert.equal(images.length, 2);
    manifest.slides[0].full_bleed_background = {
      object_id: images[0].id,
      reason: "Declared editable cover background",
    };
    const declarations = [];
    for (let left = 0; left < slide.objects.length; left += 1) {
      for (let right = left + 1; right < slide.objects.length; right += 1) {
        const a = slide.objects[left];
        const b = slide.objects[right];
        if (a.bounds.x < b.bounds.x + b.bounds.width
          && b.bounds.x < a.bounds.x + a.bounds.width
          && a.bounds.y < b.bounds.y + b.bounds.height
          && b.bounds.y < a.bounds.y + a.bounds.height) {
          declarations.push({ object_ids: [a.id, b.id], reason: "Explicit fixture overlap" });
        }
      }
    }
    manifest.slides[0].allowed_overlaps = declarations;
    const issues = presentationStructureIssues(inspected, manifest, expectedFacts());
    assert.ok(issues.some((issue) => /multiple|more than one|多张|多个.*full/i.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation structure rejects missing roles and image-only content", async () => {
  const missing = await inspectFixture({ roles: REQUIRED_NARRATIVE_ROLES.filter((role) => role !== "boundaries") });
  try {
    const manifest = presentationManifest(missing.inspected, {
      roles: REQUIRED_NARRATIVE_ROLES.filter((role) => role !== "boundaries"),
    });
    assert.ok(presentationStructureIssues(missing.inspected, manifest, expectedFacts())
      .some((issue) => /role|叙事|boundaries/.test(issue)));
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const imageOnly = await inspectFixture({ imageOnlyRole: "problem" });
  try {
    const manifest = presentationManifest(imageOnly.inspected);
    const issues = presentationStructureIssues(imageOnly.inspected, manifest, expectedFacts());
    assert.ok(issues.some((issue) => /图片|image|90%|full/i.test(issue)), issues.join("\n"));
    assert.ok(issues.some((issue) => /标题|title|editable/i.test(issue)), issues.join("\n"));
  } finally {
    rmSync(imageOnly.root, { recursive: true, force: true });
  }
});

test("presentation structure rejects empty placeholders and absent Sources notes", async () => {
  const empty = await inspectFixture({ emptyPlaceholderRole: "mainline" });
  try {
    const manifest = presentationManifest(empty.inspected);
    assert.ok(presentationStructureIssues(empty.inspected, manifest, expectedFacts())
      .some((issue) => /placeholder|占位/.test(issue)));
  } finally {
    rmSync(empty.root, { recursive: true, force: true });
  }

  const noSources = await inspectFixture({ missingSourcesRole: "system" });
  try {
    const manifest = presentationManifest(noSources.inspected);
    assert.ok(presentationStructureIssues(noSources.inspected, manifest, expectedFacts())
      .some((issue) => /\[Sources\]|来源|notes/.test(issue)));
  } finally {
    rmSync(noSources.root, { recursive: true, force: true });
  }
});

test("source bindings must appear inside the Sources notes block", async () => {
  const pkg = await inspectFixture();
  try {
    const source = "https://example.com/fact";
    pkg.inspected.slides[0].notes = [
      source,
      `Design.md@${DESIGN_SHA}`,
      `prototype/index.html@v${PROTOTYPE_VERSION}`,
      "[Sources]",
    ].join("\n");
    const manifest = presentationManifest(pkg.inspected);
    manifest.slides[0].external_sources = [source];
    const issues = presentationStructureIssues(pkg.inspected, manifest, expectedFacts());
    assert.ok(issues.some((issue) => /Sources.*block|\[Sources\].*块|来源块/i.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation structure recomputes hashes, source bindings, and object counts", async () => {
  const pkg = await inspectFixture();
  try {
    const valid = presentationManifest(pkg.inspected);
    const staleDesign = structuredClone(valid);
    staleDesign.design_document_sha256 = "f".repeat(64);
    assert.ok(presentationStructureIssues(pkg.inspected, staleDesign, expectedFacts())
      .some((issue) => /Design\.md|design_document_sha256/.test(issue)));

    const staleSource = structuredClone(valid);
    staleSource.source_bundle_digest = "f".repeat(64);
    assert.ok(presentationStructureIssues(pkg.inspected, staleSource, expectedFacts())
      .some((issue) => /source_bundle_digest|交付来源/.test(issue)));

    const wrongCounts = structuredClone(valid);
    wrongCounts.slides[0].object_counts.text += 1;
    assert.ok(presentationStructureIssues(pkg.inspected, wrongCounts, expectedFacts())
      .some((issue) => /object_counts|对象数量/.test(issue)));

    const wrongPptx = structuredClone(valid);
    wrongPptx.pptx_sha256 = "f".repeat(64);
    assert.ok(presentationStructureIssues(pkg.inspected, wrongPptx, expectedFacts())
      .some((issue) => /PPTX|pptx_sha256/.test(issue)));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation structure rejects undeclared full-bleed images and out-of-bounds objects", async () => {
  const fullBleed = await inspectFixture({ fullBleedRole: "core_pages" });
  try {
    const manifest = presentationManifest(fullBleed.inspected);
    assert.ok(presentationStructureIssues(fullBleed.inspected, manifest, expectedFacts())
      .some((issue) => /full.?bleed|全幅|90%|背景图/i.test(issue)));
  } finally {
    rmSync(fullBleed.root, { recursive: true, force: true });
  }

  const overflow = await inspectFixture({ outOfBoundsRole: "boundaries" });
  try {
    const manifest = presentationManifest(overflow.inspected);
    assert.ok(presentationStructureIssues(overflow.inspected, manifest, expectedFacts())
      .some((issue) => /越界|canvas|bounds|画布/i.test(issue)));
  } finally {
    rmSync(overflow.root, { recursive: true, force: true });
  }
});

test("allowed overlaps require the exact object pair and a nonempty reason", async () => {
  const pkg = await inspectFixture({ overlapRole: "value" });
  try {
    const base = presentationManifest(pkg.inspected);
    const slideIndex = REQUIRED_NARRATIVE_ROLES.indexOf("value");
    const slide = pkg.inspected.slides[slideIndex];
    const pair = [
      slide.objects.find((object) => object.placeholderType === "title")?.id,
      slide.objects.find((object) => object.text === "intentional overlap callout")?.id,
    ];
    assert.equal(pair.length, 2);
    assert.ok(pair.every(Boolean));
    assert.ok(presentationStructureIssues(pkg.inspected, base, expectedFacts())
      .some((issue) => /overlap|重叠/.test(issue)));

    const allowed = structuredClone(base);
    allowed.slides[slideIndex].allowed_overlaps = [{ object_ids: pair, reason: "Intentional editorial title overlap" }];
    assert.deepEqual(presentationStructureIssues(pkg.inspected, allowed, expectedFacts()), []);

    const emptyReason = structuredClone(allowed);
    emptyReason.slides[slideIndex].allowed_overlaps[0].reason = " ";
    assert.ok(presentationStructureIssues(pkg.inspected, emptyReason, expectedFacts())
      .some((issue) => /reason|原因/.test(issue)));

    const unknownObject = structuredClone(allowed);
    unknownObject.slides[slideIndex].allowed_overlaps[0].object_ids = [pair[0], "999"];
    assert.ok(presentationStructureIssues(pkg.inspected, unknownObject, expectedFacts())
      .some((issue) => /object|对象|999/.test(issue)));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("structure-only CLI validates delivery source, final Design.md, PPTX, and manifest", async () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const source = buildDeliverySource(pkg.root);
    writeFileSync(join(pkg.root, "Design.md"), implementationMarkdown(pkg.root, source));
    const contextPath = join(pkg.root, "context.yaml");
    const context = yaml.load(readFileSync(contextPath, "utf8"));
    const artifact = {
      path: "Design.md",
      artifact_version: "2",
      phase: "implementation_ready",
      contract_revision: 1,
      contract_digest: pkg.digest,
      contract_source_digest: context.artifacts.design_document.contract_source_digest,
      source_manifest_digest: sha256File(join(pkg.root, "audit", "delivery", "source-manifest.json")),
      source_bundle_digest: source.source_bundle_digest,
      realizes_prototype_version: "3",
      sha256: sha256File(join(pkg.root, "Design.md")),
      updated_by: "design_specification",
    };
    context.artifacts.design_document = artifact;
    writeFileSync(contextPath, yaml.dump(context));

    mkdirSync(join(pkg.root, "presentation"), { recursive: true });
    mkdirSync(join(pkg.root, "audit", "presentation"), { recursive: true });
    const pptxPath = await writeFixture(join(pkg.root, "presentation"), {
      fileName: "design-system.pptx",
      designSha: artifact.sha256,
      prototypeVersion: "3",
    });
    const inspected = await inspectPptx(pptxPath);
    const manifest = presentationManifest(inspected, {
      designSha: artifact.sha256,
      prototypeVersion: "3",
      sourceBundleDigest: source.source_bundle_digest,
      sourceManifestDigest: sha256File(join(pkg.root, "audit", "delivery", "source-manifest.json")),
    });
    const manifestPath = join(pkg.root, "audit", "presentation", "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let result = spawnSync("node", [CLI, "--package", pkg.root, "--structure-only"], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PPTX.*结构.*通过|结构.*PPTX.*通过/);

    manifest.pptx_sha256 = "f".repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    result = spawnSync("node", [CLI, "--package", pkg.root, "--structure-only"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PPTX|pptx_sha256/);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("presentation contract and package script publish the executable structure rules", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  assert.equal(pkg.scripts["delivery:check-presentation"], "node scripts/check-presentation.mjs");
  const contract = readFileSync(CONTRACT, "utf8");
  for (const role of REQUIRED_NARRATIVE_ROLES) assert.match(contract, new RegExp(`\\b${role}\\b`));
  for (const field of [
    "artifact_version", "artifact_revision", "design_document_sha256", "source_bundle_digest",
    "object_counts", "allowed_overlaps", "title_object_id", "project_sources", "external_sources",
  ]) assert.ok(contract.includes(field), field);
  assert.match(contract, /\[Sources\]/);
  assert.match(contract, /PptxGenJS.*fixture|fixture.*PptxGenJS/i);
  assert.match(contract, /grouped objects.*recurs|recurs.*grouped objects/i);
  assert.match(contract, /notes-to-slide backlink/i);
  assert.match(contract, /image.*relationship.*media part/i);
  assert.match(contract, /chart.*relationship.*chart part/i);
  assert.match(contract, /only one.*90%|90%.*only one/i);
});
