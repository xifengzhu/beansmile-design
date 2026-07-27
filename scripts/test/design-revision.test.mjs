import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { affectedContractArtifacts, reviseDesignContract } from "../lib/design-revision.mjs";
import { hashPaths, sha256File } from "../lib/hash.mjs";

const CLI = resolve(import.meta.dirname, "..", "revise-design-contract.mjs");
const DIGEST = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const LOCK_SHA = "c".repeat(64);

function write(root, path, text) {
  const target = join(root, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, text);
}

function setup(stage = "review", { phase = "implementation_ready", withPresentation = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "design-revision-"));
  write(root, "Design.md", "# 第一部分：设计契约\n\n旧契约。\n\n# 第二部分：实施规格\n\n旧实现。\n");
  write(root, "design-tokens.json", '{"color":"#123456"}\n');
  write(root, "prototype/index.html", "<!doctype html><title>旧原型</title>\n");
  write(root, "presentation/design-system.pptx", "old-pptx\n");
  write(root, "audit/results.json", '{"checks_version":4}\n');
  for (const version of [1, 2, 3]) write(root, `audit/snapshots/${version}/manifest.json`, `{\"artifact_version\":\"${version}\"}\n`);
  write(root, "audit/findings/standards-3.yaml", "artifact_version: '3'\nfindings: []\n");
  write(root, "audit/findings/visual-3.yaml", "artifact_version: '3'\nfindings: []\n");
  write(root, "audit/presentation/manifest.json", '{"slides":12}\n');
  write(root, "audit/presentation/qa.json", '{"status":"pass"}\n');
  write(root, "audit/presentation/director-review.json", '{"reviewed_slides":[1]}\n');
  write(root, "audit/presentation/rendered/1.png", "png-bytes\n");

  const artifacts = {
    design_document: {
      path: "Design.md",
      artifact_version: "2",
      phase,
      contract_revision: 1,
      contract_digest: DIGEST,
      contract_source_digest: SOURCE_DIGEST,
      sha256: sha256File(join(root, "Design.md")),
      updated_by: "design_specification",
    },
    tokens: {
      path: "design-tokens.json",
      artifact_version: "1",
      design_contract_digest: DIGEST,
      contract_lock_sha256: LOCK_SHA,
      updated_by: "visual_system",
    },
    prototype: {
      path: "prototype",
      artifact_version: "3",
      design_contract_digest: DIGEST,
      contract_lock_sha256: LOCK_SHA,
      updated_by: "html_prototype",
    },
    ...(withPresentation ? {
      presentation: {
        path: "presentation/design-system.pptx",
        artifact_version: "3",
        artifact_revision: 1,
        design_contract_digest: DIGEST,
        contract_lock_sha256: LOCK_SHA,
        design_document_sha256: sha256File(join(root, "Design.md")),
        updated_by: "design_presentation",
      },
    } : {}),
  };
  const ctx = {
    project: {
      name: "询价平台",
      mode: "professional",
      task_type: "new_design",
      reference_system: "none",
      industry: "general",
      platforms: ["web"],
      package_format_version: 3,
      delivery_outputs: ["design_specification", "design_presentation"],
    },
    users: { primary: "采购方" },
    goals: { user_tasks: ["提交询价"] },
    assumptions: [],
    decisions: [],
    exceptions: [],
    artifacts,
    confirmations: {
      requirements: { summary: "确认需求", user_reply: "确认" },
      flows: {
        summary: "确认契约",
        user_reply: "确认",
        flows_sha256: "d".repeat(64),
        design_contract_digest: DIGEST,
        contract_lock_sha256: LOCK_SHA,
      },
      direction: {
        summary: "确认方向",
        user_reply: "选择二",
        candidates: ["方向一", "方向二"],
        chosen: "方向二",
      },
    },
    stage,
  };
  writeFileSync(join(root, "context.yaml"), yaml.dump(ctx));
  return { root, ctx };
}

