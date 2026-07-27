import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import {
  LOCKED_SECTIONS,
  approvedContractIssues,
  designContractDigest,
  implementationReadyIssues,
  parseDesignDocument,
  proposedContractIssues,
} from "../lib/design-document.mjs";
import { buildContractSource, buildDeliverySource } from "../lib/design-source.mjs";
import { sha256File } from "../lib/hash.mjs";
import { hardenedGate } from "../lib/context.mjs";
import { resolveManifest } from "../lib/manifests.mjs";
import { makeBoundDesignPackage, makeReviewedDesignPackage } from "./design-delivery-fixture.mjs";

const CLI = resolve(import.meta.dirname, "..", "check-design-document.mjs");

function makeDesignSourcePackage() {
  const root = mkdtempSync(join(tmpdir(), "design-document-"));
  const context = {
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
  writeFileSync(join(root, "context.yaml"), yaml.dump(context));
  writeFileSync(join(root, "brief.md"), "# Brief\n\n采购方需要提交询价。\n");
  writeFileSync(join(root, "flows.md"), `# 核心任务流

- \`flow\`: \`提交询价\`

# 页面地图

- \`page_id\`: \`home\`
- \`route\`: \`/\`
`);
  writeFileSync(join(root, "decisions.md"), "# Decisions\n\n暂无新增决策。\n");
  return root;
}

function documentBody({ phase = "proposed_contract", sourceDigest, contractDigest = "0".repeat(64) } = {}) {
  return `---
phase: ${phase}
artifact_version: "1"
contract_revision: 1
contract_digest: "${contractDigest}"
contract_source_digest: "${sourceDigest}"
platforms: [web]
generated_at: "2026-07-27T00:00:00Z"
---

# 第一部分：设计契约

## 目标与边界

技术栈未指定。范围是询价体验，不含后台实现。

## 用户、任务与成功标准

- \`flow\`: \`提交询价\`
- 采购方能够看到成功反馈。

## 信息架构与路由

### 首页

- \`page_id\`: \`home\`
- \`route\`: \`/\`

## 页面规格

### 首页

- \`page_id\`: \`home\`
- 按内容、表单、反馈顺序展示。

## 状态规格

- \`page_id\`: \`home\`
- \`states\`: \`normal,loading,empty,error,success,disabled,focus\`

## 响应式与平台适配

Web 小屏重排为单列，大屏保持清晰阅读顺序。

## 组件与内容约束

表单负责输入，反馈区域负责提交结果，使用真实业务内容。

## 视觉目标与品牌约束

层级清晰、密度克制，视觉方向由后续阶段探索，不预填令牌值。

## 内容与资源需求

需要可识别的图标与清晰替代文本；具体资源由视觉阶段确认。

## 无障碍与开发验收

支持语义结构、键盘、可见焦点、可访问名称、对比度、重排和触控目标。

## 决策、假设、例外与边界

沿用已冻结决策；未确认事项保持为显式假设。
`;
}

function validDocument(root, manifest) {
  const provisional = documentBody({ sourceDigest: manifest.contract_source_digest });
  const digest = designContractDigest(parseDesignDocument(provisional));
  const markdown = documentBody({ sourceDigest: manifest.contract_source_digest, contractDigest: digest });
  writeFileSync(join(root, "Design.md"), markdown);
  return markdown;
}

function setup() {
  const root = makeDesignSourcePackage();
  const manifest = buildContractSource(root);
  const markdown = validDocument(root, manifest);
  return { root, manifest, markdown };
}

test("structured parser finds all locked headings and computes a stable digest", () => {
  const { root, manifest, markdown } = setup();
  try {
    const parsed = parseDesignDocument(markdown);
    assert.equal(parsed.frontmatter.phase, "proposed_contract");
    assert.deepEqual(parsed.lockedHeadings, LOCKED_SECTIONS);
    assert.equal(parsed.implementationNodes.length, 0);
    assert.match(designContractDigest(parsed), /^[a-f0-9]{64}$/);
    assert.equal(designContractDigest(parseDesignDocument(markdown.replace("\n## 目标", "\n\n## 目标"))), designContractDigest(parsed));
    assert.deepEqual(proposedContractIssues(root, parsed, manifest), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("proposed validation rejects structure, closure, placeholders, and invented facts", () => {
  const mutations = [
    ["missing heading", (md) => md.replace(/## 响应式与平台适配[\s\S]*?(?=\n## 组件与内容约束)/, ""), /缺少章节|响应式与平台适配/],
    ["duplicate heading", (md) => `${md}\n## 目标与边界\n重复。\n`, /重复章节|目标与边界/],
    ["implementation section", (md) => `${md}\n# 第二部分：实施规格\n\n## 已选视觉方向\n方向。\n`, /第二部分|实施规格/],
    ["unknown flow", (md) => md.replace("`提交询价`", "`删除账户`") , /flow|任务/],
    ["missing page spec", (md) => md.replace(/## 页面规格[\s\S]*?(?=\n## 状态规格)/, "## 页面规格\n\n缺少页面登记。\n"), /页面规格.*home|home.*页面规格/],
    ["unknown page", (md) => md.replace("`page_id`: `home`", "`page_id`: `admin`"), /未知页面|页面.*admin|admin.*页面/],
    ["missing state", (md) => md.replace(",focus`", "`"), /focus|状态/],
    ["placeholder", (md) => md.replace("沿用已冻结决策", "TODO 稍后决定"), /TODO|占位/],
    ["invented token", (md) => md.replace("不预填令牌值", "主色为 #6633ff"), /token|令牌|颜色值/],
    ["invented asset", (md) => md.replace("具体资源由视觉阶段确认", "使用 `assets/hero.png`"), /assets\/hero\.png|资源路径/],
    ["invalid phase", (md) => md.replace("phase: proposed_contract", "phase: approved_contract"), /phase/],
    ["platform drift", (md) => md.replace("platforms: [web]", "platforms: [ios]"), /platforms/],
    ["unknown root section", (md) => `${md}\n# 未授权附录\n\n新增事实。\n`, /未知一级章节|未授权附录/],
    ["invented framework", (md) => md.replace("技术栈未指定。", "使用 React 和 GraphQL 实现。"), /技术栈|React|GraphQL/],
    ["digest mismatch", (md) => md.replace(/contract_digest: "[a-f0-9]{64}"/, `contract_digest: "${"f".repeat(64)}"`), /contract_digest/],
  ];

  for (const [name, mutate, expected] of mutations) {
    const { root, manifest, markdown } = setup();
    try {
      const changed = mutate(markdown);
      writeFileSync(join(root, "Design.md"), changed);
      const issues = proposedContractIssues(root, parseDesignDocument(changed), manifest);
      assert.ok(issues.some((issue) => expected.test(issue)), `${name}: ${issues.join("\n")}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("proposed validation checks source drift before accepting the document", () => {
  const { root, manifest, markdown } = setup();
  try {
    writeFileSync(join(root, "flows.md"), "drift");
    const issues = proposedContractIssues(root, parseDesignDocument(markdown), manifest);
    assert.ok(issues.some((issue) => /flows\.md/.test(issue)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI accepts a closed proposed contract and fails after source drift", () => {
  const { root } = setup();
  try {
    let result = spawnSync("node", [CLI, "--package", root, "--phase", "proposed_contract"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(root, "brief.md"), `${readFileSync(join(root, "brief.md"), "utf8")}drift\n`);
    result = spawnSync("node", [CLI, "--package", root, "--phase", "proposed_contract"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /brief\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const IMPLEMENTATION_SECTIONS = [
  "已选视觉方向",
  "设计令牌",
  "组件实施契约",
  "资源清单",
  "页面与原型映射",
  "开发验收用例",
  "评审、例外与人工验证",
];

function implementationMarkdown(root, source) {
  const approved = readFileSync(join(root, "Design.md"), "utf8");
  const manifestSha = sha256File(join(root, "audit", "delivery", "source-manifest.json"));
  const frontmatter = approved
    .replace("phase: approved_contract", "phase: implementation_ready")
    .replace('artifact_version: "1"', 'artifact_version: "2"')
    .replace(
      "platforms: [web]",
      `realizes_prototype_version: "3"\nsource_manifest_digest: "${manifestSha}"\nsource_bundle_digest: "${source.source_bundle_digest}"\nplatforms: [web]`,
    );
  return [
    frontmatter,
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
    "### 首页",
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

function finalizedPackage(options = {}) {
  const pkg = makeReviewedDesignPackage(options);
  const source = buildDeliverySource(pkg.root);
  const markdown = implementationMarkdown(pkg.root, source);
  writeFileSync(join(pkg.root, "Design.md"), markdown);
  const artifact = {
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
  return { ...pkg, source, markdown, artifact };
}

test("implementation-ready Design.md closes every reviewed implementation source", () => {
  const pkg = finalizedPackage();
  try {
    const parsed = parseDesignDocument(pkg.markdown);
    assert.deepEqual(
      parsed.implementationNodes.filter((node) => node.type === "heading" && node.depth === 2).map((node) => node.children[0].value),
      IMPLEMENTATION_SECTIONS,
    );
    assert.deepEqual(implementationReadyIssues(pkg.root, parsed, pkg.source, pkg.artifact), []);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("implementation-ready validation rejects contract mutation and incomplete or invented handoff facts", () => {
  const pkg = finalizedPackage();
  try {
    const mutations = [
      ["locked AST", (md) => md.replace("密度克制", "密度宽松"), /第一部分|contract digest|契约/],
      ["locked source bytes", (md) => md.replace("\n## 目标与边界", "\n\n## 目标与边界"), /第一部分.*字节|原文/],
      ...IMPLEMENTATION_SECTIONS.map((heading) => [
        `missing ${heading}`,
        (md) => md.replace(new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |$)`), ""),
        new RegExp(`缺少章节|${heading}`),
      ]),
      ["old prototype", (md) => md.replace('realizes_prototype_version: "3"', 'realizes_prototype_version: "2"'), /prototype|realizes/],
      ["old source bundle", (md) => md.replace(pkg.source.source_bundle_digest, "f".repeat(64)), /source_bundle/],
      ["old source manifest", (md) => md.replace(/source_manifest_digest: "[a-f0-9]{64}"/, `source_manifest_digest: "${"f".repeat(64)}"`), /source_manifest/],
      ["unknown direction", (md) => md.replace("`direction_id`: `D3`", "`direction_id`: `D9`"), /direction|方向/],
      ["unknown token", (md) => md.replace("semantic.color.primary", "semantic.color.ghost"), /token/],
      ["unknown component", (md) => md.replace("inquiry-form", "invented-widget"), /component|组件/],
      ["unknown asset", (md) => md.replace("prototype/assets/logo.png", "prototype/assets/ghost.png"), /asset|资源/],
      ["path traversal", (md) => md.replace("prototype/assets/logo.png", "../secret.png"), /越界|路径|asset/],
      ["unknown page", (md) => md.replace("- `page_id`: `home`\n- `prototype_path`", "- `page_id`: `admin`\n- `prototype_path`"), /page|页面/],
      ["unknown prototype", (md) => md.replace("prototype/index.html", "prototype/admin.html"), /prototype|页面/],
      ["unknown flow", (md) => md.replace("- `flow`: `提交询价`\n- `scenario_id`", "- `flow`: `删除账户`\n- `scenario_id`"), /flow/],
      ["unknown scenario", (md) => md.replace("inquiry-success", "inquiry-ghost"), /scenario/],
      ["unknown decision", (md) => md.replace("direction-D3", "direction-D9"), /decision/],
      ["unknown finding", (md) => md.replace("visual-warning-1", "visual-warning-9"), /finding/],
      ["no manual verification", (md) => md.replace(/- `manual_check`: `[^`]+`\n/, ""), /manual|人工/],
      ["business conclusion", (md) => `${md}\n- \`business_conclusion\`: \`转化率提升 30%\`\n`, /business_conclusion|业务结论|未知 marker/],
      ["hyphenated business conclusion", (md) => `${md}\n- \`business-conclusion\`: \`转化率提升 30%\`\n`, /business-conclusion|业务结论|未知 marker/],
      ["placeholder", (md) => md.replace("screen-reader-announcement-order", "TODO"), /TODO|占位/],
      ["version jump", (md) => md.replace('artifact_version: "2"', 'artifact_version: "3"'), /artifact_version/],
    ];
    for (const [name, mutate, expected] of mutations) {
      const changed = mutate(pkg.markdown);
      writeFileSync(join(pkg.root, "Design.md"), changed);
      const artifact = { ...pkg.artifact, sha256: sha256File(join(pkg.root, "Design.md")) };
      const issues = implementationReadyIssues(pkg.root, parseDesignDocument(changed), pkg.source, artifact);
      assert.ok(issues.some((issue) => expected.test(issue)), `${name}: ${issues.join("\n")}`);
    }
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("implementation-ready validation rejects conflicting confirmed and token directions", () => {
  const pkg = finalizedPackage({ chosenDirection: "D1", tokenDirection: "D3" });
  try {
    const issues = implementationReadyIssues(pkg.root, parseDesignDocument(pkg.markdown), pkg.source, pkg.artifact);
    assert.ok(issues.some((issue) => /direction|方向/.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("component markers cannot resolve to ids found only in comments or script text", () => {
  const pkg = finalizedPackage({
    prototypeExtra: '<!-- <div id="comment-only"></div> --><script>const template = \'<div id="script-only"></div>\';</script>',
  });
  try {
    const changed = pkg.markdown.replace(
      "- `component_id`: `inquiry-form`",
      "- `component_id`: `comment-only`\n- `component_id`: `script-only`",
    );
    writeFileSync(join(pkg.root, "Design.md"), changed);
    const artifact = { ...pkg.artifact, sha256: sha256File(join(pkg.root, "Design.md")) };
    const issues = implementationReadyIssues(pkg.root, parseDesignDocument(changed), pkg.source, artifact);
    assert.ok(issues.some((issue) => /comment-only/.test(issue)), issues.join("\n"));
    assert.ok(issues.some((issue) => /script-only/.test(issue)), issues.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("ordinary prose with two inline code spans is not treated as a machine marker", () => {
  const pkg = finalizedPackage();
  try {
    const changed = pkg.markdown.replace(
      "- `token`: `semantic.color.primary`",
      "- `token`: `semantic.color.primary`\n- 使用 `semantic.color.primary` 映射到 `#14532d`，供按钮使用。",
    );
    writeFileSync(join(pkg.root, "Design.md"), changed);
    const artifact = { ...pkg.artifact, sha256: sha256File(join(pkg.root, "Design.md")) };
    assert.deepEqual(implementationReadyIssues(pkg.root, parseDesignDocument(changed), pkg.source, artifact), []);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("approved and implementation-ready CLI phases validate their own lifecycle state", () => {
  const approved = makeBoundDesignPackage();
  try {
    const parsed = parseDesignDocument(readFileSync(join(approved.root, "Design.md"), "utf8"));
    assert.deepEqual(approvedContractIssues(approved.root, parsed), []);
    let result = spawnSync("node", [CLI, "--package", approved.root, "--phase", "approved_contract"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    result = spawnSync("node", [CLI, "--package", approved.root, "--phase", "proposed_contract"], { encoding: "utf8" });
    assert.equal(result.status, 1);
  } finally {
    rmSync(approved.root, { recursive: true, force: true });
  }

  const final = finalizedPackage();
  try {
    let result = spawnSync("node", [CLI, "--package", final.root, "--phase", "implementation_ready"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const finalContext = structuredClone(final.context);
    finalContext.artifacts.design_document = final.artifact;
    writeFileSync(join(final.root, "context.yaml"), yaml.dump(finalContext));
    result = spawnSync("node", [CLI, "--package", final.root, "--phase", "implementation_ready"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(final.root, "audit", "results.json"), "{}\n");
    result = spawnSync("node", [CLI, "--package", final.root, "--phase", "implementation_ready"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /results\.json|source|来源/);
  } finally {
    rmSync(final.root, { recursive: true, force: true });
  }
});

test("approved validation rejects a forged contract lock even when context follows its file hash", () => {
  const pkg = makeBoundDesignPackage();
  try {
    const lockPath = join(pkg.root, "audit", "design", "contract-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.lock_digest = "f".repeat(64);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const contextPath = join(pkg.root, "context.yaml");
    const ctx = yaml.load(readFileSync(contextPath, "utf8"));
    ctx.confirmations.flows.contract_lock_sha256 = sha256File(lockPath);
    writeFileSync(contextPath, yaml.dump(ctx));

    const parsed = parseDesignDocument(readFileSync(join(pkg.root, "Design.md"), "utf8"));
    assert.ok(approvedContractIssues(pkg.root, parsed).some((issue) => /lock_digest/.test(issue)));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("finalize patch gate binds every artifact field to the validated Design.md", () => {
  const pkg = finalizedPackage();
  try {
    const manifest = resolveManifest("design_specification", "finalize");
    const gate = (artifact) => hardenedGate(manifest, pkg.context, {
      patch: { artifacts: { design_document: artifact } },
      packageRoot: pkg.root,
    });
    assert.equal(gate(pkg.artifact).ok, true);
    const invalidValues = {
      path: "other.md",
      artifact_version: "9",
      phase: "approved_contract",
      contract_revision: 99,
      contract_digest: "f".repeat(64),
      contract_source_digest: "f".repeat(64),
      source_manifest_digest: "f".repeat(64),
      source_bundle_digest: "f".repeat(64),
      realizes_prototype_version: "2",
      sha256: "f".repeat(64),
      updated_by: "other_skill",
    };
    for (const [field, value] of Object.entries(invalidValues)) {
      const result = gate({ ...pkg.artifact, [field]: value });
      assert.equal(result.ok, false, field);
      assert.ok(result.reasons.some((reason) => reason.includes(field) || /artifact_version/.test(reason)), `${field}: ${result.reasons.join("\n")}`);
    }

    const changed = pkg.markdown.replace("密度克制", "密度宽松");
    writeFileSync(join(pkg.root, "Design.md"), changed);
    const malformedArtifact = { ...pkg.artifact, sha256: sha256File(join(pkg.root, "Design.md")) };
    const malformed = gate(malformedArtifact);
    assert.equal(malformed.ok, false);
    assert.ok(malformed.reasons.some((reason) => /第一部分|contract|契约/.test(reason)), malformed.reasons.join("\n"));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});
