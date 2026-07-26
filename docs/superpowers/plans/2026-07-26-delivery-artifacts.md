# Delivery Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited professional-mode generation of a development-ready `Design.md` and an editable design proposal PPTX, with quick-mode opt-in semantics and version-bound acceptance gates.

**Architecture:** Keep the canonical stage chain unchanged. Add two `deliverable` Skills that consume one immutable delivery source bundle after review, produce derived artifacts, and can only patch their own `context.artifacts` keys. Deterministic Node scripts validate Markdown closure, recompute PPTX OOXML structure, render slides through a probed adapter, and block `review -> delivered` unless all requested outputs pass.

**Tech Stack:** Node.js 18 ESM, `node:test`, AJV, YAML, PptxGenJS, JSZip, fast-xml-parser, LibreOffice `soffice`, Poppler `pdftoppm`, existing Playwright/axe and hash/acceptance helpers.

---

## File Map

New runtime files:

- `scripts/lib/delivery.mjs`: delivery mode semantics, artifact binding, and revision rules.
- `scripts/lib/delivery-source.mjs`: immutable source bundle creation and drift verification.
- `scripts/lib/handoff.mjs`: `Design.md` parser and closure checks.
- `scripts/lib/presentation.mjs`: PPTX OOXML inspection and structural contract checks.
- `scripts/lib/presentation-render.mjs`: `soffice`/`pdftoppm` adapter probe and deterministic slide renders.
- `scripts/prepare-delivery.mjs`: Director CLI to freeze `audit/delivery/source-manifest.json`.
- `scripts/check-handoff.mjs`: focused handoff validator CLI.
- `scripts/check-presentation.mjs`: focused PPTX structure/render/QA validator CLI.
- `scripts/presentation-probe.mjs`: create, reread, and render a one-slide editable deck.

New Skill files:

- `skills/developer-handoff/SKILL.md`
- `skills/developer-handoff/references/contract.md`
- `skills/design-presentation/SKILL.md`
- `skills/design-presentation/references/contract.md`
- `skills/design-presentation/references/codex-adapter.md`

New tests:

- `scripts/test/delivery-contracts.test.mjs`
- `scripts/test/delivery-source.test.mjs`
- `scripts/test/handoff.test.mjs`
- `scripts/test/presentation.test.mjs`
- `scripts/test/presentation-probe.test.mjs`
- `scripts/test/delivery-acceptance.test.mjs`

Existing files changed by responsibility:

- Registry/schema: `skills/registry.yaml`, `schemas/skill-manifests.yaml`, `schemas/skill-manifest.schema.json`, `schemas/context.schema.json`.
- Runtime: `scripts/lib/registry.mjs`, `scripts/lib/context.mjs`, `scripts/init-project.mjs`, `scripts/snapshot.mjs`, `scripts/env-check.mjs`, `scripts/director-advance.mjs`, `scripts/acceptance.mjs`.
- Commands/dependencies: `package.json`, `package-lock.json`.
- Documentation: `README.md`, `docs/usage.md`, `docs/development.md`, `skills/design-director/SKILL.md`, and the two system design specs.

Spec coverage is explicit: Task 1 implements modes, registry, patch ownership, and revision semantics; Task 2 implements the immutable source bundle; Task 3 implements the full `Design.md` contract; Tasks 4-5 implement editable PPTX structure, sources, rendering, and independent Director review; Task 6 enforces history-aware acceptance and the final transition; Task 7 updates user and maintainer contracts; Task 8 proves the complete workflow and adversarial failures on real output files.

### Task 1: Register Deliverable Skills And Context Contracts

> Before editing either Skill, invoke `skill-creator` and `superpowers:writing-skills` and follow their validation requirements.

**Files:**

- Create: `scripts/lib/delivery.mjs`
- Create: `scripts/test/delivery-contracts.test.mjs`
- Create: `skills/developer-handoff/SKILL.md`
- Create: `skills/developer-handoff/references/contract.md`
- Create: `skills/design-presentation/SKILL.md`
- Create: `skills/design-presentation/references/contract.md`
- Create: `skills/design-presentation/references/codex-adapter.md`
- Modify: `skills/registry.yaml`
- Modify: `schemas/skill-manifests.yaml`
- Modify: `schemas/skill-manifest.schema.json`
- Modify: `schemas/context.schema.json`
- Modify: `scripts/lib/registry.mjs`
- Modify: `scripts/lib/context.mjs`
- Modify: `scripts/init-project.mjs`
- Test: `scripts/test/project-context.test.mjs`
- Test: `scripts/test/gates.test.mjs`

