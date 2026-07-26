// 中间版本增量评审（规范 27.5）：delta 包生成/再生比对 + delta findings 语义校验。
// 协议：首版与拟交付版全量双评审（验收 blocks 4/7 + 规则快照四门不变，只认全量）；
// 中间版本用 delta 评审省 token。delta findings 落盘为 <reviewer>-<v>-delta.yaml，
// 与全量命名区隔，loadFindingsForVersion 只找全量名——delta 永不可能冒充全量。
// 闭合性是硬线：baseline 的每条 open blocker/warning 必须被核销（resolved_findings，
// ≥10 字证据）或再断言（findings 沿用同 id），缺一拒收——省 token 不许静默丢问题。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { makeValidator } from "./rules.mjs";
import { SCHEMAS } from "./paths.mjs";
import { hashPaths, sha256File, sha256Text } from "./hash.mjs";
import { diffLines } from "./text-diff.mjs";
import { validateFindingsDoc } from "./findings.mjs";

let _validate;
function validator() {
  if (!_validate) _validate = makeValidator().compile(JSON.parse(readFileSync(SCHEMAS.findingsDelta, "utf8")));
  return _validate;
}

export function validateDeltaDoc(doc) {
  const validate = validator();
  const ok = validate(doc);
  return { ok, errors: ok ? [] : validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`) };
}

// 读取某 reviewer 在某版本的 findings：优先全量（-<v>.yaml），其次 delta（-<v>-delta.yaml）。
// 严格版本绑定：文档内 artifact_version 必须等于文件名版本——文件里写别的版本号
// （standards-2.yaml 内写 999）即拒，防错版评审蒙混进链。
// 返回 { doc, kind: "full"|"delta" } 或 null。
export function loadReviewerFindings(pkgRoot, reviewer, version) {
  const dir = join(pkgRoot, "audit", "findings");
  const full = join(dir, `${reviewer}-${version}.yaml`);
  if (existsSync(full)) {
    const doc = yaml.load(readFileSync(full, "utf8"));
    if (validateFindingsDoc(doc).ok && doc.reviewer === reviewer
      && String(doc.artifact_version) === String(version)) return { doc, kind: "full" };
    return null;
  }
  const delta = join(dir, `${reviewer}-${version}-delta.yaml`);
  if (existsSync(delta)) {
    const doc = yaml.load(readFileSync(delta, "utf8"));
    if (validateDeltaDoc(doc).ok && doc.reviewer === reviewer
      && String(doc.artifact_version) === String(version)) return { doc, kind: "delta" };
    return null;
  }
  return null;
}

// baseline 的 open 问题清单：blocker/warning findings（delta 基线则先剔除其自身已核销项——
// 已核销问题不复活；再断言项仍 open）。
export function openFindings(baselineDoc, kind) {
  const open = (baselineDoc.findings ?? []).filter((f) => ["blocker", "warning"].includes(f.severity));
  if (kind === "delta") return open; // delta 文档的 findings 本就是"新问题+再断言"，全部 open
  return open;
}

// —— delta 包（audit/snapshots/<v>/delta/）——
// 由两个冻结快照 + baseline findings 确定性生成；校验方重建比对（同 review-bundle 再生门）。
// decisions.md 纳入 diff 范围（standards 评审要看到基线后追加了哪些裁决/ack）。
const DELTA_SCOPE = ["prototype", "design-tokens.json", "decisions.md"];
const TEXT_EXT = /\.(html|css|js|mjs|json|md|svg|txt)$/;
const isPageKey = (k) => k.startsWith("prototype/") && k.endsWith(".html")
  && !k.startsWith("prototype/assets/") && !k.startsWith("prototype/node_modules/");

// curDir 可覆盖：snapshot.mjs 先在临时目录组装快照（原子 rename 前 delta 就要生成，
// 规范 27.5）；校验方 deltaIssues 重建时用最终路径。
export function buildDeltaBundle({ pkgRoot, baselineVersion, version, curDir = null }) {
  const snapDir = (v) => join(pkgRoot, "audit", "snapshots", String(v));
  const prevDir = snapDir(baselineVersion);
  curDir = curDir ?? snapDir(version);
  if (!existsSync(prevDir)) throw new Error(`基线快照不存在: audit/snapshots/${baselineVersion}/`);
  if (!existsSync(curDir)) throw new Error(`当前快照不存在: ${curDir}`);
  const prev = hashPaths(prevDir, DELTA_SCOPE);
  const cur = hashPaths(curDir, DELTA_SCOPE);

  const changed = [], added = [], removed = [];
  for (const [k, h] of Object.entries(prev)) {
    if (!(k in cur)) removed.push(k);
    else if (cur[k] !== h) changed.push(k);
  }
  for (const k of Object.keys(cur)) if (!(k in prev)) added.push(k);
  changed.sort(); added.sort(); removed.sort();

  const changedFiles = {
    baseline_version: String(baselineVersion),
    artifact_version: String(version),
    changed, added, removed,
  };

  let diffText = `# 冻结快照 v${baselineVersion} → v${version} 的行级 diff（规范 27.5，可再生）\n`;
  for (const k of [...changed, ...added]) {
    if (!TEXT_EXT.test(k)) { diffText += `--- ${k}\n[二进制或未知类型，仅记录已变更]\n`; continue; }
    const prevText = k in prev ? readFileSync(join(prevDir, k), "utf8") : "";
    const curText = readFileSync(join(curDir, k), "utf8");
    diffText += diffLines(prevText, curText, k);
  }
  for (const k of removed) diffText += `--- ${k}\n[整文件删除]\n`;

  // open findings：baseline 两个 reviewer 的遗留 blocker/warning + standards coverage fail 规则。
  const open = { baseline_version: String(baselineVersion), findings: [], coverage_fail_rule_ids: [] };
  for (const reviewer of ["standards", "visual"]) {
    const b = loadReviewerFindings(pkgRoot, reviewer, baselineVersion);
    if (!b) continue;
    for (const f of openFindings(b.doc, b.kind)) {
      open.findings.push({
        reviewer, id: f.id, severity: f.severity,
        ...(f.dimension ? { dimension: f.dimension } : {}),
        rule_id: f.rule_id ?? null, location: f.location, recommendation: f.recommendation,
      });
    }
    if (reviewer === "standards") {
      const cov = b.kind === "full" ? (b.doc.rule_coverage ?? []) : (b.doc.rule_coverage_delta ?? []);
      open.coverage_fail_rule_ids.push(...cov.filter((c) => c.result === "fail").map((c) => c.rule_id));
    }
  }
  open.findings.sort((a, b) => (a.id < b.id ? -1 : 1));
  open.coverage_fail_rule_ids.sort();

  // 变更页清单（规范 27.5/复审修正）：共享资产（assets/**）、design-tokens.json、页面删除
  // 或任何非页面文件变化都全局生效——展开为全部页面，否则视觉 delta 会漏看受影响页；
  // 只有纯页面级 HTML 改动才按页增量。decisions.md 是文档追加，不触发展开。
  const curPages = Object.keys(cur).filter(isPageKey).sort();
  const touched = [...changed, ...added, ...removed];
  const expandAll = touched.some((k) => k !== "decisions.md" && !(isPageKey(k) && k in cur));
  const changedPages = {
    artifact_version: String(version),
    expanded_all: expandAll,
    reason: expandAll
      ? `共享资产/令牌/结构级变化全局生效: ${touched.filter((k) => k !== "decisions.md" && !(isPageKey(k) && k in cur)).slice(0, 3).join(", ")}`
      : null,
    pages: (expandAll ? curPages : touched.filter((k) => isPageKey(k) && k in cur).sort()).map((k) => k.replace(/^prototype\//, "")),
  };

  return {
    "changed-files.json": JSON.stringify(changedFiles, null, 2),
    "files.diff": diffText,
    "open-findings.yaml": yaml.dump(open, { lineWidth: 120 }),
    "changed-pages.json": JSON.stringify(changedPages, null, 2),
  };
}

// 再生比对门：盘上 delta/ 与重建结果逐文件字节一致。
export function deltaIssues(pkgRoot, baselineVersion, version) {
  const deltaDir = join(pkgRoot, "audit", "snapshots", String(version), "delta");
  if (!existsSync(deltaDir)) return [`快照 v${version} 无 delta/ 目录`];
  let rebuilt;
  try { rebuilt = buildDeltaBundle({ pkgRoot, baselineVersion, version }); }
  catch (e) { return [`delta 包再生失败: ${e.message}`]; }
  const issues = [];
  for (const [name, text] of Object.entries(rebuilt)) {
    const p = join(deltaDir, name);
    if (!existsSync(p)) { issues.push(`delta/ 缺 ${name}`); continue; }
    if (sha256File(p) !== sha256Text(text)) issues.push(`delta/${name} 与再生结果不符（被篡改或基线 findings 事后被改）`);
  }
  return issues;
}

// —— delta findings 语义校验 ——
// baseline: loadReviewerFindings 的返回；frozen: loadFrozenRules(pkg, doc.artifact_version)。
const WEB_PLATFORMS = ["web", "mobile_web"];

export function semanticIssuesDelta(doc, baseline, frozen, pkgRoot) {
  const issues = [];
  if (!baseline) {
    issues.push(`baseline v${doc.baseline_version} 无 ${doc.reviewer} findings（全量或 delta）——增量链断裂，先评基线`);
    return issues;
  }
  if (Number(doc.baseline_version) >= Number(doc.artifact_version)) {
    issues.push(`baseline_version=${doc.baseline_version} 不小于 artifact_version=${doc.artifact_version}`);
  }

  // delta findings 必须绑定同版本快照的 delta 包（复审修正）：无 delta/ 意味着评审
  // 没有可核查的变更输入面；baseline 不一致意味着评审看的 diff 与声称的基线脱钩。
  const cfPath = join(pkgRoot, "audit", "snapshots", String(doc.artifact_version), "delta", "changed-files.json");
  if (!existsSync(cfPath)) {
    issues.push(`快照 v${doc.artifact_version} 无 delta/changed-files.json——delta 评审必须基于 snapshot --delta-from 生成的增量包`);
  } else {
    try {
      const cf = JSON.parse(readFileSync(cfPath, "utf8"));
      if (String(cf.baseline_version) !== String(doc.baseline_version)) {
        issues.push(`delta findings 的 baseline_version=${doc.baseline_version} 与快照 delta 包的 ${cf.baseline_version} 不一致——评审看的 diff 与声称基线脱钩`);
      }
    } catch (e) { issues.push(`delta/changed-files.json 不可读: ${String(e.message).split("\n")[0]}`); }
  }

  // 闭合性：baseline 每条 open blocker/warning 必须核销或再断言。
  const openIds = openFindings(baseline.doc, baseline.kind).map((f) => f.id);
  const resolvedIds = new Set((doc.resolved_findings ?? []).map((r) => r.id));
  const assertedIds = new Set((doc.findings ?? []).map((f) => f.id));
  for (const id of openIds) {
    if (!resolvedIds.has(id) && !assertedIds.has(id)) {
      issues.push(`baseline 遗留问题 ${id} 既未核销（resolved_findings）也未再断言（findings）——不许静默丢问题`);
    }
  }
  for (const id of resolvedIds) {
    if (!openIds.includes(id)) issues.push(`resolved_findings 核销了 baseline 不存在的问题: ${id}`);
    if (assertedIds.has(id)) issues.push(`问题 ${id} 同时被核销与再断言，自相矛盾`);
  }

  // rule_id 只能引用冻结集。
  const frozenIds = new Set((frozen?.manifest?.rules ?? []).map((r) => r.rule_id));
  for (const f of doc.findings ?? []) {
    if (f.rule_id && !frozenIds.has(f.rule_id)) issues.push(`finding ${f.id} 引用冻结 manifest 外的 rule_id: ${f.rule_id}`);
    if (["blocker", "warning"].includes(f.severity) && !/\d/.test(f.evidence ?? "")) {
      issues.push(`finding ${f.id}（${f.severity}）evidence 无实测数值，不满足证据纪律`);
    }
  }

  if (doc.reviewer === "standards") {
    for (const c of doc.rule_coverage_delta ?? []) {
      if (!frozenIds.has(c.rule_id)) issues.push(`rule_coverage_delta 引用冻结集外规则: ${c.rule_id}`);
      const rule = (frozen?.cards ?? []).find((x) => x.id === c.rule_id);
      if (c.result === "intent_only" && (rule?.platforms ?? []).some((p) => WEB_PLATFORMS.includes(p))) {
        issues.push(`[${c.rule_id}] Web 平台规则不得用 intent_only`);
      }
      if (c.result === "fail") {
        const linked = (doc.findings ?? []).some((f) => f.rule_id === c.rule_id && ["blocker", "warning"].includes(f.severity));
        if (!linked) issues.push(`[${c.rule_id}] rule_coverage_delta result=fail 但无对应 blocker/warning finding`);
      }
    }
  }

  if (doc.reviewer === "visual") {
    // 截图哈希纪律与全量同源（子集：不要求八维齐全，只查引用真实性）。
    for (const r of doc.dimension_reviews_delta ?? []) {
      if (String(r.screenshot).includes("..") || !/^audit\//.test(r.screenshot)) {
        issues.push(`[${r.dimension}] 截图路径非法: ${r.screenshot}`); continue;
      }
      const p = join(pkgRoot, r.screenshot);
      if (!existsSync(p)) { issues.push(`[${r.dimension}] 引用的截图不存在: ${r.screenshot}`); continue; }
      if (sha256File(p) !== r.screenshot_sha256) issues.push(`[${r.dimension}] 截图哈希不匹配: ${r.screenshot}`);
      if (!/\d/.test(r.observed)) issues.push(`[${r.dimension}] observed 无实测数值`);
    }
  }
  return issues;
}