test("controlled rollback marks contract-bound artifacts stale and preserves all evidence", () => {
  for (const stage of ["visual", "prototype", "review"]) {
    const pkg = setup(stage, { phase: stage === "review" ? "implementation_ready" : "approved_contract" });
    try {
      const preservedBefore = hashPaths(pkg.root, [
        "Design.md",
        "design-tokens.json",
        "prototype",
        "presentation",
        "audit/results.json",
        "audit/snapshots",
        "audit/findings",
        "audit/presentation",
      ]);
      const revision = reviseDesignContract(pkg.root, pkg.ctx, {
        reason: "新增必需错误状态",
        now: "2026-07-27T01:00:00Z",
      });

      assert.equal(revision.context.stage, "ux");
      assert.equal(revision.context.artifacts.design_document.phase, "stale");
      for (const key of ["design_document", "tokens", "prototype", "presentation"]) {
        assert.equal(revision.context.artifacts[key].stale, true);
        assert.equal(revision.context.artifacts[key].superseded_contract_revision, 1);
        assert.equal(revision.context.artifacts[key].stale_reason, "新增必需错误状态");
      }
      assert.equal(revision.context.artifacts.design_document.artifact_version, "2");
      assert.equal(revision.context.artifacts.prototype.artifact_version, "3");
      assert.equal(revision.context.confirmations?.flows, undefined);
      assert.equal(revision.context.confirmations?.direction, undefined);
      assert.ok(revision.context.confirmations?.requirements);

      assert.equal(revision.record.old_contract_revision, 1);
      assert.equal(revision.record.new_contract_revision, 2);
      assert.equal(revision.record.old_contract_digest, DIGEST);
      assert.equal(revision.record.reason, "新增必需错误状态");
      assert.equal(revision.record.stage, stage);
      assert.deepEqual(revision.record.invalidated_snapshot_versions, [1, 2, 3]);
      assert.deepEqual(revision.record.affected_artifacts.map((entry) => entry.key), affectedContractArtifacts(pkg.ctx).map((entry) => entry.key));
      assert.ok(revision.record.affected_artifacts.every((entry) => entry.path && /^[a-f0-9]{64}$/.test(entry.sha256)));
      assert.match(revision.record.current_results.sha256, /^[a-f0-9]{64}$/);
      assert.equal(revision.record.findings.length, 2);
      assert.ok(revision.record.presentation_qa.some((entry) => entry.path.endsWith("qa.json")));

      const recordPath = join(pkg.root, "audit", "revisions", "contract-1-to-2.json");
      assert.equal(existsSync(recordPath), true);
      assert.deepEqual(JSON.parse(readFileSync(recordPath, "utf8")), revision.record);
      assert.deepEqual(yaml.load(readFileSync(join(pkg.root, "context.yaml"), "utf8")), revision.context);
      assert.deepEqual(hashPaths(pkg.root, Object.keys(preservedBefore)), preservedBefore);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("revision rejects missing authority, invalid state, and an existing audit record", () => {
  const cases = [
    ["empty reason", "review", {}, { reason: "   " }, /reason|原因/],
    ["early stage", "research", {}, {}, /stage|阶段/],
    ["ux without approved contract", "ux", { phase: "stale" }, {}, /approved|有效契约|stale/],
    ["already stale", "review", { phase: "stale" }, {}, /stale|失效/],
  ];
  for (const [name, stage, options, callOptions, expected] of cases) {
    const pkg = setup(stage, options);
    try {
      assert.throws(() => reviseDesignContract(pkg.root, pkg.ctx, {
        reason: "需要修订",
        now: "2026-07-27T01:00:00Z",
        ...callOptions,
      }), expected, name);
      assert.equal(existsSync(join(pkg.root, "audit", "revisions", "contract-1-to-2.json")), false);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }

  const duplicate = setup("review");
  try {
    write(duplicate.root, "audit/revisions/contract-1-to-2.json", "{}\n");
    assert.throws(() => reviseDesignContract(duplicate.root, duplicate.ctx, { reason: "需要修订" }), /已存在|覆盖/);
  } finally {
    rmSync(duplicate.root, { recursive: true, force: true });
  }
});

test("revision writes record and context atomically", () => {
  const pkg = setup("review");
  try {
    const beforeContext = readFileSync(join(pkg.root, "context.yaml"));
    assert.throws(() => reviseDesignContract(pkg.root, pkg.ctx, {
      reason: "需要修订",
      beforeCommit: () => { throw new Error("interrupt"); },
    }), /interrupt/);
    assert.deepEqual(readFileSync(join(pkg.root, "context.yaml")), beforeContext);
    assert.equal(existsSync(join(pkg.root, "audit", "revisions", "contract-1-to-2.json")), false);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("Director-only CLI rejects other rollback origins and performs audited revision", () => {
  const pkg = setup("review");
  try {
    let result = spawnSync("node", [CLI, "--package", pkg.root, "--from", "prototype", "--reason", "需要修订"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /design_contract/);

    result = spawnSync("node", [CLI, "--package", pkg.root, "--from", "design_contract", "--reason", "需要修订"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(yaml.load(readFileSync(join(pkg.root, "context.yaml"), "utf8")).stage, "ux");
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});