- [ ] **Step 1: Write failing contract tests**

Add tests that define the exact mode and patch behavior:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { requiredDeliveryOutputs, deliveryModeIssues } from "../lib/delivery.mjs";
import { hardenedGate } from "../lib/context.mjs";
import { loadManifests } from "../lib/manifests.mjs";
import { loadRegistry, validateRegistry } from "../lib/registry.mjs";

const BOTH = ["developer_handoff", "design_presentation"];

test("professional mode requires both delivery outputs", () => {
  const ctx = { project: { mode: "professional", delivery_outputs: BOTH } };
  assert.deepEqual(requiredDeliveryOutputs(ctx), BOTH);
  assert.deepEqual(deliveryModeIssues(ctx, { enforce: true }), []);
  assert.match(deliveryModeIssues({ project: { mode: "professional", delivery_outputs: [] } }, { enforce: true })[0], /缺少/);
});

test("quick mode validates only explicitly requested outputs", () => {
  assert.deepEqual(requiredDeliveryOutputs({ project: { mode: "quick", delivery_outputs: [] } }), []);
  assert.deepEqual(requiredDeliveryOutputs({ project: { mode: "quick", delivery_outputs: ["developer_handoff"] } }), ["developer_handoff"]);
});

test("deliverable registry entries and manifests are complete", () => {
  const registry = loadRegistry();
  const manifests = loadManifests();
  assert.equal(registry.byId.get("developer_handoff").kind, "deliverable");
  assert.equal(registry.byId.get("design_presentation").kind, "deliverable");
  assert.deepEqual(manifests.bySkill.get("developer_handoff").writes, ["artifacts.handoff"]);
  assert.deepEqual(manifests.bySkill.get("design_presentation").writes, ["artifacts.presentation"]);
  assert.equal(validateRegistry().ok, true);
});

test("same-version regeneration increments revision without changing design version", () => {
  const before = {
    project: { name: "Demo", mode: "professional", task_type: "new_design", platforms: ["web"], reference_system: "none", delivery_outputs: BOTH },
    users: { primary: "buyer" }, goals: {}, stage: "review",
    artifacts: {
      prototype: { path: "prototype/index.html", artifact_version: "3" },
      handoff: { path: "Design.md", artifact_version: "3", artifact_revision: 1, source_manifest_digest: "a".repeat(64), source_bundle_digest: "b".repeat(64), sha256: "c".repeat(64), updated_by: "developer_handoff" },
    },
  };
  const patch = { artifacts: { handoff: { ...before.artifacts.handoff, artifact_revision: 2, sha256: "d".repeat(64) } } };
  const gate = hardenedGate(loadManifests().bySkill.get("developer_handoff"), before, { patch });
  assert.equal(gate.ok, true);
  assert.equal(hardenedGate(loadManifests().bySkill.get("developer_handoff"), before, { patch: { stage: "delivered" } }).ok, false);
});
```

Extend `scripts/test/project-context.test.mjs` so each new Skill sees only declared fields, and extend `scripts/test/gates.test.mjs` with a rejection for unchanged `artifact_revision`.

- [ ] **Step 2: Run focused tests and confirm the missing-module failure**

Run:

```bash
node --test scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/delivery.mjs` or missing registry entries.

- [ ] **Step 3: Implement delivery mode and revision semantics**

Create `scripts/lib/delivery.mjs` with these exported contracts:

```js
export const DELIVERY_OUTPUTS = Object.freeze(["developer_handoff", "design_presentation"]);

export function requiredDeliveryOutputs(ctx) {
  const requested = ctx?.project?.delivery_outputs ?? [];
  return ctx?.project?.mode === "professional" ? [...DELIVERY_OUTPUTS] : [...requested];
}

export function deliveryModeIssues(ctx, { enforce = false } = {}) {
  if (!enforce) return [];
  const requested = ctx?.project?.delivery_outputs ?? [];
  const unknown = requested.filter((id) => !DELIVERY_OUTPUTS.includes(id));
  const missing = ctx?.project?.mode === "professional"
    ? DELIVERY_OUTPUTS.filter((id) => !requested.includes(id))
    : [];
  return [
    ...(unknown.length ? [`未知 delivery_outputs: ${unknown.join(", ")}`] : []),
    ...(missing.length ? [`专业模式缺少 delivery_outputs: ${missing.join(", ")}`] : []),
  ];
}

