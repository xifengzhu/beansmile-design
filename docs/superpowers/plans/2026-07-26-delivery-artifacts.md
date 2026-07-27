# Design-First Delivery Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and seal `Design.md` before visual/prototype creation, bind every downstream design artifact to that contract, finalize the same document for development after review, and generate an editable audited design-proposal PPTX.

**Architecture:** Keep `intake -> research -> ux -> visual -> prototype -> review -> delivered` unchanged. A two-operation `design_specification` Skill owns one `Design.md`: `prepare` creates a proposed contract after UX, the Director seals it after the user's flow confirmation, Visual and Prototype bind its digest, and `finalize` appends implementation facts without changing the locked contract. A separate `design_presentation` Skill consumes only the finalized document and reviewed snapshot; deterministic Node gates enforce ordering, hashes, closure, rollback, editable PPTX structure, rendering QA, and historical migration semantics.

**Tech Stack:** Node.js 18 ESM, `node:test`, AJV, js-yaml, `mdast-util-from-markdown`, JSZip, fast-xml-parser, PptxGenJS for deterministic fixtures/probes only, LibreOffice `soffice`, Poppler `pdftoppm`, existing Playwright/axe, snapshot, rule-pack, and hash helpers.

---

## File Map

New focused runtime modules:

- `scripts/lib/delivery.mjs`: requested-output semantics, package-format migration, and shared delivery artifact binding checks.
- `scripts/lib/design-source.mjs`: deterministic pre-design source bundle and post-review delivery source bundle creation/verification.
- `scripts/lib/design-document.mjs`: structured Markdown parsing, locked-section digesting, phase-specific closure, and final handoff validation.
- `scripts/lib/design-contract.mjs`: provisional patch validation, Director sealing, contract-lock validation, and downstream binding checks.
- `scripts/lib/design-revision.mjs`: audited contract rollback and stale-artifact calculation.
- `scripts/lib/presentation.mjs`: structured PPTX OOXML inspection and editable-object contract checks.
- `scripts/lib/presentation-render.mjs`: presentation tool discovery, rendering, and render/Director-QA validation.

New Director and validation CLIs:

- `scripts/prepare-design-contract.mjs`: freeze `audit/design/contract-source.json`, projected context, and applicable rule bundle before `Design.md` generation.
- `scripts/check-design-document.mjs`: validate `proposed_contract`, `approved_contract`, or `implementation_ready` documents.
- `scripts/revise-design-contract.mjs`: controlled rollback to UX while preserving old evidence.
- `scripts/prepare-delivery.mjs`: freeze post-review inputs for `design_specification finalize`.
- `scripts/check-presentation.mjs`: validate PPTX structure, rendering QA, and Director review evidence.
- `scripts/presentation-probe.mjs`: create, reread, and render a minimal editable PPTX.

New schemas:

- `schemas/design-contract-source.schema.json`
- `schemas/design-contract-lock.schema.json`
- `schemas/delivery-source.schema.json`

New Skills:

- `skills/design-specification/SKILL.md`
- `skills/design-specification/references/contract.md`
- `skills/design-presentation/SKILL.md`
- `skills/design-presentation/references/contract.md`
- `skills/design-presentation/references/codex-adapter.md`

New tests:

- `scripts/test/delivery-contracts.test.mjs`
- `scripts/test/design-source.test.mjs`
- `scripts/test/design-document.test.mjs`
- `scripts/test/design-contract.test.mjs`
- `scripts/test/design-revision.test.mjs`
- `scripts/test/delivery-source.test.mjs`
- `scripts/test/presentation.test.mjs`
- `scripts/test/presentation-probe.test.mjs`
- `scripts/test/delivery-acceptance.test.mjs`
- `scripts/test/documentation-contract.test.mjs`

Existing files changed by ownership:

- Registry and manifests: `skills/registry.yaml`, `schemas/skill-manifests.yaml`, `schemas/skill-manifest.schema.json`, `scripts/lib/manifests.mjs`, `scripts/lib/registry.mjs`, `scripts/validate-system.mjs`.
- Context and Director: `schemas/context.schema.json`, `scripts/lib/context.mjs`, `scripts/init-project.mjs`, `scripts/project-context.mjs`, `scripts/check-diff-gate.mjs`, `scripts/apply-patch.mjs`, `scripts/director-advance.mjs`.
- Design consumers: `skills/visual-system/SKILL.md`, `skills/html-prototype/SKILL.md`.
- Review and acceptance: `scripts/snapshot.mjs`, `scripts/acceptance.mjs`, `skills/design-director/SKILL.md`.
- Presentation environment: `scripts/env-check.mjs`, `package.json`, `package-lock.json`.
- Documentation: `README.md`, `docs/usage.md`, `docs/development.md`, `docs/superpowers/specs/2026-07-24-design-agent-system-design.md`, and `docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md`.

Task order is deliberate. Tasks 1-4 make the pre-design contract real and fail-closed before any final-delivery work. Tasks 5-6 freeze reviewed inputs and turn the same document into a development handoff. Tasks 7-8 retain the editable PPTX work. Task 9 connects all three acceptance dimensions and migration behavior. Tasks 10-11 document and prove the complete workflow.

### Task 1: Register Operation-Aware Delivery Skills And Context Fields

> Before editing either new Skill, invoke `skill-creator` and `superpowers:writing-skills` and follow their validation requirements.

**Files:**

- Create: `scripts/lib/delivery.mjs`
- Create: `scripts/test/delivery-contracts.test.mjs`
- Create: `skills/design-specification/SKILL.md`
- Create: `skills/design-specification/references/contract.md`
- Create: `skills/design-presentation/SKILL.md`
- Create: `skills/design-presentation/references/contract.md`
- Create: `skills/design-presentation/references/codex-adapter.md`
- Modify: `skills/requirements-research/SKILL.md`
- Modify: `skills/registry.yaml`
- Modify: `schemas/skill-manifests.yaml`
- Modify: `schemas/skill-manifest.schema.json`
- Modify: `schemas/context.schema.json`
- Modify: `scripts/lib/manifests.mjs`
- Modify: `scripts/lib/registry.mjs`
- Modify: `scripts/validate-system.mjs`
- Modify: `scripts/init-project.mjs`
- Modify: `scripts/project-context.mjs`
- Modify: `scripts/check-diff-gate.mjs`
- Modify: `scripts/apply-patch.mjs`
- Test: `scripts/test/project-context.test.mjs`
- Test: `scripts/test/gates.test.mjs`

- [ ] **Step 1: Write failing delivery-mode and operation-manifest tests**

Create `scripts/test/delivery-contracts.test.mjs` with these core assertions:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { requiredDeliveryOutputs, deliveryModeIssues, deliveryArtifactVersionIssues } from "../lib/delivery.mjs";
import { loadManifests, resolveManifest } from "../lib/manifests.mjs";
import { loadRegistry, validateRegistry } from "../lib/registry.mjs";

const BOTH = ["design_specification", "design_presentation"];

test("professional mode requires Design.md lifecycle and presentation", () => {
  const ctx = { project: { mode: "professional", package_format_version: 3, delivery_outputs: BOTH } };
  assert.deepEqual(requiredDeliveryOutputs(ctx), BOTH);
  assert.deepEqual(deliveryModeIssues(ctx, { enforce: true }), []);
  assert.match(deliveryModeIssues({ project: { mode: "professional", package_format_version: 3, delivery_outputs: [] } }, { enforce: true })[0], /缺少/);
});

test("quick presentation implies design specification", () => {
  const ctx = { project: { mode: "quick", package_format_version: 3, delivery_outputs: ["design_presentation"] } };
  assert.deepEqual(requiredDeliveryOutputs(ctx), BOTH);
});

test("design specification resolves operation-specific reads", () => {
  const prepare = resolveManifest("design_specification", "prepare");
  const finalize = resolveManifest("design_specification", "finalize");
  assert.ok(prepare.reads.includes("artifacts.brief"));
  assert.ok(!prepare.reads.includes("artifacts.prototype"));
  assert.ok(finalize.reads.includes("artifacts.prototype"));
  assert.deepEqual(prepare.writes, ["artifacts.design_document"]);
  assert.throws(() => resolveManifest("design_specification"), /--operation/);
  assert.throws(() => resolveManifest("visual_system", "prepare"), /不支持 operation/);
});

