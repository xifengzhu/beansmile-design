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
import { buildContractSource } from "../lib/design-source.mjs";
import { designContractDigest, parseDesignDocument } from "../lib/design-document.mjs";
import { checkDesignContractBinding, sealDesignContract } from "../lib/design-contract.mjs";
import { hardenedGate } from "../lib/context.mjs";
import { sha256File } from "../lib/hash.mjs";
import { resolveManifest } from "../lib/manifests.mjs";

const DIRECTOR = resolve(import.meta.dirname, "..", "director-advance.mjs");
const DIFF_GATE = resolve(import.meta.dirname, "..", "check-diff-gate.mjs");

const CONTENT = {
  "目标与边界": "技术栈未指定。范围是询价体验，不含后台实现。",
  "用户、任务与成功标准": "- `flow`: `提交询价`\n- 采购方能够看到成功反馈。",
  "信息架构与路由": "### 首页\n\n- `page_id`: `home`\n- `route`: `/`",
  "页面规格": "### 首页\n\n- `page_id`: `home`\n- 按内容、表单、反馈顺序展示。",
  "状态规格": "- `page_id`: `home`\n- `states`: `normal,loading,empty,error,success,disabled,focus`",
  "响应式与平台适配": "Web 小屏重排为单列，大屏保持清晰阅读顺序。",
  "组件与内容约束": "表单负责输入，反馈区域负责提交结果，使用真实业务内容。",
  "视觉目标与品牌约束": "层级清晰、密度克制，视觉方向由后续阶段探索，不预填令牌值。",
  "内容与资源需求": "需要可识别的图标与清晰替代文本；具体资源由视觉阶段确认。",
  "无障碍与开发验收": "支持语义结构、键盘、可见焦点、可访问名称、对比度、重排和触控目标。",
  "决策、假设、例外与边界": "沿用已冻结决策；未确认事项保持为显式假设。",
};