export function isDerivedDeliveryArtifact(key) {
  return key === "handoff" || key === "presentation";
}
```

Update `checkArtifactMonotonic()` in `scripts/lib/context.mjs`: normal artifacts retain strict `artifact_version` monotonicity; `handoff` and `presentation` may keep the same version only when `artifact_revision` strictly increases. A higher design version resets revision to `1`.

- [ ] **Step 4: Extend schemas, registry, manifests, initialization, and projection**

Add `project.delivery_outputs` as a unique enum array. Add optional artifact properties `artifact_revision` (integer >= 1), `source_manifest_digest`, `source_bundle_digest`, and `sha256` (64 lowercase hex characters). Extend the manifest schema enum and add `required_modes` with enum values `professional|quick`.

Register:

```yaml
  - id: developer_handoff
    kind: deliverable
    dir: developer-handoff
    skill_tool_name: developer-handoff
  - id: design_presentation
    kind: deliverable
    dir: design-presentation
    skill_tool_name: design-presentation
```

Update `validateRegistry()` so `flow` and `deliverable` IDs, not reviewers or the Director, map one-to-one to manifests.

Update `init-project.mjs` so professional packages always initialize both values; quick packages accept `--deliverables developer_handoff,design_presentation` and otherwise initialize an empty array. Reject duplicates and unknown IDs before creating directories.

- [ ] **Step 5: Write complete Skill entrypoints and contracts**

Each `SKILL.md` must state: it only runs after the Director supplies `audit/delivery/source-manifest.json`; it cannot modify source files or `stage`; it writes only its declared output and patch; it aborts on drift; and it invokes the focused validator before returning. `design-presentation` must require the platform Presentations capability, native editable objects, per-slide sources, final slide renders, and Director visual review. Its Codex adapter reference must require `@oai/artifact-tool`; it must explicitly forbid `python-pptx`, PDF wrapping, and image-only content slides.

- [ ] **Step 6: Run contract tests and system validation**

Run:

```bash
node --test scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
npm run check
```

Expected: all focused tests pass; system output reports 7 patch-capable manifests and 10 registry entries.

- [ ] **Step 7: Commit the contract slice**

```bash
git add skills schemas scripts/lib/delivery.mjs scripts/lib/context.mjs scripts/lib/registry.mjs scripts/init-project.mjs scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
git commit -m "feat: register audited delivery skills"
```

### Task 2: Freeze And Verify The Delivery Source Bundle

**Files:**

- Create: `scripts/lib/delivery-source.mjs`
- Create: `scripts/prepare-delivery.mjs`
- Create: `scripts/test/delivery-source.test.mjs`
- Modify: `scripts/lib/hash.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing source-bundle tests**

Create a temporary review-stage package with snapshot `3`, context, appended `decisions.md`, results, report, both versioned findings, and one screenshot. Assert deterministic generation and drift detection:

```js
const first = buildDeliverySource(root);
const second = buildDeliverySource(root);
assert.equal(first.source_bundle_digest, second.source_bundle_digest);
assert.deepEqual(verifyDeliverySource(root, first), []);
writeFileSync(join(root, "decisions.md"), "changed after bundle");
assert.match(verifyDeliverySource(root, first)[0], /decisions\.md/);
```

