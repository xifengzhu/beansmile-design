import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import {
  LOCKED_SECTIONS,
  designContractDigest,
  parseDesignDocument,
  proposedContractIssues,
} from "../lib/design-document.mjs";
import { buildContractSource } from "../lib/design-source.mjs";

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