test("registry maps flow and deliverable ids to manifests", () => {
  const registry = loadRegistry();
  assert.ok(resolveManifest("requirements_research").writes.includes("artifacts.brief"));
  assert.equal(registry.byId.get("design_specification").kind, "deliverable");
  assert.equal(registry.byId.get("design_presentation").kind, "deliverable");
  assert.equal(validateRegistry().ok, true);
  assert.equal(loadManifests().manifests.length, 7);
});

test("delivery artifacts use independent monotonic version semantics", () => {
  assert.deepEqual(deliveryArtifactVersionIssues(null, { artifact_version: "1" }, { kind: "design_document" }), []);
  assert.deepEqual(deliveryArtifactVersionIssues({ artifact_version: "1" }, { artifact_version: "2" }, { kind: "design_document" }), []);
  assert.match(deliveryArtifactVersionIssues({ artifact_version: "1" }, { artifact_version: "3" }, { kind: "design_document" })[0], /artifact_version/);
  assert.deepEqual(deliveryArtifactVersionIssues(null, { artifact_version: "3", artifact_revision: 1 }, { kind: "presentation", prototypeVersion: "3" }), []);
  assert.deepEqual(deliveryArtifactVersionIssues({ artifact_version: "3", artifact_revision: 1 }, { artifact_version: "3", artifact_revision: 2 }, { kind: "presentation", prototypeVersion: "3" }), []);
  assert.match(deliveryArtifactVersionIssues({ artifact_version: "3", artifact_revision: 1 }, { artifact_version: "3", artifact_revision: 1 }, { kind: "presentation", prototypeVersion: "3" })[0], /artifact_revision/);
});
```

Extend `scripts/test/project-context.test.mjs` to prove `--operation prepare|finalize` returns different projections. Extend `scripts/test/gates.test.mjs` so missing/unknown operations and writes outside `artifacts.design_document` fail.

- [ ] **Step 2: Run focused tests and confirm the missing contracts fail**

```bash
node --test scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/delivery.mjs` or missing `design_specification` registry/manifest entries.

- [ ] **Step 3: Implement exact output semantics**

Create `scripts/lib/delivery.mjs`:

```js
export const DELIVERY_OUTPUTS = Object.freeze(["design_specification", "design_presentation"]);
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
  const duplicate = requested.filter((id, i) => requested.indexOf(id) !== i);
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
      : [`design_document artifact_version 必须从 ${previous} 递增到 ${previous + 1}`];
  }
  if (kind === "presentation") {
    const revision = next?.artifact_revision;
    const expectedRevision = before?.artifact_version === prototypeVersion
      ? before.artifact_revision + 1
      : 1;
    return next?.artifact_version === prototypeVersion && revision === expectedRevision
      ? []
      : [`presentation 必须绑定 prototype ${prototypeVersion} 且 artifact_revision=${expectedRevision}`];
  }
  return [`未知 delivery artifact kind: ${kind}`];
}
```

- [ ] **Step 4: Add operation-aware schema and manifest resolution**

Represent the new manifest exactly as:

```yaml
  - skill: design_specification
    operations:
      prepare:
        reads: [project, users, goals, brand, constraints, assumptions, decisions, exceptions, artifacts.brief, artifacts.flows]
        writes: [artifacts.design_document]
      finalize:
        reads: [project, users, goals, brand, constraints, assumptions, decisions, exceptions, artifacts.brief, artifacts.flows, artifacts.tokens, artifacts.prototype, artifacts.design_document]
        writes: [artifacts.design_document]
    produces: [Design.md]
    required_modes: [professional]

  - skill: design_presentation
    reads: [project, users, goals, brand, constraints, assumptions, decisions, exceptions, artifacts.flows, artifacts.tokens, artifacts.prototype, artifacts.design_document]
    writes: [artifacts.presentation]
    produces: [presentation/design-system.pptx, audit/presentation/manifest.json, audit/presentation/qa.json]
    required_modes: [professional]
```

Add `resolveManifest(skill, operation)` in `scripts/lib/manifests.mjs`. It returns a flattened `{ skill, operation, reads, writes, produces, required_modes }`; a manifest with `operations` requires a valid operation, while a normal manifest rejects an operation. Update all three CLIs to accept `--operation`, use `resolveManifest`, and print the operation in projection/diff/apply output.

Change `validateRegistry()` so both `kind: flow` and `kind: deliverable` are patch-capable IDs that require exactly one manifest, while reviewers and the Director must not have manifests. Continue checking every registered Skill directory and reject duplicate registry IDs or manifest IDs.

Add `artifacts.brief` to `requirements_research.writes`. New package Research patches must register `{ path: "brief.md", artifact_version: "1", updated_by: "requirements_research" }`; its Skill contract must require this artifact patch. Version-3 Design source preparation fails when that registration or file hash is absent. Historical packages remain accepted through package-version migration logic rather than weakening new-source validation.

- [ ] **Step 5: Extend context schema and initialization**

Add optional `project.package_format_version` (`integer`, minimum `1`) and `project.delivery_outputs` (unique enum array). Add artifact fields with `additionalProperties: false` preserved:

```json
{
  "phase": { "enum": ["proposed_contract", "approved_contract", "implementation_ready", "stale"] },
  "artifact_revision": { "type": "integer", "minimum": 1 },
  "contract_revision": { "type": "integer", "minimum": 1 },
  "contract_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "contract_source_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "design_contract_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "contract_lock_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "source_manifest_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "source_bundle_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "design_document_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
  "realizes_prototype_version": { "type": "string" },
  "stale": { "type": "boolean" },
  "stale_reason": { "type": "string" },
  "superseded_contract_revision": { "type": "integer", "minimum": 1 }
}
```

Change `confirmations.flows` from the generic ref to a schema requiring `summary`, `user_reply`, `flows_sha256`, `design_contract_digest`, and `contract_lock_sha256` only when the package requires Design.md; keep older packages compatible in acceptance. New professional packages initialize `package_format_version: 3` and both outputs. New quick packages initialize version `3`, accept `--deliverables`, make presentation imply Design.md, and reject unknown/duplicate values before creating directories.

Call `deliveryArtifactVersionIssues()` from the hardened patch gate for `design_specification` and `design_presentation`. Seal registers the initial Design.md at version `1` without a second increment; `finalize` and later valid document rewrites increment it by exactly one. Presentation uses the current prototype version as `artifact_version`; first generation starts `artifact_revision: 1`, same-prototype regeneration increments by exactly one, and a new prototype version restarts presentation revision at `1`.

- [ ] **Step 6: Register complete Skill entrypoints**

Register both `kind: deliverable` entries. Update `requirements-research/SKILL.md` to return the new `artifacts.brief` registration with its existing Research patch. `design-specification/SKILL.md` must define two invocations, prohibit direct stage/context/source changes, require a fresh session for each operation, and require `check-design-document.mjs` before returning a patch. `prepare` writes `phase: proposed_contract`; `finalize` writes `phase: implementation_ready` and aborts if the first-part digest changes. `design-presentation` must accept only an implementation-ready Design.md and forbid production use of PptxGenJS, python-pptx, PDF wrapping, or image-only content slides.

- [ ] **Step 7: Run focused and static validation**

```bash
node --test scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
npm run check
```

Expected: all tests pass; system validation reports 7 patch-capable manifests and 10 registry entries.

- [ ] **Step 8: Commit the registry/context slice**

```bash
git add package.json skills schemas scripts/lib/delivery.mjs scripts/lib/manifests.mjs scripts/lib/registry.mjs scripts/validate-system.mjs scripts/init-project.mjs scripts/project-context.mjs scripts/check-diff-gate.mjs scripts/apply-patch.mjs scripts/test/delivery-contracts.test.mjs scripts/test/project-context.test.mjs scripts/test/gates.test.mjs
git commit -m "feat: register design delivery lifecycle"
```

### Task 2: Freeze And Validate The Proposed Design Contract

**Files:**

- Create: `schemas/design-contract-source.schema.json`
- Create: `scripts/lib/design-source.mjs`
- Create: `scripts/lib/design-document.mjs`
- Create: `scripts/prepare-design-contract.mjs`
- Create: `scripts/check-design-document.mjs`
- Create: `scripts/test/design-source.test.mjs`
- Create: `scripts/test/design-document.test.mjs`
- Modify: `scripts/lib/hash.mjs`
- Modify: `scripts/lib/paths.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the structured Markdown parser**

