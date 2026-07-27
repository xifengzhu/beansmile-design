import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import {
  deliveryArtifactVersionIssues,
  deliveryModeIssues,
  requiresDesignContract,
  requiredDeliveryOutputs,
} from "../lib/delivery.mjs";
import { validateContext } from "../lib/context.mjs";
import { loadManifests, resolveManifest } from "../lib/manifests.mjs";
import { loadRegistry, validateRegistry } from "../lib/registry.mjs";

const BOTH = ["design_specification", "design_presentation"];
const INIT = resolve(import.meta.dirname, "..", "init-project.mjs");

function runInit(root, ...args) {
  return spawnSync("node", [
    INIT,
    "--package", root,
    "--name", "delivery-test",
    "--task-type", "new_design",
    "--platforms", "web",
    "--primary-user", "designer",
    ...args,
  ], { encoding: "utf8" });
}

test("professional mode requires Design.md lifecycle and presentation", () => {
  const ctx = {
    project: {
      mode: "professional",
      package_format_version: 3,
      delivery_outputs: BOTH,
    },
  };
  assert.deepEqual(requiredDeliveryOutputs(ctx), BOTH);
  assert.deepEqual(deliveryModeIssues(ctx, { enforce: true }), []);
  assert.match(
    deliveryModeIssues({
      project: {
        mode: "professional",
        package_format_version: 3,
        delivery_outputs: [],
      },
    }, { enforce: true })[0],
    /缺少/,
  );
});

test("quick presentation implies design specification", () => {
  const ctx = {
    project: {
      mode: "quick",
      package_format_version: 3,
      delivery_outputs: ["design_presentation"],
    },
  };
  assert.deepEqual(requiredDeliveryOutputs(ctx), BOTH);
});

test("historical packages do not retroactively require the Design.md lifecycle", () => {
  assert.equal(requiresDesignContract({ project: { mode: "professional" } }), false);
  assert.equal(requiresDesignContract({
    project: {
      mode: "professional",
      package_format_version: 3,
      delivery_outputs: BOTH,
    },
  }), true);
});

test("delivery mode rejects unknown and duplicate output ids", () => {
  const issues = deliveryModeIssues({
    project: {
      mode: "quick",
      package_format_version: 3,
      delivery_outputs: ["design_specification", "design_specification", "unknown"],
    },
  }, { enforce: true });
  assert.ok(issues.some((issue) => issue.includes("未知")));
  assert.ok(issues.some((issue) => issue.includes("重复")));
});

test("new professional packages initialize format 3 with both delivery outputs", () => {
  const parent = mkdtempSync(join(tmpdir(), "delivery-init-professional-"));
  const root = join(parent, "package");
  try {
    const result = runInit(root, "--mode", "professional", "--industry", "general");
    assert.equal(result.status, 0, result.stderr);
    const ctx = yaml.load(readFileSync(join(root, "context.yaml"), "utf8"));
    assert.equal(ctx.project.package_format_version, 3);
    assert.deepEqual(ctx.project.delivery_outputs, BOTH);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("quick presentation request initializes both outputs", () => {
  const parent = mkdtempSync(join(tmpdir(), "delivery-init-quick-"));
  const root = join(parent, "package");
  try {
    const result = runInit(
      root,
      "--mode", "quick",
      "--deliverables", "design_presentation",
    );
    assert.equal(result.status, 0, result.stderr);
    const ctx = yaml.load(readFileSync(join(root, "context.yaml"), "utf8"));
    assert.equal(ctx.project.package_format_version, 3);
    assert.deepEqual(ctx.project.delivery_outputs, BOTH);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("invalid quick deliverables fail before package directories are created", () => {
  for (const value of ["unknown", "design_specification,design_specification"]) {
    const parent = mkdtempSync(join(tmpdir(), "delivery-init-invalid-"));
    const root = join(parent, "package");
    try {
      const result = runInit(root, "--mode", "quick", "--deliverables", value);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(existsSync(root), false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("version 3 Design.md packages require contract-bound flow confirmation", () => {
  const base = {
    project: {
      name: "x",
      mode: "quick",
      task_type: "new_design",
      reference_system: "none",
      platforms: ["web"],
      package_format_version: 3,
      delivery_outputs: ["design_specification"],
    },
    users: { primary: "designer" },
    goals: {},
    artifacts: {},
    stage: "ux",
  };
  const incomplete = validateContext({
    ...base,
    confirmations: { flows: { summary: "确认流程", user_reply: "确认" } },
  });
  assert.equal(incomplete.ok, false);

  const complete = validateContext({
    ...base,
    confirmations: {
      flows: {
        summary: "确认流程和契约",
        user_reply: "确认",
        flows_sha256: "a".repeat(64),
        design_contract_digest: "b".repeat(64),
        contract_lock_sha256: "c".repeat(64),
      },
    },
  });
  assert.equal(complete.ok, true, complete.errors.join("\n"));

  const historical = structuredClone(base);
  delete historical.project.package_format_version;
  delete historical.project.delivery_outputs;
  historical.confirmations = { flows: { summary: "历史确认", user_reply: "确认" } };
  assert.equal(validateContext(historical).ok, true);
});

test("design specification resolves operation-specific reads", () => {
  const prepare = resolveManifest("design_specification", "prepare");
  const finalize = resolveManifest("design_specification", "finalize");
  assert.ok(prepare.reads.includes("artifacts.brief"));
  assert.ok(!prepare.reads.includes("artifacts.prototype"));
  assert.ok(finalize.reads.includes("artifacts.prototype"));
  assert.deepEqual(prepare.writes, ["artifacts.design_document"]);
  assert.throws(() => resolveManifest("design_specification"), /--operation/);
  assert.throws(() => resolveManifest("design_specification", "publish"), /未知 operation/);
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
  assert.deepEqual(
    deliveryArtifactVersionIssues(null, { artifact_version: "1" }, { kind: "design_document" }),
    [],
  );
  assert.deepEqual(
    deliveryArtifactVersionIssues(
      { artifact_version: "1" },
      { artifact_version: "2" },
      { kind: "design_document" },
    ),
    [],
  );
  assert.match(
    deliveryArtifactVersionIssues(
      { artifact_version: "1" },
      { artifact_version: "3" },
      { kind: "design_document" },
    )[0],
    /artifact_version/,
  );
  assert.deepEqual(
    deliveryArtifactVersionIssues(
      null,
      { artifact_version: "3", artifact_revision: 1 },
      { kind: "presentation", prototypeVersion: "3" },
    ),
    [],
  );
  assert.deepEqual(
    deliveryArtifactVersionIssues(
      { artifact_version: "3", artifact_revision: 1 },
      { artifact_version: "3", artifact_revision: 2 },
      { kind: "presentation", prototypeVersion: "3" },
    ),
    [],
  );
  assert.match(
    deliveryArtifactVersionIssues(
      { artifact_version: "3", artifact_revision: 1 },
      { artifact_version: "3", artifact_revision: 1 },
      { kind: "presentation", prototypeVersion: "3" },
    )[0],
    /artifact_revision/,
  );
});

test("finalize requires exactly the next Design.md artifact version", () => {
  const before = { artifact_version: "1", phase: "approved_contract" };
  assert.deepEqual(
    deliveryArtifactVersionIssues(before, { artifact_version: "2", phase: "implementation_ready" }, { kind: "design_document" }),
    [],
  );
  assert.match(
    deliveryArtifactVersionIssues(before, { artifact_version: "1", phase: "implementation_ready" }, { kind: "design_document" })[0],
    /artifact_version/,
  );
});