Add CLI assertions: wrong stage, missing current snapshot, missing findings, or existing manifest without `--overwrite` must exit `1`; a valid package must create `audit/delivery/context.yaml` and `audit/delivery/source-manifest.json` atomically.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test scripts/test/delivery-source.test.mjs
```

Expected: FAIL because `scripts/lib/delivery-source.mjs` does not exist.

- [ ] **Step 3: Implement canonical bundle hashing**

Add `canonicalDigest(value)` to `scripts/lib/hash.mjs`, recursively sorting object keys before SHA-256. Implement `buildDeliverySource(root)` with this exact source set:

```js
const auditInputs = [
  "audit/results.json",
  "audit/report.md",
  `audit/findings/standards-${version}.yaml`,
  `audit/findings/visual-${version}.yaml`,
  "audit/screenshots",
];
```

The source manifest must include `artifact_version`, `snapshot_manifest_digest`, the snapshot manifest's sorted `files` map, projected context hash, sorted post-review audit file hashes, `generated_at`, and `source_bundle_digest`. The digest excludes only `generated_at`; it includes all other fields. The context projection uses the union of the two deliverable manifests' reads, so later artifact patches cannot change the bundle.

Implement `verifyDeliverySource(root, manifest)` by recomputing snapshot digest, projected context, and every recorded file hash. Reject paths outside the package and files not listed by the builder.

- [ ] **Step 4: Implement the atomic Director CLI**

`prepare-delivery.mjs` must require `stage=review`, current prototype version, snapshot version >= 3, and both valid review files. Write to `audit/delivery/.tmp-*`, then rename to final paths. `--overwrite` may replace only a source manifest for the same artifact version and must remove its temporary directory on failure.

Add the package script:

```json
"delivery:prepare": "node scripts/prepare-delivery.mjs"
```

- [ ] **Step 5: Run focused tests**

```bash
node --test scripts/test/delivery-source.test.mjs scripts/test/hash.test.mjs
```

Expected: all tests pass, including tampered context, decisions, findings, screenshot, and snapshot cases.

- [ ] **Step 6: Commit source freezing**

```bash
git add package.json scripts/lib/hash.mjs scripts/lib/delivery-source.mjs scripts/prepare-delivery.mjs scripts/test/delivery-source.test.mjs scripts/test/hash.test.mjs
git commit -m "feat: freeze delivery source bundles"
```

### Task 3: Validate Development-Ready Design.md Files

**Files:**

- Create: `scripts/lib/handoff.mjs`
- Create: `scripts/check-handoff.mjs`
- Create: `scripts/test/handoff.test.mjs`
- Modify: `skills/developer-handoff/references/contract.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing handoff closure tests**

The positive fixture must use these machine markers:

```markdown
---
artifact_version: "3"
artifact_revision: 1
source_manifest_digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
source_bundle_digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
platforms: [web]
generated_at: "2026-07-26T12:00:00Z"
---

## 实施概览
技术栈未指定。

## 页面规格
### 首页
- `prototype_path`: `prototype/index.html`

## 设计令牌
- `token`: `semantic.color.primary`

## 资源清单
- `asset_path`: `prototype/assets/logo.png`

## 开发验收用例
### 提交询价
- `flow`: `提交询价`
- `scenario_id`: `inquiry-success`
```

The fixture builder must also include all eleven required H2 sections. Add one mutation test per failure class: missing section, missing page, missing success scenario, missing error scenario, unknown token, missing asset, path traversal, unknown decision ID, digest mismatch, empty section, and placeholder text.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
node --test scripts/test/handoff.test.mjs
```

Expected: FAIL because `scripts/lib/handoff.mjs` does not exist.

- [ ] **Step 3: Implement the parser and cross-file checks**

Export:

```js
export const REQUIRED_HANDOFF_SECTIONS = Object.freeze([
  "实施概览", "信息架构与路由", "页面规格", "状态规格", "响应式与平台适配",
  "组件契约", "设计令牌", "资源清单", "无障碍要求", "开发验收用例", "决策、例外与边界",
]);

```

The same module exports `handoffIssues(root, { sourceManifest, context })`; it returns a deterministic `string[]` sorted by source path and rule order.

Parse frontmatter with `js-yaml`. Parse H2/H3 blocks and backtick markers with anchored regular expressions. Reuse `collectPrototypePages()` and `loadScenarios()`. Flatten token JSON to dot paths. Resolve every `asset_path` against the package root and require it to appear in the frozen snapshot file map. Enumerate image, icon, font, and animation assets under `prototype/assets/` and require each one in the resource inventory. Decision markers must be a subset of `context.decisions[].id`. Placeholder scanning is case-insensitive for `TBD`, `TODO`, `FIXME`, lorem ipsum, and common Chinese placeholder phrases.

- [ ] **Step 4: Add the CLI and Skill contract**

`check-handoff.mjs --package outputs/delivery-artifacts-demo` must verify the source bundle first, emit every issue, and exit `0` only with zero issues. Add:

```json
"delivery:check-handoff": "node scripts/check-handoff.mjs"
```

Update the Skill reference with the eleven exact headings and marker syntax. Require the Skill to run the CLI before proposing its context patch.

- [ ] **Step 5: Run focused tests**

```bash
node --test scripts/test/handoff.test.mjs scripts/test/scenarios.test.mjs
```

Expected: all tests pass; each adversarial mutation returns the named issue rather than a generic parse error.

- [ ] **Step 6: Commit handoff validation**

```bash
git add package.json skills/developer-handoff scripts/lib/handoff.mjs scripts/check-handoff.mjs scripts/test/handoff.test.mjs
git commit -m "feat: validate developer handoff documents"
```

### Task 4: Inspect Native Editable PPTX Structure

**Files:**

- Create: `scripts/lib/presentation.mjs`
- Create: `scripts/check-presentation.mjs`
- Create: `scripts/test/presentation.test.mjs`
- Modify: `skills/design-presentation/references/contract.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install public structured-file dependencies**