```bash
npm install mdast-util-from-markdown@2.0.2
```

Expected: `package.json` and `package-lock.json` record `mdast-util-from-markdown`; no regex-only Markdown parser dependency is introduced.

- [ ] **Step 2: Write failing source-bundle tests**

Build a temporary `stage: ux` package containing `brief.md`, `flows.md`, `decisions.md`, a valid context, and applicable rules. Assert deterministic generation and fail-closed drift:

```js
const first = buildContractSource(root, { contractRevision: 1 });
const second = buildContractSource(root, { contractRevision: 1 });
assert.equal(first.contract_source_digest, second.contract_source_digest);
assert.deepEqual(verifyContractSource(root, first), []);
writeFileSync(join(root, "flows.md"), "changed after freeze");
assert.match(verifyContractSource(root, first)[0], /flows\.md/);
```

Add CLI cases: wrong stage, missing brief/flows, active non-stale tokens/prototype, existing manifest without `--overwrite`, invalid reference system, and interrupted write must leave no `.tmp-*` directory.

- [ ] **Step 3: Write failing proposed-document tests**

The positive fixture uses stable markers:

```markdown
---
phase: proposed_contract
artifact_version: "1"
contract_revision: 1
contract_digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
contract_source_digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
platforms: [web]
generated_at: "2026-07-27T00:00:00Z"
---

# 第一部分：设计契约
## 目标与边界
技术栈未指定。
## 用户、任务与成功标准
- `flow`: `提交询价`
## 信息架构与路由
### 首页
- `page_id`: `home`
- `route`: `/`
## 页面规格
### 首页
- `page_id`: `home`
## 状态规格
- `page_id`: `home`
- `states`: `normal,loading,empty,error,success,disabled,focus`
```

The builder must include all eleven locked H2 headings from the specification. Add one mutation per failure: missing heading, duplicate heading, second implementation section present, flow absent from `flows.md`, missing page, unknown page, missing state, `TBD`, `TODO`, lorem ipsum, invented token value, invented asset path, invalid phase, digest mismatch, and source drift.

- [ ] **Step 4: Run tests and confirm missing modules fail**

```bash
node --test scripts/test/design-source.test.mjs scripts/test/design-document.test.mjs
```

Expected: FAIL because `scripts/lib/design-source.mjs` and `scripts/lib/design-document.mjs` do not exist.

- [ ] **Step 5: Implement canonical source generation**

Add `canonicalDigest(value)` to `scripts/lib/hash.mjs` by recursively sorting object keys before hashing JSON. `buildContractSource()` must atomically write:

```text
audit/design/context.yaml
audit/design/rules.yaml
audit/design/contract-source.json
```

The manifest records `source_version`, `contract_revision`, sorted file hashes for `brief.md`, `flows.md`, optional `decisions.md`, the projected context, and frozen rules. Its `contract_source_digest` excludes only `generated_at`. `verifyContractSource()` recalculates every file hash and rejects paths outside the package. Initial prepare requires no registered downstream artifacts; after controlled rollback it permits only artifacts explicitly marked stale by the matching revision record.

- [ ] **Step 6: Implement structured document parsing and contract digesting**

Export these exact contracts from `scripts/lib/design-document.mjs`:

```js
export const LOCKED_SECTIONS = Object.freeze([
  "目标与边界", "用户、任务与成功标准", "信息架构与路由", "页面规格", "状态规格",
  "响应式与平台适配", "组件与内容约束", "视觉目标与品牌约束", "内容与资源需求",
  "无障碍与开发验收", "决策、假设、例外与边界",
]);
```

Export `parseDesignDocument(markdown)` returning `{ frontmatter, tree, lockedNodes, implementationNodes }`; `designContractDigest(parsed)` returning the lowercase 64-character SHA-256 of canonical locked nodes; `proposedContractIssues(root, parsed, sourceManifest)` returning a deterministic `string[]`; and `implementationReadyIssues(root, parsed, sourceManifest, context)` with the same return type. Task 2 implements parsing, digesting, and proposed-phase checks. Task 6 completes the final-phase branch without changing these signatures.

Use `mdast-util-from-markdown` for headings/nodes and js-yaml for frontmatter. Remove only mdast `position` fields before digesting; retain node type, depth, value, URL, inline code, and child order. Parse machine markers from `inlineCode` nodes and their list item, not from arbitrary substring matches.

- [ ] **Step 7: Add Director and validator CLIs**

`prepare-design-contract.mjs --package <dir> [--overwrite]` validates context and writes all three source files atomically. `check-design-document.mjs --package <dir> --phase proposed_contract` verifies source drift first, prints every issue, and exits `0` only when none remain. Add:

```json
"design:prepare-source": "node scripts/prepare-design-contract.mjs",
"design:check": "node scripts/check-design-document.mjs"
```

- [ ] **Step 8: Run focused tests**

```bash
node --test scripts/test/design-source.test.mjs scripts/test/design-document.test.mjs scripts/test/hash.test.mjs
```

Expected: all deterministic source, structured Markdown, closure, placeholder, and drift tests pass.

- [ ] **Step 9: Commit pre-design generation support**

```bash
git add package.json package-lock.json schemas/design-contract-source.schema.json scripts/lib/hash.mjs scripts/lib/paths.mjs scripts/lib/design-source.mjs scripts/lib/design-document.mjs scripts/prepare-design-contract.mjs scripts/check-design-document.mjs scripts/test/design-source.test.mjs scripts/test/design-document.test.mjs
git commit -m "feat: validate pre-design contracts"
```

### Task 3: Seal The User-Confirmed Contract And Bind Visual/Prototype Work

**Files:**

- Create: `schemas/design-contract-lock.schema.json`
- Create: `scripts/lib/design-contract.mjs`
- Create: `scripts/test/design-contract.test.mjs`
- Modify: `schemas/context.schema.json`
- Modify: `scripts/director-advance.mjs`
- Modify: `scripts/lib/context.mjs`
- Modify: `scripts/apply-patch.mjs`
- Modify: `schemas/skill-manifests.yaml`
- Modify: `skills/visual-system/SKILL.md`
- Modify: `skills/html-prototype/SKILL.md`
- Test: `scripts/test/gates.test.mjs`
- Test: `scripts/test/project-context.test.mjs`

- [ ] **Step 1: Write failing seal and lock tests**

Create a valid proposed Design.md and provisional patch, then assert:

```js
const result = sealDesignContract(root, ctx, {
  summary: "确认页面、流程与设计契约",
  userReply: "确认",
  provisionalPatch,
  now: "2026-07-27T00:00:00Z",
});
assert.equal(result.context.artifacts.design_document.phase, "approved_contract");
assert.equal(result.context.confirmations.flows.design_contract_digest, result.lock.contract_digest);
assert.equal(result.lock.downstream_absent, true);
assert.equal(designContractDigest(parseDesignDocument(result.markdown)), result.lock.contract_digest);
```

Add rejection tests for missing user reply, non-proposed phase, invalid provisional patch, source drift, contract body mutation during seal, existing active tokens/prototype/snapshot/findings, wrong stage, stale old lock, and any failure leaving Design.md/context/lock unchanged.

- [ ] **Step 2: Write failing downstream patch tests**

Update `visual_system` and `html_prototype` fixtures so valid artifact entries contain:

```js
{
  path: "design-tokens.json",
  artifact_version: "1",
  design_contract_digest: contractDigest,
  contract_lock_sha256: lockSha,
  updated_by: "visual_system",
}
```

Assert missing digest, old digest, old lock, stale Design.md, or a Design.md not in `approved_contract` blocks both patch application and stage transition.

- [ ] **Step 3: Run focused tests and verify failures**

```bash
node --test scripts/test/design-contract.test.mjs scripts/test/gates.test.mjs scripts/test/project-context.test.mjs
```

Expected: FAIL because seal/lock and downstream binding logic do not exist.

- [ ] **Step 4: Implement deterministic sealing**

`sealDesignContract()` must:

1. Verify the proposed document, source manifest, and provisional patch through `resolveManifest("design_specification", "prepare")` and `hardenedGate` without writing context.
2. Require `stage: ux`, no active downstream artifact registrations, and no current snapshot/findings.
3. Recompute the locked digest before and after changing only frontmatter `phase` to `approved_contract` and adding `approved_at`.
4. Create `confirmations.flows` with the user reply, `flows_sha256`, contract digest, and lock SHA.
5. Create a lock containing `lock_version`, contract/source digests, Design.md and flows hashes, confirmation digest, `sealed_at_stage: ux`, `transition_target: visual`, `downstream_absent: true`, and `lock_digest`. Compute `lock_digest` from the canonical payload excluding `lock_digest`; compute `contract_lock_sha256` from the final serialized lock bytes, so neither hash is self-referential.
6. Write Design.md, `audit/design/contract-lock.json`, and context through temporary files; keep old bytes and restore them if any rename/write fails. Write context last.

The Director owns only the mechanical frontmatter/lock/context update; it cannot edit locked Markdown nodes.

- [ ] **Step 5: Wire seal into the flow confirmation command**

Extend the existing command:

```bash
node scripts/director-advance.mjs --package <dir> --confirm flows \
  --summary <summary> --reply <user-reply> --design-patch <provisional-patch.yaml>
```

For version-3 packages requiring Design.md, `--design-patch` is mandatory and `--confirm flows` invokes sealing. Older packages keep existing confirmation behavior. Do not introduce a second user confirmation gate.

- [ ] **Step 6: Enforce the contract at Visual and Prototype boundaries**

Add `artifacts.design_document` to both consumer manifests. `checkDesignContractBinding(root, ctx, artifact)` verifies the lock schema/hash, current approved document hash/digest, confirmation binding, and artifact digest fields. Pass `packageRoot` into `hardenedGate` from `apply-patch.mjs`; the gate checks the binding whenever Visual or Prototype writes its artifact. Quick mode requesting Design.md must pass the same lock before its first `-> prototype` transition.

Update both Skills to read `Design.md` and the lock before creation. Visual records the binding on tokens; Prototype records it on prototype and rejects tokens bound to another contract.

- [ ] **Step 7: Run focused tests**

```bash
node --test scripts/test/design-contract.test.mjs scripts/test/gates.test.mjs scripts/test/project-context.test.mjs
npm run check
```

Expected: sealing is atomic, user-audited, and ordered; all old/new gate tests pass.

- [ ] **Step 8: Commit the pre-design enforcement slice**

```bash
git add schemas/design-contract-lock.schema.json schemas/context.schema.json schemas/skill-manifests.yaml scripts/lib/design-contract.mjs scripts/lib/context.mjs scripts/director-advance.mjs scripts/apply-patch.mjs skills/visual-system/SKILL.md skills/html-prototype/SKILL.md scripts/test/design-contract.test.mjs scripts/test/gates.test.mjs scripts/test/project-context.test.mjs
git commit -m "feat: seal design contracts before creation"
```

### Task 4: Add Audited Contract Revision And Rollback

**Files:**

- Create: `scripts/lib/design-revision.mjs`
- Create: `scripts/revise-design-contract.mjs`
- Create: `scripts/test/design-revision.test.mjs`
- Modify: `scripts/lib/design-source.mjs`
- Modify: `schemas/context.schema.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing rollback tests**

Build packages at `visual`, `prototype`, and `review` with tokens, prototype, browser results, snapshots, findings, a finalized Design.md, and presentation where applicable. Assert:

```js
const revision = reviseDesignContract(root, ctx, { reason: "新增必需错误状态", now: "2026-07-27T01:00:00Z" });
assert.equal(revision.context.stage, "ux");
assert.equal(revision.context.artifacts.tokens.stale, true);
assert.equal(revision.context.artifacts.prototype.stale, true);
assert.equal(revision.context.artifacts.design_document.phase, "stale");
assert.equal(revision.context.confirmations?.flows, undefined);
assert.equal(revision.context.confirmations?.direction, undefined);
assert.deepEqual(revision.record.invalidated_snapshot_versions, [1, 2, 3]);
```

Reject intake/research/ux without an approved contract, empty reason, already stale contract, direct stage rollback, or a second revision that would overwrite an existing audit record. Confirm no design/prototype/snapshot/finding file is deleted.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test scripts/test/design-revision.test.mjs
```

Expected: FAIL because `scripts/lib/design-revision.mjs` does not exist.

- [ ] **Step 3: Implement revision records and stale calculation**

Export `affectedContractArtifacts(ctx)` and `reviseDesignContract(root, ctx, { reason, now })`. The record path is `audit/revisions/contract-<old>-to-<new>.json` and contains old/new revisions, old digest, reason, stage, every affected artifact key/path/hash, current results hash, snapshot versions, finding paths/hashes, and presentation QA paths/hashes.

The context update sets stage to `ux`, removes `confirmations.flows` and `confirmations.direction`, marks `design_document`, `tokens`, `prototype`, and `presentation` stale when present, and records `superseded_contract_revision`. It does not decrement any artifact version and does not remove files.

- [ ] **Step 4: Add the Director-only CLI and source re-entry rule**

```bash
node scripts/revise-design-contract.mjs --package <dir> --from design_contract --reason <reason>
```

Reject any other `--from` value. Write the revision record and context atomically. Update `buildContractSource()` so a new source can be prepared with `contract_revision = old + 1` only when the matching revision record exists and every old downstream artifact is marked stale.

Add:

```json
"design:revise": "node scripts/revise-design-contract.mjs"
```

- [ ] **Step 5: Run focused tests**

```bash
node --test scripts/test/design-revision.test.mjs scripts/test/design-source.test.mjs scripts/test/gates.test.mjs
```

Expected: controlled rollback passes; direct stage rollback and incomplete invalidation fail.

- [ ] **Step 6: Commit revision support**

```bash
git add package.json schemas/context.schema.json scripts/lib/design-revision.mjs scripts/lib/design-source.mjs scripts/revise-design-contract.mjs scripts/test/design-revision.test.mjs scripts/test/design-source.test.mjs scripts/test/gates.test.mjs
git commit -m "feat: audit design contract revisions"
```

### Task 5: Freeze Reviewed Inputs For Final Design.md

**Files:**

- Create: `schemas/delivery-source.schema.json`
- Create: `scripts/prepare-delivery.mjs`
- Create: `scripts/test/delivery-source.test.mjs`
- Modify: `scripts/lib/design-source.mjs`
- Modify: `scripts/snapshot.mjs`
- Modify: `scripts/lib/hash.mjs`
- Modify: `package.json`
- Test: `scripts/test/snapshot-cli.test.mjs`

- [ ] **Step 1: Write failing snapshot tests for the approved contract**

Extend `scripts/test/snapshot-cli.test.mjs` so snapshot version 3 requires and copies:

```text
Design.md
audit/design/contract-source.json
audit/design/contract-lock.json
```

Assert snapshot creation rejects a proposed/stale document, token/prototype contract mismatch, lock mismatch, or active Design.md whose hash differs from context. Historical package snapshots remain readable; only new version-3 package creation uses the new preconditions.

- [ ] **Step 2: Write failing delivery-source tests**

Create a review-stage package with a version-3 snapshot, results, appended decisions, report, both current full findings, screenshots, and aggregate report. Assert:

```js
const first = buildDeliverySource(root);
const second = buildDeliverySource(root);
assert.equal(first.source_bundle_digest, second.source_bundle_digest);
assert.deepEqual(verifyDeliverySource(root, first), []);
writeFileSync(join(root, "decisions.md"), "changed after bundle");
assert.match(verifyDeliverySource(root, first)[0], /decisions\.md/);
```

