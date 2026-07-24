#!/usr/bin/env node
// 第 18.2 节可机器判定的验收阈值（硬化版）。绑定当前 artifact_version，要求当前版本
// 的 standards + visual 两份 findings（schema 合法、verdict 明确），空决策/无 rule_id 判 fail，
// 来源加严，拒绝历史/错配评审蒙混。
// 用法: node scripts/acceptance.mjs --package <目录> [--review-before <ref> --review-after <ref>] [--check-urls]
// 退出码: 0 全 pass；1 存在 fail；3 无 fail 但有 unverified（=> 待人工验证）。
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRules } from "./lib/rules.mjs";
import { loadManifests } from "./lib/manifests.mjs";
import { loadYaml, validateContext } from "./lib/context.mjs";
import { loadFindingsForVersion, countBlockers } from "./lib/findings.mjs";
import { checkEnvironment } from "./env-check.mjs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const pkg = arg("--package");
if (!pkg) { console.error("用法: node scripts/acceptance.mjs --package <目录>"); process.exit(2); }
const root = resolve(pkg);
const P = (...p) => join(root, ...p);
const results = [];
const add = (dim, status, detail) => results.push({ dim, status, detail });

// 浏览器能力只探测一次（真启动），供无障碍/环境诚实/召回复用。
const env = await checkEnvironment();

// 载入 context（后续多项依赖）。
let ctx = null;
if (existsSync(P("context.yaml"))) ctx = loadYaml(P("context.yaml"));
const currentVersion = ctx?.artifacts?.prototype?.artifact_version ?? null;

// —— 1. 结构稳定 ——
{
  const required = ["README.md", "brief.md", "flows.md", "design-tokens.json", "decisions.md",
    "prototype/index.html", "audit/report.md", "audit/environment.md"];
  const missing = required.filter((f) => !existsSync(P(f)));
  let ctxOk = false, ctxDetail = "缺少 context.yaml";
  if (ctx) { const v = validateContext(ctx); ctxOk = v.ok; ctxDetail = v.ok ? "context.yaml 通过 schema" : `context 校验失败: ${v.errors.join("; ")}`; }
  const { manifests } = loadManifests();
  const missingProduced = manifests.flatMap((m) => m.produces).filter((f) => !existsSync(P(f)));
  const versionOk = currentVersion !== null;
  const ok = missing.length === 0 && ctxOk && missingProduced.length === 0 && versionOk;
  add("结构稳定", ok ? "pass" : "fail",
    [missing.length ? `缺文件: ${missing.join(",")}` : null, ctxDetail,
     missingProduced.length ? `缺产物: ${missingProduced.join(",")}` : null,
     versionOk ? `当前原型版本 ${currentVersion}` : "context.artifacts.prototype.artifact_version 缺失"]
      .filter(Boolean).join(" | "));
}