function baseContext(mode = "professional") {
  return {
    project: {
      name: "询价平台",
      mode,
      task_type: "new_design",
      reference_system: "none",
      industry: "general",
      platforms: ["web"],
      package_format_version: 3,
      delivery_outputs: ["design_specification", ...(mode === "professional" ? ["design_presentation"] : [])],
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
    confirmations: {
      requirements: { summary: "确认需求", user_reply: "确认" },
      ...(mode === "quick" ? { mode: { summary: "确认快速模式", user_reply: "确认" } } : {}),
    },
    stage: "ux",
  };
}

function markdown(sourceDigest, digest = "0".repeat(64), phase = "proposed_contract") {
  const sections = Object.entries(CONTENT)
    .map(([heading, content]) => `## ${heading}\n\n${content}`)
    .join("\n\n");
  return `---
phase: ${phase}
artifact_version: "1"
contract_revision: 1
contract_digest: "${digest}"
contract_source_digest: "${sourceDigest}"
platforms: [web]
generated_at: "2026-07-27T00:00:00Z"
---

# 第一部分：设计契约

${sections}
`;
}

function setup(mode = "professional") {
  const root = mkdtempSync(join(tmpdir(), "design-contract-"));
  const ctx = baseContext(mode);
  writeFileSync(join(root, "context.yaml"), yaml.dump(ctx));
  writeFileSync(join(root, "brief.md"), "# Brief\n\n采购方需要提交询价。\n");
  writeFileSync(join(root, "flows.md"), "# Flows\n\n- `flow`: `提交询价`\n\n# Pages\n\n- `page_id`: `home`\n- `route`: `/`\n");
  writeFileSync(join(root, "decisions.md"), "# Decisions\n\n暂无新增决策。\n");
  const source = buildContractSource(root);
  const provisional = markdown(source.contract_source_digest);
  const digest = designContractDigest(parseDesignDocument(provisional));
  const finalMarkdown = markdown(source.contract_source_digest, digest);
  writeFileSync(join(root, "Design.md"), finalMarkdown);
  const provisionalPatch = {
    artifacts: {
      design_document: {
        path: "Design.md",
        artifact_version: "1",
        phase: "proposed_contract",
        contract_revision: 1,
        contract_digest: digest,
        contract_source_digest: source.contract_source_digest,
        sha256: sha256File(join(root, "Design.md")),
        updated_by: "design_specification",
      },
    },
  };
  return { root, ctx, source, digest, provisionalPatch, markdown: finalMarkdown };
}

function seal(pkg) {
  return sealDesignContract(pkg.root, pkg.ctx, {
    summary: "确认页面、流程与设计契约",
    userReply: "确认，按此执行",
    provisionalPatch: pkg.provisionalPatch,
    now: "2026-07-27T00:00:00Z",
  });
}

test("seal atomically approves the same locked contract and records verbatim confirmation", () => {
  const pkg = setup();
  try {
    const result = seal(pkg);
    assert.equal(result.context.artifacts.design_document.phase, "approved_contract");
    assert.equal(result.context.confirmations.flows.user_reply, "确认，按此执行");
    assert.equal(result.context.confirmations.flows.design_contract_digest, result.lock.contract_digest);
    assert.equal(result.context.confirmations.flows.contract_lock_sha256, sha256File(join(pkg.root, "audit", "design", "contract-lock.json")));
    assert.equal(result.lock.downstream_absent, true);
    assert.equal(result.lock.sealed_at_stage, "ux");
    assert.equal(designContractDigest(parseDesignDocument(result.markdown)), result.lock.contract_digest);
    assert.equal(parseDesignDocument(result.markdown).frontmatter.phase, "approved_contract");
    assert.equal(yaml.load(readFileSync(join(pkg.root, "context.yaml"), "utf8")).artifacts.design_document.sha256, sha256File(join(pkg.root, "Design.md")));
    assert.deepEqual(checkDesignContractBinding(pkg.root, result.context), []);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("seal rejects invalid authority/order/source inputs without changing owned files", () => {
  const cases = [
    ["missing reply", () => {}, { userReply: "" }, /user reply|用户答复/i],
    ["non proposed", (pkg) => {
      const changed = pkg.markdown.replace("phase: proposed_contract", "phase: approved_contract");
      writeFileSync(join(pkg.root, "Design.md"), changed);
      pkg.provisionalPatch.artifacts.design_document.sha256 = sha256File(join(pkg.root, "Design.md"));
    }, {}, /proposed_contract|phase/],
    ["invalid patch", (pkg) => { pkg.provisionalPatch.stage = "visual"; }, {}, /补丁|越权|stage/],
    ["source drift", (pkg) => { writeFileSync(join(pkg.root, "flows.md"), "drift"); }, {}, /flows\.md|漂移/],
    ["body mutation", (pkg) => { writeFileSync(join(pkg.root, "Design.md"), pkg.markdown.replace("密度克制", "密度宽松")); }, {}, /contract_digest|sha256|补丁/],
    ["active tokens", (pkg) => {
      pkg.ctx.artifacts.tokens = { path: "design-tokens.json", artifact_version: "1", updated_by: "visual_system" };
      writeFileSync(join(pkg.root, "context.yaml"), yaml.dump(pkg.ctx));
    }, {}, /下游|tokens/],
    ["snapshot", (pkg) => { mkdirSync(join(pkg.root, "audit", "snapshots", "1"), { recursive: true }); }, {}, /snapshot|快照/],
    ["finding", (pkg) => {
      mkdirSync(join(pkg.root, "audit", "findings"), { recursive: true });
      writeFileSync(join(pkg.root, "audit", "findings", "visual-1.yaml"), "findings: []\n");
    }, {}, /finding/],
    ["wrong stage", (pkg) => {
      pkg.ctx.stage = "visual";
      writeFileSync(join(pkg.root, "context.yaml"), yaml.dump(pkg.ctx));
    }, {}, /stage.*ux|ux.*stage/i],
    ["old lock", (pkg) => { writeFileSync(join(pkg.root, "audit", "design", "contract-lock.json"), "{}\n"); }, {}, /lock.*已存在|旧.*lock|contract-lock/],
  ];

  for (const [name, mutate, optionOverrides, expected] of cases) {
    const pkg = setup();
    try {
      mutate(pkg);
      const beforeDesign = readFileSync(join(pkg.root, "Design.md"));
      const beforeContext = readFileSync(join(pkg.root, "context.yaml"));
      const lockPath = join(pkg.root, "audit", "design", "contract-lock.json");
      const beforeLock = existsSync(lockPath) ? readFileSync(lockPath) : null;
      assert.throws(() => sealDesignContract(pkg.root, pkg.ctx, {
        summary: "确认页面、流程与设计契约",
        userReply: "确认",
        provisionalPatch: pkg.provisionalPatch,
        now: "2026-07-27T00:00:00Z",
        ...optionOverrides,
      }), expected, name);
      assert.deepEqual(readFileSync(join(pkg.root, "Design.md")), beforeDesign, `${name}: Design.md changed`);
      assert.deepEqual(readFileSync(join(pkg.root, "context.yaml")), beforeContext, `${name}: context changed`);
      if (beforeLock) assert.deepEqual(readFileSync(lockPath), beforeLock, `${name}: lock changed`);
      else assert.equal(existsSync(lockPath), false, `${name}: lock created`);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("Visual and Prototype patches must bind the active approved lock", () => {
  const pkg = setup();
  try {
    const sealed = seal(pkg);
    const lockSha = sealed.context.confirmations.flows.contract_lock_sha256;
    const visualManifest = resolveManifest("visual_system");
    const visualPatch = {
      artifacts: {
        tokens: {
          path: "design-tokens.json",
          artifact_version: "1",
          design_contract_digest: pkg.digest,
          contract_lock_sha256: lockSha,
          updated_by: "visual_system",
        },
      },
      stage: "visual",
    };
    const visual = hardenedGate(visualManifest, sealed.context, { patch: visualPatch, packageRoot: pkg.root });
    assert.equal(visual.ok, true, visual.reasons.join("\n"));

    const visualContext = {
      ...visual.after,
      confirmations: {
        ...visual.after.confirmations,
        direction: {
          summary: "选择方向",
          user_reply: "选 D1",
          candidates: ["D1", "D2"],
          chosen: "D1",
        },
      },
    };
    const prototypePatch = {
      artifacts: {
        prototype: {
          path: "prototype/index.html",
          artifact_version: "1",
          design_contract_digest: pkg.digest,
          contract_lock_sha256: lockSha,
          updated_by: "html_prototype",
        },
      },
      stage: "prototype",
    };
    const prototype = hardenedGate(resolveManifest("html_prototype"), visualContext, {
      patch: prototypePatch,
      packageRoot: pkg.root,
    });
    assert.equal(prototype.ok, true, prototype.reasons.join("\n"));

    for (const field of ["design_contract_digest", "contract_lock_sha256"]) {
      const badPatch = structuredClone(visualPatch);
      delete badPatch.artifacts.tokens[field];
      const rejected = hardenedGate(visualManifest, sealed.context, { patch: badPatch, packageRoot: pkg.root });
      assert.equal(rejected.ok, false, `missing ${field}`);
    }
    const oldDigest = structuredClone(visualPatch);
    oldDigest.artifacts.tokens.design_contract_digest = "f".repeat(64);
    assert.equal(hardenedGate(visualManifest, sealed.context, { patch: oldDigest, packageRoot: pkg.root }).ok, false);
    const oldLock = structuredClone(visualPatch);
    oldLock.artifacts.tokens.contract_lock_sha256 = "e".repeat(64);
    assert.equal(hardenedGate(visualManifest, sealed.context, { patch: oldLock, packageRoot: pkg.root }).ok, false);

    for (const phase of ["stale", "implementation_ready", "proposed_contract"]) {
      const wrongContext = structuredClone(sealed.context);
      wrongContext.artifacts.design_document.phase = phase;
      if (phase === "stale") wrongContext.artifacts.design_document.stale = true;
      assert.equal(hardenedGate(visualManifest, wrongContext, { patch: visualPatch, packageRoot: pkg.root }).ok, false, phase);
    }

    writeFileSync(join(pkg.root, "audit", "design", "contract-lock.json"), "{}\n");
    assert.equal(hardenedGate(visualManifest, sealed.context, { patch: visualPatch, packageRoot: pkg.root }).ok, false);
    writeFileSync(join(pkg.root, "audit", "design", "contract-lock.json"), "null\n");
    assert.doesNotThrow(() => hardenedGate(visualManifest, sealed.context, { patch: visualPatch, packageRoot: pkg.root }));
    assert.equal(hardenedGate(visualManifest, sealed.context, { patch: visualPatch, packageRoot: pkg.root }).ok, false);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("diff gate CLI passes package root when validating a Visual patch", () => {
  const pkg = setup();
  try {
    const sealed = seal(pkg);
    const patchPath = join(pkg.root, "visual-patch.yaml");
    writeFileSync(patchPath, yaml.dump({
      artifacts: {
        tokens: {
          path: "design-tokens.json",
          artifact_version: "1",
          design_contract_digest: pkg.digest,
          contract_lock_sha256: sealed.context.confirmations.flows.contract_lock_sha256,
          updated_by: "visual_system",
        },
      },
      stage: "visual",
    }));

    const result = spawnSync(process.execPath, [
      DIFF_GATE,
      "--package", pkg.root,
      "--skill", "visual_system",
      "--before", join(pkg.root, "context.yaml"),
      "--patch", patchPath,
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /diff 门禁通过/);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("Director flow confirmation seals version-3 packages and requires the provisional patch", () => {
  const pkg = setup();
  try {
    const patchPath = join(pkg.root, "design-patch.yaml");
    writeFileSync(patchPath, yaml.dump(pkg.provisionalPatch));
    let result = spawnSync("node", [
      DIRECTOR,
      "--package", pkg.root,
      "--confirm", "flows",
      "--summary", "确认页面、流程与设计契约",
      "--reply", "确认，按此执行",
    ], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(existsSync(join(pkg.root, "audit", "design", "contract-lock.json")), false);

    result = spawnSync("node", [
      DIRECTOR,
      "--package", pkg.root,
      "--confirm", "flows",
      "--summary", "确认页面、流程与设计契约",
      "--reply", "确认，按此执行",
      "--design-patch", patchPath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const ctx = yaml.load(readFileSync(join(pkg.root, "context.yaml"), "utf8"));
    assert.equal(ctx.artifacts.design_document.phase, "approved_contract");
    assert.equal(ctx.confirmations.flows.user_reply, "确认，按此执行");
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("quick first prototype transition requires an intact sealed contract", () => {
  const pkg = setup("quick");
  try {
    const before = readFileSync(join(pkg.root, "context.yaml"));
    const result = spawnSync("node", [DIRECTOR, "--package", pkg.root, "--stage", "prototype"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.deepEqual(readFileSync(join(pkg.root, "context.yaml")), before);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});