Add mutation cases for snapshot digest, contract lock, active/snapshot contract digest mismatch, findings, results, report, screenshots, context projection, and a source path escaping the package.

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test scripts/test/snapshot-cli.test.mjs scripts/test/delivery-source.test.mjs
```

Expected: FAIL because snapshot and delivery-source code do not include Design.md lifecycle evidence.

- [ ] **Step 4: Extend snapshot format and immutable input set**

Set new snapshots to `snapshot_version: 3`. Before creating work directories, validate the approved contract and both downstream bindings. Add Design.md plus the two `audit/design` files to copied and hashed paths. Keep existing atomic temp-directory behavior and delta generation.

`buildDeliverySource()` writes `audit/delivery/context.yaml` using the `design_specification finalize` projection and `audit/delivery/source-manifest.json`. In the implementation, `context` is the validated active context and `design` is `context.artifacts.design_document`; serialize this payload:

```js
{
  source_version: 1,
  artifact_version: prototypeVersion,
  contract_revision: design.contract_revision,
  contract_digest: design.contract_digest,
  contract_lock_sha256: context.confirmations.flows.contract_lock_sha256,
  snapshot_manifest_digest,
  files: sortedHashes,
  source_bundle_digest,
  generated_at,
}
```

`files` covers the snapshot manifest/files map, projected context, current append-only `decisions.md`, results, report, aggregate report, both full findings, and actual screenshots. The bundle digest excludes only `generated_at`.

- [ ] **Step 5: Add atomic CLI and package command**

`prepare-delivery.mjs` requires `stage: review`, current full findings, zero blockers, handled warnings, snapshot version 3, no source drift, and an approved contract. It writes through `audit/delivery/.tmp-*` and refuses overwrite unless `--overwrite` targets the same prototype version and contract digest.

```json
"delivery:prepare": "node scripts/prepare-delivery.mjs"
```

- [ ] **Step 6: Run focused tests**

```bash
node --test scripts/test/snapshot-cli.test.mjs scripts/test/delivery-source.test.mjs scripts/test/hash.test.mjs
```

Expected: all snapshot, immutable source, and drift mutations pass.

- [ ] **Step 7: Commit reviewed-source freezing**

```bash
git add package.json schemas/delivery-source.schema.json scripts/lib/hash.mjs scripts/lib/design-source.mjs scripts/snapshot.mjs scripts/prepare-delivery.mjs scripts/test/snapshot-cli.test.mjs scripts/test/delivery-source.test.mjs scripts/test/hash.test.mjs
git commit -m "feat: freeze design handoff sources"
```

### Task 6: Finalize The Same Design.md As A Development Handoff

**Files:**

- Modify: `scripts/lib/design-document.mjs`
- Modify: `scripts/check-design-document.mjs`
- Modify: `skills/design-specification/SKILL.md`
- Modify: `skills/design-specification/references/contract.md`
- Modify: `scripts/test/design-document.test.mjs`
- Test: `scripts/test/delivery-contracts.test.mjs`

- [ ] **Step 1: Write failing implementation-ready closure tests**

Start from a sealed first part and append all seven implementation headings. The fixture must include exact markers:

```markdown
# 第二部分：实施规格
## 已选视觉方向
- `direction_id`: `D3`
## 设计令牌
- `token`: `semantic.color.primary`
## 组件实施契约
- `component_id`: `inquiry-form`
## 资源清单
- `asset_path`: `prototype/assets/logo.png`
## 页面与原型映射
### 首页
- `page_id`: `home`
- `prototype_path`: `prototype/index.html`
## 开发验收用例
- `flow`: `提交询价`
- `scenario_id`: `inquiry-success`
## 评审、例外与人工验证
- `finding_id`: `visual-warning-1`
```

Assert finalization passes only with `phase: implementation_ready`, incremented Design.md artifact version, unchanged contract revision/digest, current `realizes_prototype_version`, current source digests, every prototype page, every success/error scenario, every semantic token used, every asset, every decision/finding, handled warnings, and explicit manual verification items.

Add isolated failures for changing the first-part AST, missing each section/marker set, old prototype version, old source bundle, unknown token/asset/page/scenario/decision/finding, path traversal, invented component/business conclusion, and placeholder content.

- [ ] **Step 2: Run the test and verify failures**

```bash
node --test scripts/test/design-document.test.mjs scripts/test/delivery-contracts.test.mjs
```

Expected: FAIL because implementation-ready validation is not implemented.

- [ ] **Step 3: Implement final closure without mutating the contract**

Complete `implementationReadyIssues()`. Load the approved first part from the current snapshot, compute its canonical locked digest, and compare it with the final active file, contract lock, context, tokens, prototype, and source manifest. Reuse `collectPrototypePages()` and `loadScenarios()`. Flatten `design-tokens.json` into dot paths. Enumerate non-HTML assets under `prototype/assets/`. Load current findings through existing finding helpers rather than regexing YAML.

The semantic new-decision boundary is fail-closed: every page, flow, token, asset, component, decision, and finding marker in the final document must resolve to a source identifier. The Director routes an unresolved item through Task 4 instead of accepting prose as a new fact.

- [ ] **Step 4: Make the validator phase-aware**

Support:

```bash
npm run design:check -- --package <dir> --phase proposed_contract
npm run design:check -- --package <dir> --phase approved_contract
npm run design:check -- --package <dir> --phase implementation_ready
```

`approved_contract` validates sealed metadata/lock and absence of the second part. `implementation_ready` verifies delivery source drift first and recomputes file SHA before accepting the artifact patch.

- [ ] **Step 5: Complete the finalize Skill contract**

Require a fresh session with only the finalize projection, `audit/delivery/source-manifest.json`, and listed files. The Skill may append the second part and update frontmatter; it must preserve the locked mdast digest, run the final validator, and return only `artifacts.design_document`. It must stop with a structured “contract revision required” response when source facts cannot fit the locked contract.

- [ ] **Step 6: Run focused tests**

```bash
node --test scripts/test/design-document.test.mjs scripts/test/delivery-contracts.test.mjs scripts/test/scenarios.test.mjs
```

Expected: proposed, approved, and implementation-ready fixtures all pass their own phase; cross-phase and mutation cases fail specifically.

- [ ] **Step 7: Commit final Design.md support**

```bash
git add skills/design-specification scripts/lib/design-document.mjs scripts/check-design-document.mjs scripts/test/design-document.test.mjs scripts/test/delivery-contracts.test.mjs
git commit -m "feat: finalize development design documents"
```

### Task 7: Inspect Native Editable PPTX Structure

**Files:**

- Create: `scripts/lib/presentation.mjs`
- Create: `scripts/check-presentation.mjs`
- Create: `scripts/test/presentation.test.mjs`
- Modify: `skills/design-presentation/references/contract.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install structured PPTX test/inspection dependencies**

```bash
npm install jszip@3.10.1 fast-xml-parser@5.10.1 pptxgenjs@4.0.1
```

Expected: all three public dependencies are locked. PptxGenJS is documented as fixture/probe-only; no private `@oai/artifact-tool` package is added to the repository.

- [ ] **Step 2: Write failing editable-PPTX tests**

Build deterministic fixture slides with PptxGenJS:

```js
const REQUIRED_ROLES = ["cover", "problem", "mainline", "system", "core_pages", "value", "boundaries", "next_steps"];
for (const [index, role] of REQUIRED_ROLES.entries()) {
  const slide = pptx.addSlide();
  slide.addText(`${role} title`, { x: 0.7, y: 0.5, w: 8.5, h: 0.5, fontSize: 26 });
  slide.addText(`${role} body`, { x: 0.7, y: 1.3, w: 8.5, h: 2, fontSize: 16 });
  slide.addNotes(`[Sources]\n- internal: Design.md@${designSha}\n- internal: prototype/index.html@v3`);
  manifest.slides.push({ slide_number: index + 1, narrative_role: role, external_sources: [] });
}
await pptx.writeFile({ fileName: deckPath });
```

Assert exact slide order, stable OOXML IDs, editable text/shape/table/image counts, notes, bounding boxes, and full-slide image coverage. Add adversarial decks for missing role, image-only content slide, empty placeholder, absent `[Sources]`, stale Design.md SHA, object-count mismatch, undeclared full-bleed image, and out-of-bounds object.

- [ ] **Step 3: Run the test and verify it fails**

```bash
node --test scripts/test/presentation.test.mjs
```

Expected: FAIL because `scripts/lib/presentation.mjs` does not exist.

- [ ] **Step 4: Implement OOXML inspection with structured parsers**

Use JSZip and fast-xml-parser (`ignoreAttributes: false`) for presentation, relationship, slide, notes, and layout XML. Export:

```js
export const REQUIRED_NARRATIVE_ROLES = Object.freeze([
  "cover", "problem", "mainline", "system", "core_pages", "value", "boundaries", "next_steps",
]);
```