```bash
npm install jszip@3.10.1 fast-xml-parser@5.10.1 pptxgenjs@4.0.1
```

Expected: `package.json` and `package-lock.json` record all three dependencies; no private `@oai/artifact-tool` package is added to the repository.

- [ ] **Step 2: Write failing editable-PPTX tests**

Use PptxGenJS only to build deterministic test fixtures. Create one slide per required narrative role:

```js
const REQUIRED_ROLES = ["cover", "problem", "mainline", "system", "core_pages", "value", "boundaries", "next_steps"];
for (const [index, role] of REQUIRED_ROLES.entries()) {
  const slide = pptx.addSlide();
  slide.addText(`${role} title`, { x: 0.7, y: 0.5, w: 8.5, h: 0.5, fontSize: 26 });
  slide.addText(`${role} body`, { x: 0.7, y: 1.3, w: 8.5, h: 2.0, fontSize: 16 });
  slide.addNotes(`[Sources]\n- internal: prototype/index.html@v3`);
  manifest.slides.push({ slide_number: index + 1, narrative_role: role, external_sources: [] });
}
await pptx.writeFile({ fileName: deckPath });
```

Assert the inspector returns exact slide order, stable OOXML IDs, editable text counts, shape/table/image counts, placeholder state, notes text, bounding boxes, and full-slide image coverage. Add adversarial fixtures for: missing role, image-only content slide, empty structural placeholder, absent `[Sources]`, object-count mismatch, undeclared full-bleed image, and out-of-bounds object.

- [ ] **Step 3: Run the test and verify it fails**

```bash
node --test scripts/test/presentation.test.mjs
```

Expected: FAIL because `scripts/lib/presentation.mjs` does not exist.

- [ ] **Step 4: Implement OOXML inspection with structured parsers**

Use JSZip to read the package and `fast-xml-parser` with `ignoreAttributes: false` to parse presentation, relationships, slides, notes, and layouts. Do not validate PPTX by regexing raw XML. Export:

```js
export const REQUIRED_NARRATIVE_ROLES = Object.freeze([
  "cover", "problem", "mainline", "system", "core_pages", "value", "boundaries", "next_steps",
]);
```

The module also exports `inspectPptx(path)`, which returns trusted structural facts from the archive, and `presentationStructureIssues(inspected, manifest)`, which returns a deterministic `string[]`.

The issue function must recompute all counts, require at least one editable title on every slide and two editable text objects on content slides, reject empty placeholders, reject objects beyond the slide canvas, and reject an image covering >= 90% of a content slide unless `allow_full_bleed_background: true` and editable title text remains. It must also compute intersecting content-object pairs from OOXML bounds; only object-ID pairs listed in `allowed_overlaps` with a nonempty reason may be excluded, while background containment is classified separately.

- [ ] **Step 5: Add the structural CLI and contract**

`check-presentation.mjs --package outputs/delivery-artifacts-demo --structure-only` must verify source bundle and PPTX hash, load `audit/presentation/manifest.json`, recompute structure, and exit nonzero on any mismatch. Add:

```json
"delivery:check-presentation": "node scripts/check-presentation.mjs"
```

Update the Skill reference with the eight role IDs, notes contract, editable-object rules, and manifest fields.

- [ ] **Step 6: Run focused tests**

```bash
node --test scripts/test/presentation.test.mjs
```

Expected: all positive and adversarial OOXML cases pass.

- [ ] **Step 7: Commit structural validation**

```bash
git add package.json package-lock.json skills/design-presentation/references/contract.md scripts/lib/presentation.mjs scripts/check-presentation.mjs scripts/test/presentation.test.mjs
git commit -m "feat: inspect editable presentation structure"
```

### Task 5: Probe Rendering And Bind Presentation QA

**Files:**

