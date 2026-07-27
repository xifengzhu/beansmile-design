import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseHtml } from "node-html-parser";
import { canonicalDigest, listFilesRecursive, sha256File } from "./hash.mjs";
import { verifyContractSource, verifyDeliverySource } from "./design-source.mjs";
import { collectPrototypePages } from "./pages.mjs";
import { loadScenarios } from "./scenarios.mjs";
import { loadFindingsForVersion } from "./findings.mjs";
import { checkDesignContractBinding } from "./design-contract-binding.mjs";
import { designDocumentArtifactIssues } from "./delivery.mjs";

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

export const IMPLEMENTATION_SECTIONS = Object.freeze([
  "已选视觉方向",
  "设计令牌",
  "组件实施契约",
  "资源清单",
  "页面与原型映射",
  "开发验收用例",
  "评审、例外与人工验证",
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

function partitionSource(body, nodes) {
  if (!nodes.length) return "";
  const start = nodes[0]?.position?.start?.offset;
  const end = nodes.at(-1)?.position?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end) ? body.slice(start, end) : "";
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
  const lockedSource = partitionSource(body, lockedNodes);
  return { frontmatter, tree, lockedNodes, implementationNodes, lockedHeadings, lockedSource, errors, body };
}

export function designContractDigest(parsed) {
  return canonicalDigest(withoutPositions(parsed.lockedNodes));
}

function sectionNodesFrom(nodes, heading) {
  const start = nodes.findIndex((node) =>
    node.type === "heading" && node.depth === 2 && textOf(node).trim() === heading);
  if (start < 0) return [];
  const next = nodes.findIndex((node, index) =>
    index > start && node.type === "heading" && node.depth === 2);
  return nodes.slice(start + 1, next < 0 ? nodes.length : next);
}

function sectionNodes(parsed, heading) {
  return sectionNodesFrom(parsed.lockedNodes, heading);
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
      const children = paragraph?.children ?? [];
      const [keyNode, separator, valueNode] = children;
      const key = keyNode?.type === "inlineCode" ? keyNode.value.trim() : "";
      if (
        children.length === 3
        && key
        && separator?.type === "text"
        && /^\s*:\s*$/.test(separator.value)
        && valueNode?.type === "inlineCode"
      ) {
        entries.push({ key, value: valueNode.value });
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

function loadContext(root, issues) {
  try { return yaml.load(readFileSync(join(root, "context.yaml"), "utf8")); }
  catch (error) { issues.push(`无法读取 context.yaml: ${error.message}`); return null; }
}

function loadApprovedDesign(root, issues) {
  try {
    return yaml.load(readFileSync(join(root, "audit", "delivery", "context.yaml"), "utf8"))?.artifacts?.design_document ?? null;
  } catch (error) {
    issues.push(`无法读取冻结 delivery context: ${error.message}`);
    return null;
  }
}

function rootHeadings(parsed) {
  return parsed.tree.children
    .filter((node) => node.type === "heading" && node.depth === 1)
    .map((node) => textOf(node).trim());
}

function safeRelativePath(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path)) return null;
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

export function approvedContractIssues(rootPath, parsed) {
  const root = resolve(rootPath);
  const issues = [...(parsed.errors ?? [])];
  const ctx = loadContext(root, issues);
  if (parsed.frontmatter.phase !== "approved_contract") issues.push("approved 校验要求 frontmatter phase=approved_contract");
  if (parsed.implementationNodes.length || rootHeadings(parsed).includes("第二部分：实施规格")) {
    issues.push("approved_contract 不得出现第二部分：实施规格");
  }
  if (JSON.stringify(parsed.lockedHeadings) !== JSON.stringify(LOCKED_SECTIONS)) issues.push("approved contract 的锁定章节结构不完整");
  const digest = designContractDigest(parsed);
  if (parsed.frontmatter.contract_digest !== digest) issues.push("approved contract_digest 与第一部分 AST 不符");
  if (!parsed.frontmatter.approved_at || Number.isNaN(Date.parse(parsed.frontmatter.approved_at))) issues.push("approved_at 非法或缺失");
  issues.push(...checkDesignContractBinding(root, ctx));
  return [...new Set(issues)];
}

function implementationHeadings(parsed) {
  return parsed.implementationNodes
    .filter((node) => node.type === "heading" && node.depth === 2)
    .map((node) => textOf(node).trim());
}

function flattenTokens(value, prefix = [], out = new Set()) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenTokens(child, [...prefix, key], out);
  } else if (prefix.length) {
    out.add(prefix.join("."));
  }
  return out;
}

function compareMarkerSet(issues, label, expectedValues, actualValues) {
  const diff = setDiff(new Set(expectedValues), new Set(actualValues));
  if (diff.missing.length) issues.push(`${label} 缺失: ${diff.missing.join(", ")}`);
  if (diff.extra.length) issues.push(`${label} 含未知值: ${diff.extra.join(", ")}`);
}

