import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { buildContractSource } from "../lib/design-source.mjs";
import { sealDesignContract } from "../lib/design-contract.mjs";
import { designContractDigest, parseDesignDocument } from "../lib/design-document.mjs";
import { sha256File } from "../lib/hash.mjs";

const SNAPSHOT = resolve(import.meta.dirname, "..", "snapshot.mjs");
const AGGREGATE = resolve(import.meta.dirname, "..", "aggregate-reviews.mjs");
const DIMENSIONS = ["hierarchy", "rhythm", "typography", "color", "consistency", "content", "brand", "completion"];

const CONTRACT_SECTIONS = {
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

function write(root, path, text) {
  const target = join(root, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, text);
}

function proposedMarkdown(sourceDigest, digest = "0".repeat(64)) {
  const sections = Object.entries(CONTRACT_SECTIONS)
    .map(([heading, content]) => `## ${heading}\n\n${content}`)
    .join("\n\n");
  return `---
phase: proposed_contract
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

export function makeBoundDesignPackage({
  chosenDirection = "D3",
  tokenDirection = "D3",
  prototypeExtra = "",
  initialAssumptions = [],
  initialDecisions = [{ id: "direction-D3", summary: "采用方向 D3", decided_by: "user" }],
  initialExceptions = [],
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "design-delivery-"));
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
    constraints: ["技术栈未指定"],
    assumptions: initialAssumptions,
    decisions: initialDecisions,
    exceptions: initialExceptions,
    artifacts: {
      brief: { path: "brief.md", artifact_version: "1", updated_by: "requirements_research" },
      flows: { path: "flows.md", artifact_version: "1", updated_by: "ux_architecture" },
    },
    confirmations: { requirements: { summary: "确认需求", user_reply: "确认" } },
    stage: "ux",
  };
  write(root, "context.yaml", yaml.dump(ctx));
  write(root, "brief.md", "# Brief\n\n采购方需要提交询价。\n");
  write(root, "flows.md", "# Flows\n\n- `flow`: `提交询价`\n\n# Pages\n\n- `page_id`: `home`\n- `route`: `/`\n");
  write(root, "decisions.md", "# Decisions\n\n选择方向 D3。\n");
  const source = buildContractSource(root);
  const draft = proposedMarkdown(source.contract_source_digest);
  const digest = designContractDigest(parseDesignDocument(draft));
  write(root, "Design.md", proposedMarkdown(source.contract_source_digest, digest));
  const sealed = sealDesignContract(root, ctx, {
    summary: "确认页面、流程与设计契约",
    userReply: "确认，按此执行",
    provisionalPatch: {
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
    },
    now: "2026-07-27T00:00:00Z",
  });
  write(root, "design-tokens.json", `${JSON.stringify({
    direction_id: tokenDirection,
    semantic: { color: { primary: "#14532d" } },
  })}\n`);
  write(root, "prototype/index.html", `<!doctype html><html lang="zh-CN"><body><main><form id="inquiry-form"><button id="submit">提交询价</button><p id="success">成功</p><p id="error">失败</p></form>${prototypeExtra}</main></body></html>\n`);
  write(root, "prototype/assets/logo.png", "logo-png-bytes\n");
  write(root, "prototype/scenarios.json", `${JSON.stringify([
    { id: "inquiry-success", name: "询价成功", kind: "success", flow: "提交询价", page: "index.html", steps: [{ action: "click", selector: "#submit" }, { action: "expect_visible", selector: "#success" }] },
    { id: "inquiry-error", name: "询价失败", kind: "error", flow: "提交询价", page: "index.html", steps: [{ action: "click", selector: "#submit" }, { action: "expect_visible", selector: "#error" }] },
  ], null, 2)}\n`);
  const lockSha = sealed.context.confirmations.flows.contract_lock_sha256;
  const next = {
    ...sealed.context,
    artifacts: {
      ...sealed.context.artifacts,
      tokens: {
        path: "design-tokens.json",
        artifact_version: "1",
        design_contract_digest: digest,
        contract_lock_sha256: lockSha,
        updated_by: "visual_system",
      },
      prototype: {
        path: "prototype",
        artifact_version: "3",
        design_contract_digest: digest,
        contract_lock_sha256: lockSha,
        updated_by: "html_prototype",
      },
    },
    confirmations: {
      ...sealed.context.confirmations,
      direction: {
        summary: "确认方向",
        user_reply: "选择 D3",
        candidates: ["D1", "D3"],
        chosen: chosenDirection,
      },
    },
    stage: "prototype",
  };
  write(root, "context.yaml", yaml.dump(next));
  return { root, context: next, digest, lockSha };
}

function completedFindings(root, version) {
  const scope = yaml.load(readFileSync(join(root, "audit", "snapshots", version, "rules", "review-scope.yaml"), "utf8"));
  const coverage = scope.rule_coverage_template.map((row) => ({
    rule_id: row.rule_id,
    result: row.state === "prefilled_automated" ? row.result : "pass",
    checked_via: row.state === "prefilled_automated" ? row.checked_via : "code",
    evidence: row.state === "prefilled_automated" ? row.evidence : `已检查 ${row.rule_id} 对应实现与截图，当前范围符合要求。`,
  }));
  const shotPath = "audit/screenshots/final.png";
  const shotSha = sha256File(join(root, shotPath));
  const visual = {
    reviewer: "visual",
    artifact_version: version,
    verdict: "pass",
    findings: [{
      id: "visual-warning-1",
      severity: "warning",
      dimension: "completion",
      location: "prototype/index.html",
      evidence: "实测 320px 视口仍需人工复核读屏播报顺序",
      user_impact: "读屏用户可能需要额外确认反馈顺序",
      recommendation: "开发阶段执行读屏人工核查",
    }],
    dimension_reviews: DIMENSIONS.map((dimension, index) => ({
      dimension,
      screenshot: shotPath,
      screenshot_sha256: shotSha,
      region: `主页区域 x=0,y=${index * 10},w=1280`,
      observed: `${dimension} 已检查 ${index + 1} 个关键区域，间距 16px 且文字对比清晰。`,
      judgment: dimension === "completion" ? "warning" : "pass",
    })),
  };
  const standards = {
    reviewer: "standards",
    artifact_version: version,
    verdict: "pass",
    findings: [],
    rule_coverage: coverage,
  };
  write(root, `audit/findings/standards-${version}.yaml`, yaml.dump(standards));
  write(root, `audit/findings/visual-${version}.yaml`, yaml.dump(visual));
}

export function makeReviewedDesignPackage(options = {}) {
  const pkg = makeBoundDesignPackage(options);
  write(pkg.root, "audit/screenshots/final.png", "unique-png-bytes\n");
  const snapshot = spawnSync("node", [SNAPSHOT, "--package", pkg.root, "--version", "3"], { encoding: "utf8" });
  if (snapshot.status !== 0) throw new Error(`snapshot fixture failed: ${snapshot.stderr}`);
  completedFindings(pkg.root, "3");
  write(pkg.root, "decisions.md", `${readFileSync(join(pkg.root, "decisions.md"), "utf8")}\n[finding:visual-warning-1] 已接受，开发阶段执行读屏人工核查。\n`);
  const aggregate = spawnSync("node", [AGGREGATE, "--package", pkg.root, "--version", "3"], { encoding: "utf8" });
  if (aggregate.status !== 0) throw new Error(`aggregate fixture failed: ${aggregate.stderr}`);
  write(pkg.root, "audit/results.json", '{"checks_version":4,"artifact_version":"3"}\n');
  const reviewed = { ...pkg.context, stage: "review" };
  write(pkg.root, "context.yaml", yaml.dump(reviewed));
  return { ...pkg, context: reviewed };
}