// —— 2. 规则可追溯 & 3. 无伪造来源 ——
{
  const { byId } = loadRules();
  const referenced = new Set();
  for (const d of ctx?.decisions ?? []) for (const rid of d.rule_ids ?? []) referenced.add(rid);
  if (existsSync(P("decisions.md"))) {
    const text = readFileSync(P("decisions.md"), "utf8");
    // 显式标记 [rule:id] 权威计入（decision-record Skill 的书写约定）
    for (const m of text.matchAll(/\[rule:([a-z0-9][a-z0-9.\-]*)\]/g)) referenced.add(m[1]);
    // 裸 id 扫描：前缀从依据库动态推导（新增规则文件自动纳入，不再硬编码）。
    // 未解析的候选仅在 ≥3 段时计入（拦截伪造 id），避免把"web-first"这类普通词误判为引用。
    const prefixes = [...new Set([...byId.keys()].map((id) => id.split("-")[0]))].join("|");
    for (const m of text.matchAll(new RegExp(`\\b(?:${prefixes})-[a-z0-9][a-z0-9.\\-]*`, "g"))) {
      if (byId.has(m[0]) || m[0].split("-").length >= 3) referenced.add(m[0]);
    }
  }
  const decisionsEmpty = (ctx?.decisions ?? []).length === 0;
  const unresolved = [], missingFields = [], badSource = [];
  const fakeHost = /(^|\.)(example|test|invalid|localhost)(\.|$)/i;
  for (const rid of referenced) {
    const card = byId.get(rid);
    if (!card) { unresolved.push(rid); continue; }
    if (!card.source_url || !card.last_verified) missingFields.push(rid);
    let host = "";
    try { host = new URL(card.source_url).host; } catch { /* 非法 URL */ }
    if (!/^https?:\/\//.test(card.source_url ?? "") || !host || fakeHost.test(host)) badSource.push(rid);
  }
  // 空决策或零引用 => fail（规范 17「关键决策有依据」）
  const traceOk = !decisionsEmpty && referenced.size > 0 && unresolved.length === 0 && missingFields.length === 0;
  add("规则可追溯", traceOk ? "pass" : "fail",
    decisionsEmpty ? "context.decisions 为空 —— 无任何可追溯依据"
      : `引用 ${referenced.size} 条；未解析 [${unresolved.join(",")}]；缺字段 [${missingFields.join(",")}]`);

  // --check-urls：抽查引用规则卡的 source_url 实际可访问（规范 18.2「无伪造来源」的在线核实半句）
  const unreachable = [];
  if (process.argv.includes("--check-urls")) {
    const urls = [...new Set([...referenced].map((rid) => byId.get(rid)?.source_url).filter(Boolean))];
    for (const u of urls) {
      try {
        const res = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000) });
        if (!res.ok && res.status !== 403) unreachable.push(`${u} (${res.status})`); // 403=反爬拦截，非悬空
      } catch { unreachable.push(`${u} (网络不可达)`); }
    }
  }
  const sourceOk = badSource.length === 0 && referenced.size > 0 && unreachable.length === 0;
  add("无伪造来源", referenced.size === 0 ? "fail" : (sourceOk ? "pass" : "fail"),
    referenced.size === 0 ? "无引用来源可核"
      : [badSource.length ? `疑似伪造/占位/悬空来源: ${badSource.join(",")}` : null,
         unreachable.length ? `在线核实失败: ${unreachable.join("; ")}` : null,
         (!badSource.length && !unreachable.length) ? `引用来源均合法${process.argv.includes("--check-urls") ? "且在线可达" : "（未加 --check-urls，仅做形态检查）"}` : null]
        .filter(Boolean).join(" | "));
}

// —— 4/7. 双评审（绑定当前版本）: 标准合规门 + 视觉质量门 ——
{
  if (!currentVersion) {
    add("标准合规门", "fail", "无当前 artifact_version，无法绑定评审");
    add("视觉质量门", "fail", "无当前 artifact_version，无法绑定评审");
  } else {
    const f = loadFindingsForVersion(root, currentVersion);
    if (f.errors.length) {
      const detail = f.errors.join("; ");
      add("标准合规门", f.standards ? (f.standards.verdict === "pass" && countBlockers(f.standards) === 0 ? "pass" : "fail") : "fail",
        f.standards ? `standards verdict=${f.standards.verdict}, blocker=${countBlockers(f.standards)}` : `缺/非法 standards findings: ${detail}`);
      add("视觉质量门", f.visual ? (f.visual.verdict === "pass" && countBlockers(f.visual) === 0 ? "pass" : "fail") : "fail",
        f.visual ? `visual verdict=${f.visual.verdict}, blocker=${countBlockers(f.visual)}` : `缺/非法 visual findings: ${detail}`);
    } else {
      const sOk = f.standards.verdict === "pass" && countBlockers(f.standards) === 0;
      const vOk = f.visual.verdict === "pass" && countBlockers(f.visual) === 0;
      add("标准合规门", sOk ? "pass" : "fail", `standards(v${currentVersion}) verdict=${f.standards.verdict}, blocker=${countBlockers(f.standards)}`);
      add("视觉质量门", vOk ? "pass" : "fail", `visual(v${currentVersion}) verdict=${f.visual.verdict}, blocker=${countBlockers(f.visual)}`);
    }
  }
}