- Create: `scripts/lib/presentation-render.mjs`
- Create: `scripts/presentation-probe.mjs`
- Create: `scripts/test/presentation-probe.test.mjs`
- Modify: `scripts/check-presentation.mjs`
- Modify: `scripts/env-check.mjs`
- Modify: `skills/design-presentation/references/codex-adapter.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing adapter and QA tests**

Test `resolvePresentationTools()` with injected PATH candidates and test that missing `soffice` or `pdftoppm` returns a specific unavailable capability. Use fake executable scripts for the unit-level positive path so tests do not depend on host applications. Assert `presentationQaIssues()` rejects:

- PPTX SHA mismatch.
- slide/render count mismatch.
- missing render file or render hash mismatch.
- unresolved overlap without an explicit object-pair exception and reason.
- unverified clipping, title-wrap, or font-substitution checks.
- missing or stale `audit/presentation/director-review.json`.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
node --test scripts/test/presentation-probe.test.mjs
```

Expected: FAIL because `scripts/lib/presentation-render.mjs` does not exist.

- [ ] **Step 3: Implement the portable render adapter**

Export `resolvePresentationTools(options)`, `renderPptx(pptxPath, outDir, tools)`, and `presentationQaIssues(root, inspected, qa, directorReview)`. The first returns `{ available, soffice, pdftoppm, error }`; the second returns `{ pdf, renders: [{ slide_number, path, sha256 }] }`; the third returns a deterministic `string[]`.

`renderPptx()` must create a unique temporary directory, run `soffice --headless --convert-to pdf`, run `pdftoppm -png -r 144`, normalize output names to `slide-1.png`, `slide-2.png`, and atomically replace `audit/presentation/rendered/`. Record a SHA-256 for every render. Never silently reuse old renders.

- [ ] **Step 4: Implement the real editable probe**

`presentation-probe.mjs` must create one PptxGenJS slide containing editable title/body/shape objects, inspect the resulting OOXML, render it, and verify that exactly one PNG exists. It exits `3` when render tools are unavailable and `1` when generation, reread, or render fails.

Add:

```json
"presentation:probe": "node scripts/presentation-probe.mjs"
```

Update `checkEnvironment()` with:

```js
presentation: {
  generation: true,
  reread: true,
  rendering: true,
  method: "pptxgenjs+ooxml+soffice+pdftoppm",
},
presentation_degraded: false,
```

Do not fold `presentation_degraded` into browser `degraded`; acceptance decides whether presentation capability is required for the current package.

- [ ] **Step 5: Require Director-owned visual QA evidence**

Extend `check-presentation.mjs` so full mode renders the final deck and writes trusted structural facts and render hashes to `audit/presentation/qa.json`. It exits `3` until the Director writes `audit/presentation/director-review.json` after inspecting every final render. The check command never creates or edits this Director-owned file. For the eight-slide fixture, its exact shape is:

```json
{
  "completed": true,
  "pptx_sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "reviewed_slide_numbers": [1, 2, 3, 4, 5, 6, 7, 8],
  "findings": []
}
```

The command must reject partial slide lists and a review bound to an older PPTX hash.

- [ ] **Step 6: Run focused and real environment probes**

```bash
node --test scripts/test/presentation-probe.test.mjs scripts/test/presentation.test.mjs
npm run presentation:probe
npm run env:check
```

Expected on the current machine: focused tests pass; the probe creates, rereads, and renders one editable slide; `env:check` reports browser and presentation automation available.

- [ ] **Step 7: Commit rendering and QA**

```bash
git add package.json skills/design-presentation/references/codex-adapter.md scripts/lib/presentation-render.mjs scripts/presentation-probe.mjs scripts/check-presentation.mjs scripts/env-check.mjs scripts/test/presentation-probe.test.mjs
git commit -m "feat: verify presentation rendering and qa"
```

### Task 6: Enforce Delivery Gates Before `delivered`

**Files:**

- Create: `scripts/test/delivery-acceptance.test.mjs`
- Modify: `scripts/lib/delivery.mjs`
- Modify: `scripts/snapshot.mjs`
- Modify: `scripts/acceptance.mjs`
- Modify: `scripts/director-advance.mjs`
- Modify: `skills/design-director/SKILL.md`

- [ ] **Step 1: Write failing acceptance policy tests**

Build pure gate fixtures around a new `scripts/lib/delivery.mjs` export `deliveryAcceptance(root, ctx, { snapshotVersion, environment })`. Assert:

```js
assert.deepEqual(deliveryAcceptance(v2Root, professionalCtx, { snapshotVersion: 2, environment }).map((x) => x.status), ["pass", "pass"]);
assert.deepEqual(deliveryAcceptance(v3RootMissing, professionalCtx, { snapshotVersion: 3, environment }).map((x) => x.status), ["fail", "fail"]);
assert.deepEqual(deliveryAcceptance(v3QuickEmpty, quickCtx, { snapshotVersion: 3, environment }).map((x) => x.status), ["pass", "pass"]);
assert.equal(deliveryAcceptance(v3QuickHandoff, quickHandoffCtx, { snapshotVersion: 3, environment })[0].status, "fail");
```

Add a CLI test proving `director-advance.mjs --stage delivered` leaves `context.yaml` at `review` when full acceptance exits `1` or `3`.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test scripts/test/delivery-acceptance.test.mjs
```

Expected: FAIL because delivery gates are not exported or wired.

- [ ] **Step 3: Mark new snapshots and add acceptance dimensions**

Change `snapshot_version` from `2` to `3` in `snapshot.mjs`. In `acceptance.mjs`, call `deliveryModeIssues(ctx, { enforce: snapshotVersion >= 3 })`, verify the source bundle, and append exactly two dimensions:

```js
add("开发交接文档", handoff.status, handoff.detail);
add("设计方案演示", presentation.status, presentation.detail);
```

For v1/v2 snapshots, return pass with a migration message and do not invalidate historical delivery. For v3 professional packages, both outputs are mandatory. For quick packages, only `project.delivery_outputs` entries are evaluated. A missing presentation adapter yields `unverified`, not `pass`.

Replace the current unconditional `missingProduced` calculation in the `结构稳定` gate: flow Skill products remain unconditional, while deliverable Skill products are included only when their canonical ID is returned by `requiredDeliveryOutputs(ctx)`. This is required so a v3 quick package with no requested delivery output remains valid.

- [ ] **Step 4: Gate the final stage transition**

Before writing `stage: delivered`, `director-advance.mjs` must synchronously execute `node scripts/acceptance.mjs --package outputs/delivery-artifacts-demo` with the actual package argument supplied to the Director. On exit `1`, `2`, or `3`, print the acceptance output, leave context untouched, and exit with the same status. Do not add a bypass flag.

Update the Director Skill sequence with: prepare source bundle, dispatch both deliverables in fresh sessions, run focused checks, inspect every final slide, apply artifact patches, run full acceptance, then advance.

- [ ] **Step 5: Run focused acceptance tests**

```bash
node --test scripts/test/delivery-acceptance.test.mjs scripts/test/snapshot-cli.test.mjs scripts/test/gates.test.mjs
```

Expected: all tests pass; v2 migration fixtures remain valid and v3 bypasses fail.

- [ ] **Step 6: Commit delivery enforcement**

```bash
git add scripts/snapshot.mjs scripts/acceptance.mjs scripts/director-advance.mjs skills/design-director/SKILL.md scripts/test/delivery-acceptance.test.mjs scripts/test/snapshot-cli.test.mjs scripts/test/gates.test.mjs
git commit -m "feat: enforce final delivery artifacts"
```

### Task 7: Update User And Maintainer Documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/usage.md`
- Modify: `docs/development.md`
- Modify: `docs/superpowers/specs/2026-07-24-design-agent-system-design.md`
- Modify: `docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md`

- [ ] **Step 1: Add documentation assertions to the delivery contract test**

Add a test in `scripts/test/delivery-contracts.test.mjs` so `README.md` and `docs/development.md` cannot retain literal claims of 8 total entries without also naming the 2 deliverable Skills. Read the delivery tree in `docs/usage.md` and assert it contains `Design.md`, `presentation/design-system.pptx`, and `audit/delivery/source-manifest.json`.

- [ ] **Step 2: Run the focused test and verify stale docs fail**

```bash
node --test scripts/test/delivery-contracts.test.mjs
```

Expected: FAIL because the current documentation lacks the new files and counts.

- [ ] **Step 3: Update the workflow, commands, environment, and migration docs**

Document:

- 5 flow Skills, 2 deliverable Skills, 2 reviewers, and 1 Director.
- professional mandatory vs quick opt-in behavior.
- `delivery:prepare`, `delivery:check-handoff`, `delivery:check-presentation`, and `presentation:probe` commands.
- the new delivery-package tree and source/QA manifests.
- LibreOffice/Poppler or equivalent presentation adapter requirements.
- snapshot v3 migration semantics.
- the superseding note for the original “PPT excluded from v1” statement.

