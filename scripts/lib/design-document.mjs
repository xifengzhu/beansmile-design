import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import { canonicalDigest } from "./hash.mjs";
import { verifyContractSource } from "./design-source.mjs";

export const LOCKED_SECTIONS = Object.freeze([
  "目标与边界",
  "用户、任务与成功标准",
  "信息架构与路由",
  "页面规格",
  "状态规格",
  "响应式与平台适配",
  "组件与内容约束",
  "视觉目标与品牌约束",
  "内容与资源需求",
  "无障碍与开发验收",
  "决策、假设、例外与边界",
]);

function textOf(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function withoutPositions(value) {
  if (Array.isArray(value)) return value.map(withoutPositions);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "position")
        .map(([key, child]) => [key, withoutPositions(child)]),
    );
  }
  return value;
}

function partition(nodes, title) {
  const start = nodes.findIndex((node) => node.type === "heading" && node.depth === 1 && textOf(node).trim() === title);
  if (start < 0) return [];
  const next = nodes.findIndex((node, index) => index > start && node.type === "heading" && node.depth === 1);
  return nodes.slice(start, next < 0 ? nodes.length : next);
}

export function parseDesignDocument(markdown) {
  const errors = [];
  let frontmatter = {};
  let body = markdown;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) {
    errors.push("缺 YAML frontmatter");
  } else {
    try {
      frontmatter = yaml.load(match[1]) ?? {};
      if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        errors.push("frontmatter 必须是对象");
        frontmatter = {};
      }
    } catch (error) {
      errors.push(`frontmatter YAML 非法: ${error.message}`);
    }
    body = markdown.slice(match[0].length);
  }
  const tree = fromMarkdown(body);
  const lockedNodes = partition(tree.children, "第一部分：设计契约");
  const implementationNodes = partition(tree.children, "第二部分：实施规格");
  const lockedHeadings = lockedNodes
    .filter((node) => node.type === "heading" && node.depth === 2)
    .map((node) => textOf(node).trim());
  return { frontmatter, tree, lockedNodes, implementationNodes, lockedHeadings, errors, body };
}

export function designContractDigest(parsed) {
  return canonicalDigest(withoutPositions(parsed.lockedNodes));
}