// —— 5. 评审只读 ——
{
  const before = arg("--review-before"), after = arg("--review-after");
  const guarded = ["prototype", "design-tokens.json", "decisions.md"];
  if (before && after) {
    try {
      const out = execFileSync("git", ["-C", root, "diff", "--name-only", before, after, "--", ...guarded], { encoding: "utf8" }).trim();
      const changed = out ? out.split("\n") : [];
      add("评审只读", changed.length === 0 ? "pass" : "fail", changed.length ? `评审窗口内被改动: ${changed.join(", ")}` : "受保护产物零改动");
    } catch (e) { add("评审只读", "unverified", `git diff 失败: ${String(e.message).split("\n")[0]}`); }
  } else { add("评审只读", "unverified", "未提供 --review-before/--review-after"); }
}

// —— 6. 阻断召回 ——
{
  const recallPath = P("audit/recall.json");
  if (existsSync(recallPath)) {
    const r = JSON.parse(readFileSync(recallPath, "utf8"));
    const ok = r.recall === 1 && (r.false_positives ?? 0) === 0 && r.browser_covered === true;
    add("阻断召回", ok ? "pass" : (r.browser_covered ? "fail" : "unverified"),
      `召回 ${(r.recall * 100).toFixed(0)}%（${r.detected}/${r.injected}），误报 ${r.false_positives ?? "?"}${r.browser_covered ? "" : "；未含浏览器类别(6.2 降级)"}`);
  } else { add("阻断召回", "unverified", "缺 audit/recall.json"); }
}

// —— 8. 无障碍（浏览器依赖）——
{
  const axePath = P("audit/results.json");
  if (env.degraded) add("无障碍", "unverified", "浏览器自动化不可用（6.2 降级）");
  else if (existsSync(axePath)) {
    const r = JSON.parse(readFileSync(axePath, "utf8"));
    const versionMatch = r.artifact_version === undefined || r.artifact_version === currentVersion;
    const severe = (r.violations ?? []).filter((v) => ["critical", "serious"].includes(v.impact)).length;
    const kbd = r.keyboard_reachable_ratio ?? null;
    const ok = versionMatch && severe === 0 && kbd === 1;
    add("无障碍", ok ? "pass" : "fail",
      `${versionMatch ? "" : "版本不符; "}axe 严重违规 ${severe}；键盘可达 ${kbd === null ? "未记录" : (kbd * 100) + "%"}`);
  } else add("无障碍", "unverified", "缺 audit/results.json");
}

// —— 9. 环境诚实 ——
{
  const browserDims = ["无障碍"];
  const dishonest = results.filter((r) => browserDims.includes(r.dim) && env.degraded && r.status === "pass");
  add("环境诚实", dishonest.length === 0 ? "pass" : "fail", env.degraded ? "浏览器不可用；受影响结论均未判为通过" : "浏览器可用");
}

// —— 汇总 ——
const icon = { pass: "✓", fail: "✗", unverified: "?" };
console.log("\n第 18.2 节验收结果：\n");
for (const r of results) console.log(`  ${icon[r.status]} [${r.status.toUpperCase()}] ${r.dim} — ${r.detail}`);
const anyFail = results.some((r) => r.status === "fail");
const anyUnverified = results.some((r) => r.status === "unverified");
console.log("");
if (anyFail) { console.log("结论：存在 FAIL，未通过验收。"); process.exit(1); }
if (anyUnverified) { console.log("结论：无 FAIL 但有未验证项 → 只能标记\"待人工验证\"（规范 6.2/17）。"); process.exit(3); }
console.log("结论：全部通过。"); process.exit(0);