Set the July 26 specification status to `已确认，实施完成` only after Task 8 passes.

- [ ] **Step 4: Run documentation and system checks**

```bash
node --test scripts/test/delivery-contracts.test.mjs
npm run check
git diff --check
```

Expected: tests and system validation pass; no stale role counts or whitespace errors remain.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs skills/design-director/SKILL.md scripts/test/delivery-contracts.test.mjs
git commit -m "docs: document delivery artifact workflow"
```

### Task 8: Prove The Workflow End To End

**Files:**

- Create in ignored output: `outputs/delivery-artifacts-demo/Design.md`
- Create in ignored output: `outputs/delivery-artifacts-demo/presentation/design-system.pptx`
- Create in ignored output: `outputs/delivery-artifacts-demo/audit/delivery/source-manifest.json`
- Create in ignored output: `outputs/delivery-artifacts-demo/audit/presentation/manifest.json`
- Create in ignored output: `outputs/delivery-artifacts-demo/audit/presentation/qa.json`
- Create in ignored output: `outputs/delivery-artifacts-demo/audit/presentation/director-review.json`
- Modify if a regression is found: the smallest owning runtime/test file only.

- [ ] **Step 1: Run the complete automated suite before the demo**

```bash
npm run check
npm test
npm run validate:rules
npm run recall -- --out /tmp/beansmile-design-delivery-recall.json
npm run env:check
```

Expected: check/test/rules/recall exit `0`; environment reports real browser and presentation probes available. Stop and fix any regression before generating the demo.

- [ ] **Step 2: Create a fresh professional demo package**

Initialize `outputs/delivery-artifacts-demo` with both outputs and a small Web/mobile-Web project. Run the normal research, UX, visual, prototype, browser, snapshot v3, and two-review path; do not fabricate a delivered context or copy old verdicts. The package must include one success and one error scenario, at least two screenshot iteration rounds, and zero blockers.

```bash
npm run init -- --package outputs/delivery-artifacts-demo --name "Delivery Artifacts Demo" --mode professional --task-type new_design --platforms web,mobile_web --primary-user "评估设计交付完整性的开发负责人" --industry general --reference-system none
```

Expected: `context.project.delivery_outputs` contains both canonical IDs.

- [ ] **Step 3: Generate and validate Design.md**

```bash
npm run delivery:prepare -- --package outputs/delivery-artifacts-demo
npm run delivery:check-handoff -- --package outputs/delivery-artifacts-demo
```

Expected: source bundle verifies and all eleven handoff sections close against actual demo pages, scenarios, tokens, assets, and decisions.

- [ ] **Step 4: Generate the editable PPTX through the Presentations skill**

Use `skills/design-presentation/SKILL.md` plus the Codex adapter. Build the deck with `@oai/artifact-tool`, not PptxGenJS, because this is the production Codex path. Render every slide, inspect every slide individually, add Director review evidence, and rerun:

```bash
npm run delivery:check-presentation -- --package outputs/delivery-artifacts-demo
```

Expected: the deck covers all eight narrative roles, contains editable text/shapes/tables, has no image-only content slides, has complete `[Sources]` notes, and all structural/render/Director QA checks pass.

- [ ] **Step 5: Apply artifact patches and prove final-stage enforcement**

Apply the two Skill patches through `npm run apply`, then run:

```bash
npm run accept -- --package outputs/delivery-artifacts-demo
node scripts/director-advance.mjs --package outputs/delivery-artifacts-demo --stage delivered
```

Expected: acceptance prints PASS for `开发交接文档` and `设计方案演示`; Director advances `review -> delivered` only after that exit `0`.

- [ ] **Step 6: Run adversarial end-to-end probes**

On copies of the demo package, verify each mutation fails: edit `Design.md` after patching context; replace a content slide with a full-page PNG; remove one render; change source-manifest digest; request PPT in quick mode then delete it. Preserve the original passing package.

- [ ] **Step 7: Mark the spec complete and rerun final verification**

Update the July 26 spec status to `已确认，实施完成`, then run:

```bash
git diff --check
npm run check
npm test
npm run validate:rules
npm run recall -- --out /tmp/beansmile-design-delivery-recall-final.json
npm run env:check
```

Expected: no whitespace errors; all repository tests pass; rule validation and recall pass; environment probes prove browser and presentation automation.

- [ ] **Step 8: Commit the final verification update**

```bash
git add docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md
git commit -m "docs: mark delivery artifacts implemented"
```
