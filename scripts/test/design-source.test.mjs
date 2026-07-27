import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { buildContractSource, verifyContractSource } from "../lib/design-source.mjs";

const CLI = resolve(import.meta.dirname, "..", "prepare-design-contract.mjs");

const FLOWS = `# 核心任务流

- \`flow\`: \`提交询价\`

# 页面地图

- \`page_id\`: \`home\`
- \`route\`: \`/\`
`;

function context(overrides = {}) {
  const base = {
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
    constraints: ["技术栈未指定"],
    assumptions: [],
    decisions: [],
    exceptions: [],
    artifacts: {
      brief: { path: "brief.md", artifact_version: "1", updated_by: "requirements_research" },
      flows: { path: "flows.md", artifact_version: "1", updated_by: "ux_architecture" },
    },
    stage: "ux",
  };
  return {
    ...base,
    ...overrides,
    project: { ...base.project, ...(overrides.project ?? {}) },
    artifacts: { ...base.artifacts, ...(overrides.artifacts ?? {}) },
  };
}

export function makeDesignSourcePackage(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "design-source-"));
  writeFileSync(join(root, "context.yaml"), yaml.dump(context(overrides)));
  writeFileSync(join(root, "brief.md"), "# Brief\n\n采购方需要提交询价。\n");
  writeFileSync(join(root, "flows.md"), FLOWS);
  writeFileSync(join(root, "decisions.md"), "# Decisions\n\n暂无新增决策。\n");
  return root;
}

test("contract source is deterministic and detects frozen file drift", () => {
  const root = makeDesignSourcePackage();
  try {
    const first = buildContractSource(root, { contractRevision: 1, now: "2026-07-27T00:00:00Z" });
    const second = buildContractSource(root, { contractRevision: 1, now: "2026-07-28T00:00:00Z" });
    assert.equal(first.contract_source_digest, second.contract_source_digest);
    assert.deepEqual(verifyContractSource(root, second), []);
    assert.deepEqual(second.files.map((entry) => entry.path), ["brief.md", "decisions.md", "flows.md"]);
    assert.ok(existsSync(join(root, "audit", "design", "context.yaml")));
    assert.ok(existsSync(join(root, "audit", "design", "rules.yaml")));

    writeFileSync(join(root, "flows.md"), "changed after freeze");
    assert.match(verifyContractSource(root, second)[0], /flows\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("contract source rejects invalid stage, missing registered sources, and active downstream artifacts", () => {
  const cases = [
    { override: { stage: "visual" }, message: /stage.*ux/i },
    { override: { artifacts: { brief: undefined } }, message: /artifacts\.brief/ },
    {
      override: {
        artifacts: {
          tokens: { path: "design-tokens.json", artifact_version: "1", updated_by: "visual_system" },
        },
      },
      message: /tokens.*下游|下游.*tokens/,
    },
    { override: { project: { reference_system: "fluent" } }, message: /reference_system|主参考系统/ },
  ];
  for (const { override, message } of cases) {
    const root = makeDesignSourcePackage(override);
    try {
      assert.throws(() => buildContractSource(root), message);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const missing = makeDesignSourcePackage();
  try {
    rmSync(join(missing, "brief.md"));
    assert.throws(() => buildContractSource(missing), /brief\.md/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
});

test("stale downstream registrations still require the matching revision record", () => {
  const root = makeDesignSourcePackage({
    artifacts: {
      tokens: {
        path: "design-tokens.json",
        artifact_version: "1",
        updated_by: "visual_system",
        stale: true,
        superseded_contract_revision: 1,
      },
    },
  });
  try {
    assert.throws(() => buildContractSource(root, { contractRevision: 2 }), /revision record|revision.*记录|修订记录/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("contract source rejects a revision record that does not bind the stale artifacts and old digest", () => {
  const stale = {
    stale: true,
    stale_reason: "新增必需错误状态",
    superseded_contract_revision: 1,
  };
  const root = makeDesignSourcePackage({
    artifacts: {
      design_document: {
        path: "Design.md",
        artifact_version: "1",
        phase: "stale",
        contract_revision: 1,
        contract_digest: "a".repeat(64),
        contract_source_digest: "b".repeat(64),
        sha256: "c".repeat(64),
        updated_by: "design_specification",
        ...stale,
      },
      tokens: {
        path: "design-tokens.json",
        artifact_version: "1",
        updated_by: "visual_system",
        ...stale,
      },
    },
  });
  try {
    writeFileSync(join(root, "Design.md"), "old design\n");
    writeFileSync(join(root, "design-tokens.json"), "{}\n");
    const recordDir = join(root, "audit", "revisions");
    const recordPath = join(recordDir, "contract-1-to-2.json");
    const invalid = {
      old_contract_revision: 1,
      new_contract_revision: 2,
      old_contract_digest: "f".repeat(64),
      affected_artifacts: [{ key: "design_document", path: "Design.md", sha256: "0".repeat(64) }],
    };
    mkdirSync(recordDir, { recursive: true });
    writeFileSync(recordPath, `${JSON.stringify(invalid, null, 2)}\n`);
    assert.throws(() => buildContractSource(root, { contractRevision: 2 }), /old.*digest|affected|revision record|修订记录/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects manifest paths outside the package", () => {
  const root = makeDesignSourcePackage();
  try {
    const manifest = buildContractSource(root);
    const escaped = structuredClone(manifest);
    escaped.files[0].path = "../outside.md";
    assert.ok(verifyContractSource(root, escaped).some((issue) => /越界|包外|非法路径/.test(issue)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects reordered, duplicate, or redirected frozen inputs", () => {
  const root = makeDesignSourcePackage();
  try {
    const manifest = buildContractSource(root);

    const reordered = structuredClone(manifest);
    reordered.files.reverse();
    assert.ok(verifyContractSource(root, reordered).some((issue) => /排序/.test(issue)));

    const duplicate = structuredClone(manifest);
    duplicate.files.push({ ...duplicate.files[0] });
    assert.ok(verifyContractSource(root, duplicate).some((issue) => /重复/.test(issue)));

    const redirected = structuredClone(manifest);
    redirected.context.path = "brief.md";
    assert.ok(verifyContractSource(root, redirected).some((issue) => /context.*固定路径|固定路径.*context/.test(issue)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic source generation cleans temporary directories after interruption", () => {
  const root = makeDesignSourcePackage();
  try {
    assert.throws(
      () => buildContractSource(root, { beforeCommit: () => { throw new Error("interrupt"); } }),
      /interrupt/,
    );
    const auditEntries = existsSync(join(root, "audit")) ? readdirSync(join(root, "audit")) : [];
    assert.ok(!auditEntries.some((entry) => entry.startsWith(".tmp-design-")));
    assert.equal(existsSync(join(root, "audit", "design")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects overwrite by default and succeeds only with --overwrite", () => {
  const root = makeDesignSourcePackage();
  try {
    let result = spawnSync("node", [CLI, "--package", root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    result = spawnSync("node", [CLI, "--package", root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /已存在|overwrite/);
    result = spawnSync("node", [CLI, "--package", root, "--overwrite"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, "audit", "design", "contract-source.json"), "utf8")).source_version, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