Export `inspectPptx(path)` as an async function returning `{ pptxSha256, slideSize, slides }`, where every slide includes its stable ID, relationship ID, notes text, editable object counts, image coverage, and object bounds. Export `presentationStructureIssues(inspected, manifest, expected)` returning a deterministic `string[]`; `expected` contains `designDocumentSha256`, `prototypeVersion`, and `sourceBundleDigest`.

Recompute all counts, require editable title text on every slide and at least two editable text objects on content slides, reject empty placeholders/out-of-canvas objects, and reject images covering >=90% of content slides unless explicitly allowed as a background with editable title retained. Compute intersections from OOXML bounds; only exact object-ID pairs in `allowed_overlaps` with nonempty reasons may be excluded.

- [ ] **Step 5: Add structural CLI and contract**

`check-presentation.mjs --package <dir> --structure-only` verifies delivery source, final Design.md SHA, PPTX SHA, manifest, and recomputed OOXML facts. Add:

```json
"delivery:check-presentation": "node scripts/check-presentation.mjs"
```

Update the Skill reference with the eight role IDs, notes/source contract, editable-object rules, allowed-overlap schema, and manifest fields, including the current prototype `artifact_version` and monotonic presentation `artifact_revision`.

- [ ] **Step 6: Run focused tests and commit**

```bash
node --test scripts/test/presentation.test.mjs
git add package.json package-lock.json skills/design-presentation/references/contract.md scripts/lib/presentation.mjs scripts/check-presentation.mjs scripts/test/presentation.test.mjs
git commit -m "feat: inspect editable presentation structure"
```

Expected: all positive and adversarial OOXML tests pass before the commit.

### Task 8: Probe Rendering And Bind Presentation QA

**Files:**

- Create: `scripts/lib/presentation-render.mjs`
- Create: `scripts/presentation-probe.mjs`
- Create: `scripts/test/presentation-probe.test.mjs`
- Modify: `scripts/check-presentation.mjs`
- Modify: `scripts/env-check.mjs`
- Modify: `skills/design-presentation/references/codex-adapter.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing adapter and QA tests**

Test injected tool paths and missing `soffice`/`pdftoppm`. Use fake executables for unit positives. Assert `presentationQaIssues()` rejects PPTX SHA mismatch, slide/render mismatch, missing or hash-drifted render, unresolved overlap, unverified clipping/title-wrap/font-substitution checks, incomplete slide review, and stale `audit/presentation/director-review.json`.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test scripts/test/presentation-probe.test.mjs
```

Expected: FAIL because `scripts/lib/presentation-render.mjs` does not exist.

- [ ] **Step 3: Implement the portable render adapter**

Export `resolvePresentationTools(options = {})`, returning `{ available, soffice, pdftoppm, error }`; async `renderPptx(pptxPath, outDir, tools)`, returning `{ pdf, renders }` with each render represented by `{ slideNumber, path, sha256 }`; and `presentationQaIssues(root, inspected, qa, directorReview)`, returning a deterministic `string[]`.

`renderPptx()` creates a unique temporary directory, runs `soffice --headless --convert-to pdf`, runs `pdftoppm -png -r 144`, normalizes names to `slide-1.png`, `slide-2.png`, and atomically replaces `audit/presentation/rendered/`. It records SHA-256 for every render and never reuses old output.

- [ ] **Step 4: Implement the real editable probe**

`presentation-probe.mjs` creates one PptxGenJS slide with editable title/body/shape objects, rereads its OOXML through `inspectPptx`, renders it, and verifies exactly one PNG. It exits `3` when render tools are unavailable and `1` on generation/reread/render failure.

```json
"presentation:probe": "node scripts/presentation-probe.mjs"
```

`checkEnvironment()` records separate `presentation` generation/reread/rendering booleans and `presentation_degraded`; it must not reuse the browser `degraded` flag.

- [ ] **Step 5: Require Director-owned slide review evidence**

Full `check-presentation` renders the final deck and writes trusted facts/hashes to `audit/presentation/qa.json`. It exits `3` until the Director independently writes:

```json
{
  "completed": true,
  "pptx_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "reviewed_slide_numbers": [1, 2, 3, 4, 5, 6, 7, 8],
  "findings": []
}
```

The check command never creates or edits Director review evidence. Reject partial slide lists, duplicates, extra slide numbers, and an older PPTX hash.

- [ ] **Step 6: Run focused and environment probes**

```bash
node --test scripts/test/presentation-probe.test.mjs scripts/test/presentation.test.mjs
npm run presentation:probe
npm run env:check
```

Expected on this machine: focused tests pass; the probe creates, rereads, and renders an editable slide; environment output reports browser and presentation capabilities separately.

- [ ] **Step 7: Commit rendering and QA**

```bash
git add package.json skills/design-presentation/references/codex-adapter.md scripts/lib/presentation-render.mjs scripts/presentation-probe.mjs scripts/check-presentation.mjs scripts/env-check.mjs scripts/test/presentation-probe.test.mjs
git commit -m "feat: verify presentation rendering and qa"
```

### Task 9: Enforce Contract, Handoff, Presentation, And Migration Gates

**Files:**

- Create: `scripts/test/delivery-acceptance.test.mjs`
- Modify: `scripts/lib/delivery.mjs`
- Modify: `scripts/acceptance.mjs`
- Modify: `scripts/director-advance.mjs`
- Modify: `skills/design-director/SKILL.md`
- Test: `scripts/test/gates.test.mjs`
- Test: `scripts/test/snapshot-cli.test.mjs`

- [ ] **Step 1: Write failing three-dimension acceptance tests**

Build pure fixtures around `deliveryAcceptance(root, ctx, { snapshotVersion, environment })`:

```js
assert.deepEqual(deliveryAcceptance(v2HistoricalRoot, historicalCtx, options).map((x) => x.status), ["pass", "pass", "pass"]);
assert.deepEqual(deliveryAcceptance(v3MissingRoot, professionalCtx, options).map((x) => x.status), ["fail", "fail", "fail"]);
assert.deepEqual(deliveryAcceptance(v3QuickEmptyRoot, quickEmptyCtx, options).map((x) => x.status), ["pass", "pass", "pass"]);
assert.equal(deliveryAcceptance(v3QuickPptRoot, quickPptCtx, options)[0].status, "fail");
```

The three ordered dimensions are `设计前契约`, `开发交接文档`, and `设计方案演示`. Add adversarial fixtures for late-generated Design.md without a lock, lock created after tokens, contract drift, stale artifact flags, old snapshot Design.md, final doc missing closure, PPT bound to old final Design.md, requested quick output missing, and historical migration attempted without rerunning design.

- [ ] **Step 2: Write failing delivered-transition tests**