function sectionNodes(parsed, heading) {
  const start = parsed.lockedNodes.findIndex((node) =>
    node.type === "heading" && node.depth === 2 && textOf(node).trim() === heading);
  if (start < 0) return [];
  const next = parsed.lockedNodes.findIndex((node, index) =>
    index > start && node.type === "heading" && node.depth === 2);
  return parsed.lockedNodes.slice(start + 1, next < 0 ? parsed.lockedNodes.length : next);
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function markers(nodes) {
  const entries = [];
  for (const node of nodes) {
    walk(node, (candidate) => {
      if (candidate.type !== "listItem") return;
      const paragraph = candidate.children?.find((child) => child.type === "paragraph");
      const inline = (paragraph?.children ?? []).filter((child) => child.type === "inlineCode");
      if (inline.length >= 2 && /^[a-z_]+$/.test(inline[0].value)) {
        entries.push({ key: inline[0].value, value: inline[1].value });
      }
    });
  }
  return entries;
}

function markerValues(nodes, key) {
  return markers(nodes).filter((entry) => entry.key === key).map((entry) => entry.value);
}

function setDiff(expected, actual) {
  return {
    missing: [...expected].filter((value) => !actual.has(value)).sort(),
    extra: [...actual].filter((value) => !expected.has(value)).sort(),
  };
}

function closureIssues(parsed, root) {
  const issues = [];
  const flowsPath = join(root, "flows.md");
  if (!existsSync(flowsPath)) return ["缺 flows.md，无法做任务/页面闭合"];
  const sourceTree = fromMarkdown(readFileSync(flowsPath, "utf8"));
  const sourceEntries = markers(sourceTree.children);
  const sourceFlows = new Set(sourceEntries.filter((entry) => entry.key === "flow").map((entry) => entry.value));
  const sourcePages = new Set(sourceEntries.filter((entry) => entry.key === "page_id").map((entry) => entry.value));
  if (!sourceFlows.size) issues.push("flows.md 缺 `flow` machine marker");
  if (!sourcePages.size) issues.push("flows.md 缺 `page_id` machine marker");

  const actualFlows = new Set(markerValues(sectionNodes(parsed, "用户、任务与成功标准"), "flow"));
  const flowDiff = setDiff(sourceFlows, actualFlows);
  if (flowDiff.missing.length) issues.push(`Design.md 缺核心 flow: ${flowDiff.missing.join(", ")}`);
  if (flowDiff.extra.length) issues.push(`Design.md 含 flows.md 未知任务 flow: ${flowDiff.extra.join(", ")}`);

  for (const heading of ["信息架构与路由", "页面规格", "状态规格"]) {
    const actualPages = new Set(markerValues(sectionNodes(parsed, heading), "page_id"));
    const pageDiff = setDiff(sourcePages, actualPages);
    if (pageDiff.missing.length) issues.push(`${heading} 缺页面: ${pageDiff.missing.join(", ")}`);
    if (pageDiff.extra.length) issues.push(`${heading} 含未知页面: ${pageDiff.extra.join(", ")}`);
  }

  const stateEntries = markers(sectionNodes(parsed, "状态规格"));
  const statesByPage = new Map();
  let currentPage = null;
  for (const entry of stateEntries) {
    if (entry.key === "page_id") currentPage = entry.value;
    if (entry.key === "states" && currentPage) {
      statesByPage.set(currentPage, new Set(entry.value.split(",").map((value) => value.trim()).filter(Boolean)));
    }
  }
  const requiredStates = ["normal", "loading", "empty", "error", "success", "disabled", "focus"];
  for (const page of sourcePages) {
    const states = statesByPage.get(page) ?? new Set();
    const missing = requiredStates.filter((state) => !states.has(state));
    if (missing.length) issues.push(`页面 ${page} 状态规格缺: ${missing.join(", ")}`);
  }
  return issues;
}

function pathIssues(root, body) {
  const issues = [];
  const candidates = new Set();
  const pattern = /(?:^|[\s`(])([A-Za-z0-9._/-]+\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf|mp4|webm))/gim;
  for (const match of body.matchAll(pattern)) candidates.add(match[1]);
  for (const path of candidates) {
    if (!existsSync(join(root, path))) issues.push(`引用了不存在的资源路径: ${path}`);
  }
  return issues;
}

export function proposedContractIssues(root, parsed, sourceManifest) {
  const issues = [...(parsed.errors ?? []), ...verifyContractSource(root, sourceManifest)];
  if (parsed.frontmatter.phase !== "proposed_contract") issues.push("prepare 的 frontmatter phase 必须为 proposed_contract");
  if (!/^[1-9][0-9]*$/.test(parsed.frontmatter.artifact_version ?? "")) issues.push("artifact_version 必须为正整数字符串");
  if (parsed.frontmatter.contract_revision !== sourceManifest?.contract_revision) issues.push("contract_revision 与 frozen source 不符");
  if (parsed.frontmatter.contract_source_digest !== sourceManifest?.contract_source_digest) issues.push("contract_source_digest 与 frozen source 不符");
  if (!Array.isArray(parsed.frontmatter.platforms) || parsed.frontmatter.platforms.length === 0) issues.push("frontmatter platforms 缺失");
  try {
    const frozenContext = yaml.load(readFileSync(join(root, "audit", "design", "context.yaml"), "utf8"));
    if (JSON.stringify(parsed.frontmatter.platforms) !== JSON.stringify(frozenContext?.project?.platforms)) {
      issues.push("frontmatter platforms 与冻结 context.project.platforms 不符");
    }
  } catch (error) {
    issues.push(`无法读取冻结 context platforms: ${error.message}`);
  }
  if (!parsed.frontmatter.generated_at || Number.isNaN(Date.parse(parsed.frontmatter.generated_at))) issues.push("frontmatter generated_at 非法");

  const h1s = parsed.tree.children
    .filter((node) => node.type === "heading" && node.depth === 1)
    .map((node) => textOf(node).trim());
  if (h1s.filter((title) => title === "第一部分：设计契约").length !== 1) issues.push("必须且只能有一个 # 第一部分：设计契约");
  if (parsed.implementationNodes.length || h1s.includes("第二部分：实施规格")) issues.push("proposed_contract 不得出现第二部分：实施规格");
  const unknownH1s = h1s.filter((title) => !["第一部分：设计契约", "第二部分：实施规格"].includes(title));
  if (unknownH1s.length) issues.push(`Design.md 含未知一级章节: ${unknownH1s.join(", ")}`);

  for (const heading of LOCKED_SECTIONS) {
    const count = parsed.lockedHeadings.filter((value) => value === heading).length;
    if (count === 0) issues.push(`缺少章节: ${heading}`);
    if (count > 1) issues.push(`重复章节: ${heading}`);
  }
  if (JSON.stringify(parsed.lockedHeadings) !== JSON.stringify(LOCKED_SECTIONS)) {
    issues.push("锁定 H2 章节必须按规定顺序且不得增加未知章节");
  }
  for (const heading of LOCKED_SECTIONS) {
    const content = sectionNodes(parsed, heading)
      .filter((node) => node.type !== "heading")
      .map(textOf)
      .join(" ")
      .trim();
    if (!content) issues.push(`空章节: ${heading}`);
  }

  const bodyText = parsed.lockedNodes.map(textOf).join("\n");
  const placeholder = /\b(?:TBD|TODO)\b|lorem\s+ipsum/i.exec(bodyText);
  if (placeholder) issues.push(`禁止占位内容: ${placeholder[0]}`);
  if (!bodyText.includes("技术栈")) issues.push("目标与边界必须明确技术栈事实；未知时写“技术栈未指定”");
  const sourceText = ["brief.md", "flows.md", "decisions.md", "audit/design/context.yaml"]
    .filter((path) => existsSync(join(root, path)))
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");
  const technologyNames = bodyText.match(/\b(?:React|Vue|Angular|Svelte|Next\.js|Nuxt|Rails|Django|Laravel|Tailwind|GraphQL|REST API)\b/gi) ?? [];
  const inventedTechnologies = [...new Set(technologyNames.filter((name) =>
    !sourceText.toLowerCase().includes(name.toLowerCase())))];
  if (inventedTechnologies.length) issues.push(`Design.md 含冻结来源未提供的技术栈/API: ${inventedTechnologies.join(", ")}`);
  if (/#[0-9a-f]{3,8}\b/i.test(bodyText) || /--[a-z0-9-]+\s*:/i.test(bodyText)) {
    issues.push("设计前契约不得虚构 token/颜色值");
  }
  issues.push(...pathIssues(root, parsed.body));
  issues.push(...closureIssues(parsed, root));

  const digest = designContractDigest(parsed);
  if (parsed.frontmatter.contract_digest !== digest) issues.push(`contract_digest 不匹配，重算为 ${digest}`);
  return [...new Set(issues)];
}

export function implementationReadyIssues() {
  return ["implementation_ready 校验尚未启用"];
}