function htmlComponentIds(root) {
  const ids = new Set();
  for (const page of collectPrototypePages(root)) {
    const document = parseHtml(readFileSync(page.file, "utf8"));
    for (const attribute of ["id", "data-component-id"]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        const id = element.getAttribute(attribute)?.trim();
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

function assetPaths(root) {
  const dir = join(root, "prototype", "assets");
  if (!existsSync(dir)) return [];
  return listFilesRecursive(dir)
    .filter((path) => !path.toLowerCase().endsWith(".html"))
    .map((path) => `prototype/assets/${path}`);
}

export function implementationReadyIssues(rootPath, parsed, sourceManifest, artifact = null) {
  const root = resolve(rootPath);
  const issues = [...(parsed.errors ?? []), ...verifyDeliverySource(root, sourceManifest, { allowFinalDesign: true })];
  const ctx = loadContext(root, issues);
  const activeDesign = ctx?.artifacts?.design_document;
  const currentDesign = loadApprovedDesign(root, issues);
  const prototypeVersion = ctx?.artifacts?.prototype?.artifact_version;
  if (parsed.frontmatter.phase !== "implementation_ready") issues.push("finalize 的 frontmatter phase 必须为 implementation_ready");
  if (!currentDesign) issues.push("冻结 delivery context 缺 approved Design.md artifact 登记");
  else {
    const expectedVersion = String(Number(currentDesign.artifact_version) + 1);
    if (parsed.frontmatter.artifact_version !== expectedVersion) issues.push(`artifact_version 必须从 ${currentDesign.artifact_version} 递增到 ${expectedVersion}`);
    if (parsed.frontmatter.contract_revision !== currentDesign.contract_revision) issues.push("finalize 不得改变 contract_revision");
    if (parsed.frontmatter.contract_digest !== currentDesign.contract_digest) issues.push("finalize 不得改变 contract digest");
    if (parsed.frontmatter.contract_source_digest !== currentDesign.contract_source_digest) issues.push("finalize 不得改变 contract_source_digest");
  }
  if (parsed.frontmatter.realizes_prototype_version !== prototypeVersion) issues.push("realizes_prototype_version 与当前 prototype 不符");
  if (parsed.frontmatter.source_bundle_digest !== sourceManifest?.source_bundle_digest) issues.push("source_bundle_digest 与冻结 delivery source 不符");
  const sourcePath = join(root, "audit", "delivery", "source-manifest.json");
  if (!existsSync(sourcePath)) issues.push("缺 audit/delivery/source-manifest.json");
  else if (parsed.frontmatter.source_manifest_digest !== sha256File(sourcePath)) issues.push("source_manifest_digest 与 delivery source 文件不符");

  const snapshotDesignPath = join(root, "audit", "snapshots", String(prototypeVersion), "Design.md");
  if (!existsSync(snapshotDesignPath)) issues.push("当前 snapshot 缺 approved Design.md");
  else {
    const snapshotParsed = parseDesignDocument(readFileSync(snapshotDesignPath, "utf8"));
    const snapshotDigest = designContractDigest(snapshotParsed);
    if (snapshotParsed.frontmatter.phase !== "approved_contract" || snapshotParsed.implementationNodes.length) issues.push("snapshot Design.md 不是纯 approved contract");
    if (designContractDigest(parsed) !== snapshotDigest) issues.push("第一部分设计契约 AST 相对 approved snapshot 发生变化");
    if (parsed.lockedSource !== snapshotParsed.lockedSource) issues.push("第一部分设计契约原文字节相对 approved snapshot 发生变化");
    if (parsed.frontmatter.contract_digest !== snapshotDigest) issues.push("final contract digest 与 approved snapshot 不符");
  }

  const h1s = rootHeadings(parsed);
  if (JSON.stringify(h1s) !== JSON.stringify(["第一部分：设计契约", "第二部分：实施规格"])) {
    issues.push("implementation_ready 必须且只能包含设计契约与实施规格两个一级章节");
  }
  const headings = implementationHeadings(parsed);
  for (const heading of IMPLEMENTATION_SECTIONS) {
    const count = headings.filter((value) => value === heading).length;
    if (count === 0) issues.push(`实施规格缺少章节: ${heading}`);
    if (count > 1) issues.push(`实施规格重复章节: ${heading}`);
    const content = sectionNodesFrom(parsed.implementationNodes, heading).map(textOf).join(" ").trim();
    if (!content) issues.push(`实施规格空章节: ${heading}`);
  }
  if (JSON.stringify(headings) !== JSON.stringify(IMPLEMENTATION_SECTIONS)) issues.push("实施规格 H2 必须按规定顺序且不得增加未知章节");
  const implementationText = parsed.implementationNodes.map(textOf).join("\n");
  const placeholder = /\b(?:TBD|TODO)\b|lorem\s+ipsum/i.exec(implementationText);
  if (placeholder) issues.push(`实施规格禁止占位内容: ${placeholder[0]}`);

  const allImplementationMarkers = markers(parsed.implementationNodes);
  const allowedKeys = new Set([
    "direction_id", "token", "component_id", "asset_path", "page_id", "prototype_path",
    "flow", "scenario_id", "decision_id", "finding_id", "manual_check",
  ]);
  const unknownKeys = [...new Set(allImplementationMarkers.map((entry) => entry.key).filter((key) => !allowedKeys.has(key)))];
  if (unknownKeys.length) issues.push(`实施规格含未知 marker/未经来源支持的业务结论: ${unknownKeys.join(", ")}`);

  let tokens = {};
  try { tokens = JSON.parse(readFileSync(join(root, "design-tokens.json"), "utf8")); }
  catch (error) { issues.push(`design-tokens.json 非法: ${error.message}`); }
  const directionMarkers = markerValues(sectionNodesFrom(parsed.implementationNodes, "已选视觉方向"), "direction_id");
  const tokenDirection = tokens.direction_id;
  const confirmedDirection = ctx?.confirmations?.direction?.chosen;
  if (tokenDirection && confirmedDirection && tokenDirection !== confirmedDirection) {
    issues.push(`design-tokens direction_id=${tokenDirection} 与用户确认方向 ${confirmedDirection} 不一致`);
  }
  const selectedDirection = confirmedDirection ?? tokenDirection;
  if (!selectedDirection) issues.push("缺已选视觉方向来源");
  if (directionMarkers.length !== 1 || directionMarkers[0] !== selectedDirection) {
    issues.push("direction_id 缺失或不等于唯一已选视觉方向");
  }
  const expectedTokens = [...flattenTokens(tokens.semantic ?? {}, ["semantic"])];
  const actualTokens = markerValues(sectionNodesFrom(parsed.implementationNodes, "设计令牌"), "token");
  compareMarkerSet(issues, "token", expectedTokens, actualTokens);

  const actualComponents = markerValues(sectionNodesFrom(parsed.implementationNodes, "组件实施契约"), "component_id");
  if (!actualComponents.length) issues.push("组件实施契约缺 component_id");
  const knownComponents = htmlComponentIds(root);
  const unknownComponents = actualComponents.filter((id) => !knownComponents.has(id));
  if (unknownComponents.length) issues.push(`component_id 未在已评审 prototype 中实现: ${unknownComponents.join(", ")}`);

  const actualAssets = markerValues(sectionNodesFrom(parsed.implementationNodes, "资源清单"), "asset_path");
  for (const path of actualAssets) {
    const target = safeRelativePath(root, path);
    if (!target || !path.startsWith("prototype/assets/")) issues.push(`asset 路径非法或越界: ${path}`);
    else if (!existsSync(target)) issues.push(`asset 不存在: ${path}`);
  }
  compareMarkerSet(issues, "asset", assetPaths(root), actualAssets);

  const pageSection = sectionNodesFrom(parsed.implementationNodes, "页面与原型映射");
  const lockedPages = markerValues(sectionNodes(parsed, "页面规格"), "page_id");
  compareMarkerSet(issues, "page_id", lockedPages, markerValues(pageSection, "page_id"));
  const expectedPrototypePaths = collectPrototypePages(root).map((page) => `prototype/${page.name}`);
  const actualPrototypePaths = markerValues(pageSection, "prototype_path");
  for (const path of actualPrototypePaths) {
    const target = safeRelativePath(root, path);
    if (!target || !path.startsWith("prototype/") || !path.endsWith(".html")) issues.push(`prototype 路径非法或越界: ${path}`);
    else if (!existsSync(target)) issues.push(`prototype 页面不存在: ${path}`);
  }
  compareMarkerSet(issues, "prototype page", expectedPrototypePaths, actualPrototypePaths);

  const scenarioResult = loadScenarios(root);
  issues.push(...scenarioResult.errors);
  const scenarioSection = sectionNodesFrom(parsed.implementationNodes, "开发验收用例");
  compareMarkerSet(issues, "flow", [...new Set(scenarioResult.scenarios.map((entry) => entry.flow))], markerValues(scenarioSection, "flow"));
  compareMarkerSet(issues, "scenario_id", scenarioResult.scenarios.map((entry) => entry.id), markerValues(scenarioSection, "scenario_id"));

  const reviewSection = sectionNodesFrom(parsed.implementationNodes, "评审、例外与人工验证");
  compareMarkerSet(issues, "decision_id", (ctx?.decisions ?? []).map((entry) => entry.id), markerValues(reviewSection, "decision_id"));
  const findings = loadFindingsForVersion(root, prototypeVersion);
  issues.push(...findings.errors);
  const findingIds = [findings.standards, findings.visual]
    .filter(Boolean)
    .flatMap((doc) => (doc.findings ?? []).map((entry) => entry.id));
  compareMarkerSet(issues, "finding_id", findingIds, markerValues(reviewSection, "finding_id"));
  if (!markerValues(reviewSection, "manual_check").length) issues.push("评审章节缺显式 manual_check 人工验证项");

  const artifactToValidate = artifact ?? (activeDesign?.phase === "implementation_ready" ? activeDesign : null);
  if (artifactToValidate) {
    issues.push(...designDocumentArtifactIssues(root, ctx, artifactToValidate));
  }
  return [...new Set(issues)];
}