Spawn `director-advance.mjs --stage delivered` against packages whose acceptance exits `1` and `3`. Assert the command returns the same code and `context.yaml` remains byte-identical. Add a passing fixture that advances only after all three dimensions pass.

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test scripts/test/delivery-acceptance.test.mjs scripts/test/gates.test.mjs scripts/test/snapshot-cli.test.mjs
```

Expected: FAIL because the three delivery dimensions and final transition gate are not wired.

- [ ] **Step 4: Implement history-aware acceptance**

`deliveryAcceptance()` returns pass-with-migration-detail for snapshot versions below 3 so historical delivered packages are not invalidated. For version-3 packages:

- `设计前契约` validates source, confirmation, lock ordering, snapshot copy, Visual/Prototype digest binding, and absence of stale flags.
- `开发交接文档` runs implementation-ready closure and source/hash/version checks when required.
- `设计方案演示` runs structure/render/Director-review checks when required; unavailable rendering is `unverified`, not pass.
- Quick packages with neither requested output return `pass` with “not requested”; requesting presentation implicitly evaluates both Design.md phases.

Skip snapshot versions listed in a valid contract-revision record when evaluating the new-contract iteration chain; require the current chain to start after the latest revision. Old files remain auditable but cannot satisfy current-version gates.

- [ ] **Step 5: Integrate dimensions and produced-file semantics**

In `acceptance.mjs`, append:

```js
for (const gate of deliveryAcceptance(root, ctx, { snapshotVersion, environment: env })) {
  add(gate.dimension, gate.status, gate.detail);
}
```

Replace unconditional manifest products in `结构稳定`: flow products remain required; deliverable products are required only for IDs returned by `requiredDeliveryOutputs(ctx)`. Preserve all existing quality gates.

- [ ] **Step 6: Gate `review -> delivered` and update Director instructions**

Before writing delivered state, `director-advance.mjs` synchronously runs `node scripts/acceptance.mjs --package <actual-root>`. Exit `1`, `2`, or `3` leaves context untouched and propagates output/status. Do not add a bypass flag.

Update Design Director with the exact sequence: prepare Design source, dispatch `prepare`, confirm/seal, dispatch Visual and Prototype with bindings, review, prepare delivery source, dispatch `finalize`, dispatch presentation, inspect slides, apply patches, run acceptance, then advance. Add the controlled rollback command and prohibit direct backward stage edits.

- [ ] **Step 7: Run focused and full tests**

```bash
node --test scripts/test/delivery-acceptance.test.mjs scripts/test/gates.test.mjs scripts/test/snapshot-cli.test.mjs
npm run check
npm test
```

Expected: focused tests pass; the full suite has zero failures; existing quality gates remain active.

- [ ] **Step 8: Commit acceptance enforcement**

```bash
git add scripts/lib/delivery.mjs scripts/acceptance.mjs scripts/director-advance.mjs skills/design-director/SKILL.md scripts/test/delivery-acceptance.test.mjs scripts/test/gates.test.mjs scripts/test/snapshot-cli.test.mjs
git commit -m "feat: enforce design-first delivery gates"
```

### Task 10: Update Documentation And Lock Its Workflow Contract

**Files:**

- Create: `scripts/test/documentation-contract.test.mjs`
- Modify: `README.md`
- Modify: `docs/usage.md`
- Modify: `docs/development.md`
- Modify: `docs/superpowers/specs/2026-07-24-design-agent-system-design.md`
- Modify: `docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md`

- [ ] **Step 1: Write the failing documentation contract test**

Create `scripts/test/documentation-contract.test.mjs` with stable command/path assertions rather than matching whole prose paragraphs:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("user documentation exposes the complete design-first command chain", () => {
  const readme = read("README.md");
  const usage = read("docs/usage.md");
  for (const command of [
    "design:prepare-source", "design:check", "design:revise",
    "delivery:prepare", "delivery:check-presentation", "presentation:probe", "accept",
  ]) assert.ok(usage.includes(command), `usage guide is missing ${command}`);
  assert.match(readme, /Design\.md/);
  assert.match(readme, /LibreOffice/);
  const designIndex = usage.indexOf("Design.md");
  const tokensIndex = usage.indexOf("design-tokens.json");
  assert.ok(designIndex >= 0 && tokensIndex > designIndex);
  assert.match(usage, /audit\/design\/contract-lock\.json/);
  assert.match(usage, /presentation\/design-system\.pptx/);
});

test("maintainer documentation records operations, ownership, and migration", () => {
  const development = read("docs/development.md");
  assert.match(development, /design_specification/);
  assert.match(development, /prepare.*finalize/s);
  assert.match(development, /package_format_version/);
  assert.match(development, /contract_revision/);
  assert.match(development, /director-review\.json/);
});

test("base specification delegates the active extension instead of promising future PPT work", () => {
  const base = read("docs/superpowers/specs/2026-07-24-design-agent-system-design.md");
  const extension = read("docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md");
  assert.doesNotMatch(base, /后续将它们实现为独立输出 Skill/);
  assert.match(base, /2026-07-26-delivery-artifacts-design\.md/);
  assert.match(base, /package_format_version.*3/s);
  assert.match(extension, /状态：已实现/);
});
```

- [ ] **Step 2: Run the test and verify documentation drift is visible**

```bash
node --test scripts/test/documentation-contract.test.mjs
```

Expected: FAIL because current docs omit the new commands and still describe PPT as future work.

- [ ] **Step 3: Update the README quick start and capability summary**

Describe seven patch-capable Skills: five flow Skills plus `design_specification` and `design_presentation`. State that professional mode creates and seals `Design.md` before Visual, finalizes the same file after review, then creates `presentation/design-system.pptx`. Add LibreOffice and Poppler as professional-PPT rendering prerequisites; explain presentation probe exit `3` as unverified and non-deliverable, separate from browser degradation.

Keep the existing first-run command, but state that package format 3 initializes both required delivery outputs. Do not turn the README into the full operations manual; link to the usage guide for exact commands and rollback.

- [ ] **Step 4: Rewrite the usage workflow, command table, and package tree**

Keep the canonical stage names unchanged and show these ordered actions inside them:

```text
research -> ux -> prepare Design.md -> confirm/seal -> visual -> prototype
         -> review -> finalize Design.md -> presentation -> delivered
```

Document professional and quick `--deliverables` semantics, the combined flows/Design.md confirmation command with `--design-patch`, all six new package scripts, exit codes, the Director-only rollback command, and the rule that old evidence remains but is stale after rollback. Extend the package tree with `Design.md`, `presentation/design-system.pptx`, `audit/design/`, `audit/delivery/`, `audit/presentation/`, and `audit/revisions/`.

- [ ] **Step 5: Update maintainer and specification contracts**

In `docs/development.md`, document deliverable manifests, operation-specific projections, the single-owner `Design.md`, canonical digests, atomic source manifests, contract-lock ordering, snapshot version 3, history-aware acceptance, PPTX structural parsing, render evidence, and independent Director review.

In `docs/superpowers/specs/2026-07-24-design-agent-system-design.md`, replace the obsolete “future PPT Skill” wording with a versioned-extension note linking `2026-07-26-delivery-artifacts-design.md`: package formats before 3 retain the original scope, while new version-3 professional packages use the extension. Update the extension status to `状态：已实现，待端到端验收` without rewriting its confirmed decisions.

- [ ] **Step 6: Run documentation and system checks**

```bash
node --test scripts/test/documentation-contract.test.mjs
npm run check
git diff --check
```

Expected: the documentation contract and system validation pass with no whitespace errors.

- [ ] **Step 7: Commit documentation and its regression test**

The base specification is currently ignored and must be added explicitly by exact path:

```bash
git add README.md docs/usage.md docs/development.md scripts/test/documentation-contract.test.mjs docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md
git add -f docs/superpowers/specs/2026-07-24-design-agent-system-design.md
git commit -m "docs: document design-first delivery workflow"
```

### Task 11: Prove The Complete Workflow, Rollback, And Final Acceptance

**Files:**

- Create and preserve as ignored verification output: `outputs/design-first-delivery-demo/`
- Modify after successful verification: `docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md`

- [ ] **Step 1: Establish a clean runtime baseline**

```bash
npm run check
npm test
npm run validate:rules
npm run env:check
npm run presentation:probe
```

Expected: all static and unit checks pass; browser automation and presentation creation/reread/render all report available. Exit `3` from either real capability probe is a completion blocker for this professional-mode proof, not a pass.

- [ ] **Step 2: Initialize one new professional package with concrete scope**

```bash
npm run init -- \
  --package outputs/design-first-delivery-demo \
  --name "Vehicle Export Quote Desk" \
  --mode professional \
  --task-type new_design \
  --platforms web,mobile_web \
  --primary-user "海外采购商，需要筛选车辆并提交出口询价" \
  --industry saas_b2b
```

Expected: `context.yaml` has `package_format_version: 3`, both delivery outputs, `stage: intake`, and no design artifacts.

- [ ] **Step 3: Run Research and UX, then create and seal the pre-design contract**

Use Design Director to dispatch `requirements_research` and `ux_architecture` for these exact core flows: `筛选车辆`, `查看车辆详情`, and `提交出口询价`; include successful inquiry plus validation and network-error scenarios. Apply their patches through the existing diff/apply commands and record the requirements confirmation with the user's real reply.

At `stage: ux`, first freeze and project the inputs:

```bash
npm run design:prepare-source -- --package outputs/design-first-delivery-demo
npm run ctx:project -- --package outputs/design-first-delivery-demo --skill design_specification --operation prepare --out outputs/design-first-delivery-demo/audit/design/context-for-prepare.yaml
```

Dispatch `design_specification prepare` in a fresh session. It must write `Design.md` plus `audit/design/provisional-patch.yaml` and return only after its proposed-phase validator passes. Present both `flows.md` and `Design.md` to the user and wait for a written confirmation. Store that reply verbatim in a task-specific environment variable, then seal:

```bash
npm run design:check -- --package outputs/design-first-delivery-demo --phase proposed_contract
node scripts/director-advance.mjs \
  --package outputs/design-first-delivery-demo \
  --confirm flows \
  --summary "确认三条核心流程、页面状态与 Design.md 设计契约" \
  --reply "$DESIGN_CONFIRMATION_REPLY" \
  --design-patch outputs/design-first-delivery-demo/audit/design/provisional-patch.yaml
node scripts/director-advance.mjs --package outputs/design-first-delivery-demo --stage visual
```

Do not set `DESIGN_CONFIRMATION_REPLY` from Agent-authored text. Expected: `Design.md` becomes `approved_contract`; `audit/design/contract-lock.json` exists; the context confirmation binds the flows hash, contract digest, and lock hash; no tokens, prototype, snapshots, or findings existed when sealed.

- [ ] **Step 4: Generate contract-bound Visual and Prototype artifacts and complete review**

Dispatch `visual_system` and `html_prototype` in fresh sessions using only their projected inputs. Apply each returned patch and verify both artifacts contain the current `design_contract_digest` and `contract_lock_sha256`. Complete the required direction confirmation, browser checks, screenshot iterations, immutable snapshot, standards review, visual review, warning decisions, and aggregation for the current prototype version.

Run the concrete machine steps at the corresponding boundaries:

```bash
npm run shot -- --package outputs/design-first-delivery-demo --round 1
npm run shot -- --package outputs/design-first-delivery-demo --round 2
npm run browser:check -- --package outputs/design-first-delivery-demo --version 1
npm run snapshot -- --package outputs/design-first-delivery-demo --version 1
npm run review:record -- --package outputs/design-first-delivery-demo --version 1 --in outputs/design-first-delivery-demo/audit/incoming/standards-findings.yaml
npm run review:record -- --package outputs/design-first-delivery-demo --version 1 --in outputs/design-first-delivery-demo/audit/incoming/visual-findings.yaml
npm run review:aggregate -- --package outputs/design-first-delivery-demo --version 1
```

Expected: the snapshot is version 3, includes the approved Design.md and design lock evidence, both current full reviews are present, blockers are zero, and every warning has an explicit decision.

- [ ] **Step 5: Finalize the same Design.md and create the editable presentation**

First freeze and project the reviewed inputs:

```bash
npm run delivery:prepare -- --package outputs/design-first-delivery-demo
npm run ctx:project -- --package outputs/design-first-delivery-demo --skill design_specification --operation finalize --out outputs/design-first-delivery-demo/audit/delivery/context-for-finalize.yaml
```

Dispatch `design_specification finalize` in a fresh session, apply its patch, then validate and project presentation inputs:

```bash
npm run design:check -- --package outputs/design-first-delivery-demo --phase implementation_ready
npm run ctx:project -- --package outputs/design-first-delivery-demo --skill design_presentation --out outputs/design-first-delivery-demo/audit/delivery/context-for-presentation.yaml
```

Dispatch `design_presentation` in another fresh session, apply its patch, and run the structural check:

```bash
npm run delivery:check-presentation -- --package outputs/design-first-delivery-demo --structure-only
npm run delivery:check-presentation -- --package outputs/design-first-delivery-demo
```

Expected: the structure-only call passes; the first full call regenerates trusted render/QA evidence and exits `3` because Director review does not exist yet. The Director then opens every rendered slide, records all slide numbers and findings in `audit/presentation/director-review.json`, and reruns:

```bash
npm run delivery:check-presentation -- --package outputs/design-first-delivery-demo
```

Expected: the locked first-part digest is unchanged; the final Design.md is `implementation_ready`; the PPTX contains editable native objects and all eight narrative roles; all renders and Director review evidence bind the current PPTX SHA.

- [ ] **Step 6: Run adversarial bypass probes on isolated copies**

Create three copies while the valid package remains untouched:

```bash
DELIVERY_PROBE_ROOT="$(mktemp -d /tmp/beansmile-design-delivery-probes.XXXXXX)"
cp -R outputs/design-first-delivery-demo "$DELIVERY_PROBE_ROOT/contract-drift"
cp -R outputs/design-first-delivery-demo "$DELIVERY_PROBE_ROOT/late-lock"
cp -R outputs/design-first-delivery-demo "$DELIVERY_PROBE_ROOT/stale-presentation"
cp -R outputs/design-first-delivery-demo "$DELIVERY_PROBE_ROOT/direct-stage"
```

Apply the three mutations with structured parsers where applicable:

```bash
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  const path = join(process.argv[1], "Design.md");
  const source = readFileSync(path, "utf8");
  writeFileSync(path, source.replace("## 用户、任务与成功标准", "新增未经确认的设计约束。\n\n## 用户、任务与成功标准"));
' "$DELIVERY_PROBE_ROOT/contract-drift"

node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  const path = join(process.argv[1], "audit/design/contract-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  lock.downstream_absent = false;
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
' "$DELIVERY_PROBE_ROOT/late-lock"

node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import yaml from "js-yaml";
  const path = join(process.argv[1], "context.yaml");
  const context = yaml.load(readFileSync(path, "utf8"));
  context.artifacts.presentation.design_document_sha256 = "d".repeat(64);
  writeFileSync(path, yaml.dump(context, { lineWidth: 100 }));
' "$DELIVERY_PROBE_ROOT/stale-presentation"

npm run accept -- --package "$DELIVERY_PROBE_ROOT/contract-drift"
npm run accept -- --package "$DELIVERY_PROBE_ROOT/late-lock"
npm run accept -- --package "$DELIVERY_PROBE_ROOT/stale-presentation"
```

Expected: all three commands exit `1`; details name contract drift, invalid ordering evidence, and final Design.md/PPT binding respectively. The untouched demo still passes acceptance afterward.

- [ ] **Step 7: Prove controlled rollback on another isolated copy**

```bash
cp -R outputs/design-first-delivery-demo "$DELIVERY_PROBE_ROOT/rollback"
npm run design:revise -- --package "$DELIVERY_PROBE_ROOT/rollback" --from design_contract --reason "新增必需的询价超时恢复状态"
node scripts/director-advance.mjs --package "$DELIVERY_PROBE_ROOT/direct-stage" --stage ux
```

Inspect `context.yaml` and `audit/revisions/contract-1-to-2.json`. Expected: the rollback command succeeds; stage is `ux`; the revision record sets `new_contract_revision` to 2 while the preserved stale Design.md retains its old revision; Design.md, tokens, prototype, and presentation registrations are stale; flow/direction confirmations are cleared; old prototype, results, snapshots, findings, Design.md, PPTX, and QA files still exist byte-for-byte. The direct stage command exits `1` and leaves its copy unchanged.

- [ ] **Step 8: Run final acceptance and advance only the valid package**

```bash
npm run design:check -- --package outputs/design-first-delivery-demo --phase implementation_ready
npm run delivery:check-presentation -- --package outputs/design-first-delivery-demo
npm run accept -- --package outputs/design-first-delivery-demo
node scripts/director-advance.mjs --package outputs/design-first-delivery-demo --stage delivered
npm run accept -- --package outputs/design-first-delivery-demo
```

Expected: both acceptance runs pass all existing gates plus `设计前契约`, `开发交接文档`, and `设计方案演示`; only then does the Director move `review -> delivered`.

- [ ] **Step 9: Run final repository verification**

```bash
npm run check
npm test
npm run validate:rules
npm run recall -- --out /tmp/beansmile-design-delivery-recall.json
npm run env:check
npm run presentation:probe
git diff --check
git status --short
```

Expected: every command passes, the recall harness reports no regression against its threshold, no tracked implementation changes remain uncommitted, and the ignored `outputs/design-first-delivery-demo/` retains the complete auditable proof package.

- [ ] **Step 10: Record successful end-to-end verification and commit**

Only after Steps 1-9 pass, change the extension specification status from `状态：已实现，待端到端验收` to `状态：已实现并完成端到端验收`. Do not record success when browser or presentation verification exited `3`.

```bash
node --test scripts/test/documentation-contract.test.mjs
git diff --check
git add docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md
git commit -m "docs: record delivery artifact verification"
git status --short
```

Expected: documentation tests pass, the verification-status commit succeeds, and the tracked working tree is clean.
