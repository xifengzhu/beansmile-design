#!/usr/bin/env node
// 第 18.2 节可机器判定的验收阈值（哈希门禁版）。绑定当前 artifact_version，要求当前版本
// 的 standards + visual 两份 findings（schema+语义合法、verdict 明确），空决策/无 rule_id 判 fail，
// 来源加严，拒绝历史/错配评审蒙混。
// 评审只读不再用 git diff（outputs/ 不入 git，对其永远为空 → 假阳性），改为快照 manifest 内容哈希：
// 快照未被篡改 + 活动产物与快照一致 + decisions.md 只可追加。
// 用法: node scripts/acceptance.mjs --package <目录> [--check-urls]
// 退出码: 0 全 pass；1 存在 fail；3 无 fail 但有 unverified（=> 待人工验证）。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadRules } from "./lib/rules.mjs";
import { loadManifests } from "./lib/manifests.mjs";
import { loadYaml, validateContext } from "./lib/context.mjs";
import { loadFindingsForVersion, countBlockers, semanticIssuesVisual } from "./lib/findings.mjs";
import { hashPaths, manifestDigest, verifyManifest, diffHashMaps } from "./lib/hash.mjs";
import { collectCandidates, candidateIssues } from "./lib/candidates.mjs";
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
const mode = ctx?.project?.mode ?? "professional";

// 当前活动交付物的内容指纹（多个门禁复用）。
const GUARDED = ["prototype", "design-tokens.json"];
const activeHashes = hashPaths(root, GUARDED);

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
// 视觉质量门不再只信 verdict：还要求八维 dimension_reviews 语义合法（截图哈希匹配、含实测值），
// 且全部 warning 已在 decisions.md 以 [finding:id] 显式处理（修复或说明接受理由）。
{
  if (!currentVersion) {
    add("标准合规门", "fail", "无当前 artifact_version，无法绑定评审");
    add("视觉质量门", "fail", "无当前 artifact_version，无法绑定评审");
  } else {
    const f = loadFindingsForVersion(root, currentVersion);
    const decisionsText = existsSync(P("decisions.md")) ? readFileSync(P("decisions.md"), "utf8") : "";
    const unackedWarnings = (doc) => (doc?.findings ?? [])
      .filter((x) => x.severity === "warning" && !decisionsText.includes(`[finding:${x.id}]`))
      .map((x) => x.id);

    if (!f.standards) {
      add("标准合规门", "fail", `缺/非法 standards findings: ${f.errors.join("; ")}`);
    } else {
      const unacked = unackedWarnings(f.standards);
      const sOk = f.standards.verdict === "pass" && countBlockers(f.standards) === 0 && unacked.length === 0;
      add("标准合规门", sOk ? "pass" : "fail",
        `standards(v${currentVersion}) verdict=${f.standards.verdict}, blocker=${countBlockers(f.standards)}` +
        (unacked.length ? `；未处理 warning（decisions.md 缺 [finding:id] 记录）: ${unacked.join(",")}` : ""));
    }

    if (!f.visual) {
      add("视觉质量门", "fail", `缺/非法 visual findings: ${f.errors.join("; ")}`);
    } else {
      const semantic = semanticIssuesVisual(f.visual, root);
      const unacked = unackedWarnings(f.visual);
      const vOk = f.visual.verdict === "pass" && countBlockers(f.visual) === 0 && semantic.length === 0 && unacked.length === 0;
      add("视觉质量门", vOk ? "pass" : "fail",
        [`visual(v${currentVersion}) verdict=${f.visual.verdict}, blocker=${countBlockers(f.visual)}`,
         semantic.length ? `八维证据纪律不满足: ${semantic.slice(0, 5).join("; ")}${semantic.length > 5 ? ` 等 ${semantic.length} 项` : ""}` : "八维 dimension_reviews 证据完整",
         unacked.length ? `未处理 warning: ${unacked.join(",")}` : null]
          .filter(Boolean).join(" | "));
    }
  }
}

// —— 5. 评审只读（内容哈希版）——
// 快照 manifest 完好（未被篡改）+ 活动 prototype/design-tokens 与快照逐字节一致 + decisions.md 只可追加。
{
  if (!currentVersion) {
    add("评审只读", "fail", "无当前 artifact_version，无法定位快照");
  } else {
    const snapDir = P("audit", "snapshots", String(currentVersion));
    const manPath = join(snapDir, "manifest.json");
    if (!existsSync(snapDir)) add("评审只读", "fail", `缺快照 audit/snapshots/${currentVersion}/`);
    else if (!existsSync(manPath)) add("评审只读", "fail", "快照缺 manifest.json（旧版快照，需用当前 snapshot.mjs 重新冻结后重评）");
    else {
      const problems = [];
      const man = JSON.parse(readFileSync(manPath, "utf8"));
      if (man.digest !== manifestDigest(man)) problems.push("manifest digest 不符（manifest 本身被篡改）");
      problems.push(...verifyManifest(snapDir, man));
      problems.push(...diffHashMaps(man.files, activeHashes, GUARDED).map((s) => `活动产物相对快照${s}`));
      // decisions.md 允许评审后追加（记录裁决/warning 处理），但不得改写既有内容
      const snapDecisions = join(snapDir, "decisions.md");
      if (existsSync(snapDecisions)) {
        const before = readFileSync(snapDecisions, "utf8");
        const now = existsSync(P("decisions.md")) ? readFileSync(P("decisions.md"), "utf8") : "";
        if (!now.startsWith(before)) problems.push("decisions.md 既有内容被改写（只允许追加）");
      }
      add("评审只读", problems.length === 0 ? "pass" : "fail",
        problems.length ? problems.slice(0, 5).join("; ") : `快照完好，活动产物与快照 v${currentVersion} 逐字节一致，decisions.md 仅追加`);
    }
  }
}

// —— 5b. 迭代自评（截图-自评-迭代循环确实发生，html-prototype v1.1 的机器门）——
// ≥2 轮；每轮有截图 + 非空 notes.md 且引用当轮截图；末轮 page_hashes 与交付原型一致（改完必须复评）。
{
  const iterRoot = P("audit", "iterations");
  if (env.degraded) {
    add("迭代自评", "unverified", "浏览器不可用（6.2 降级）：无法产生截图轮次，须人工核对代码级自评记录");
  } else if (!existsSync(iterRoot)) {
    add("迭代自评", "fail", "缺 audit/iterations/：截图-自评-迭代循环未发生");
  } else {
    const rounds = readdirSync(iterRoot).map((d) => /^round-(\d+)$/.exec(d)).filter(Boolean)
      .map((m) => ({ dir: m[0], n: Number(m[1]) })).sort((a, b) => a.n - b.n);
    const problems = [];
    if (rounds.length < 2) problems.push(`仅 ${rounds.length} 轮（要求 ≥2）`);
    for (const r of rounds) {
      const rd = join(iterRoot, r.dir);
      const files = readdirSync(rd);
      const pngs = files.filter((x) => x.endsWith(".png"));
      if (!pngs.length) problems.push(`${r.dir} 无截图`);
      if (!files.includes("notes.md")) { problems.push(`${r.dir} 缺 notes.md（自评未记录）`); continue; }
      const notes = readFileSync(join(rd, "notes.md"), "utf8").trim();
      if (notes.length < 50) problems.push(`${r.dir}/notes.md 过短（${notes.length} 字符），不构成有效自评`);
      else if (!pngs.some((p) => notes.includes(p))) problems.push(`${r.dir}/notes.md 未引用当轮任何截图文件名`);
      if (!files.includes("meta.json")) problems.push(`${r.dir} 缺 meta.json（旧版截图产物，需用当前 screenshot.mjs 重跑）`);
    }
    const last = rounds[rounds.length - 1];
    if (last) {
      const metaPath = join(iterRoot, last.dir, "meta.json");
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        const drift = diffHashMaps(meta.page_hashes ?? {}, activeHashes, ["prototype"]);
        if (drift.length) problems.push(`末轮（${last.dir}）后原型又被改动且未复评: ${drift.slice(0, 3).join("; ")}`);
      }
    }
    add("迭代自评", problems.length === 0 ? "pass" : "fail",
      problems.length ? problems.slice(0, 5).join("; ") : `${rounds.length} 轮迭代，均有截图+自评记录，末轮与交付原型一致`);
  }
}

// —— 5c. 流程确认（专业模式三道确认门已记录，规范 9.1）——
{
  if (mode === "quick") add("流程确认", "pass", "快速模式，无确认门要求");
  else {
    const c = ctx?.confirmations ?? {};
    const missing = ["requirements", "flows", "direction"].filter((k) => !c[k]);
    const dirBad = c.direction && (!Array.isArray(c.direction.candidates) || c.direction.candidates.length < 2 || !c.direction.candidates.includes(c.direction.chosen));
    add("流程确认", missing.length === 0 && !dirBad ? "pass" : "fail",
      [missing.length ? `缺确认记录: ${missing.join(",")}` : null,
       dirBad ? "direction 候选 <2 或 chosen 不在候选中" : null,
       missing.length === 0 && !dirBad ? `三道确认门齐备（方向候选 ${c.direction.candidates.length} 个，选定 ${c.direction.chosen}）` : null]
        .filter(Boolean).join(" | "));
  }
}

// —— 5d. 执行竞争（v1.3 生成上限门：同方向 ≥2 候选、截图对比、择优记录）——
{
  if (mode === "quick") add("执行竞争", "pass", "快速模式，无候选竞争要求");
  else if (env.degraded) add("执行竞争", "unverified", "浏览器不可用（6.2 降级）：候选无法截图对比，须人工核对择优记录");
  else {
    const problems = candidateIssues(root);
    if (problems.length) add("执行竞争", "fail", problems.slice(0, 5).join("; "));
    else {
      const c = collectCandidates(root);
      const chosen = /chosen:\s*(cand-\d+)/.exec(readFileSync(P("audit", "candidates", "selection.md"), "utf8"))?.[1];
      add("执行竞争", "pass", `${c.cands.length} 个候选均有截图并被 selection.md 逐个引用，选定 ${chosen}`);
    }
  }
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

// —— 8. 无障碍与渲染信号（浏览器依赖，消费 browser-check 的全部阻断信号 + 同源校验）——
{
  const axePath = P("audit/results.json");
  if (env.degraded) add("无障碍与渲染", "unverified", "浏览器自动化不可用（6.2 降级）");
  else if (!existsSync(axePath)) add("无障碍与渲染", "unverified", "缺 audit/results.json");
  else {
    const r = JSON.parse(readFileSync(axePath, "utf8"));
    const problems = [];
    if ((r.checks_version ?? 1) < 2) problems.push("results.json 为旧版检查产物（缺 200% 缩放/可见焦点/裁切/CLS/同源指纹），请重跑 browser-check");
    if (r.artifact_version !== undefined && r.artifact_version !== currentVersion) problems.push(`版本不符: results=${r.artifact_version}, 当前=${currentVersion}`);
    // 同源：检查时的原型指纹必须与当前交付原型一致（拒绝陈旧/异次运行的审计产物冒充）
    if (r.page_hashes) {
      const drift = diffHashMaps(r.page_hashes, activeHashes, ["prototype"]);
      if (drift.length) problems.push(`results.json 与当前原型不同源: ${drift.slice(0, 3).join("; ")}`);
    } else if ((r.checks_version ?? 1) >= 2) problems.push("results.json 缺 page_hashes");
    const severe = (r.violations ?? []).filter((v) => ["critical", "serious"].includes(v.impact)).length;
    if (severe > 0) problems.push(`axe/检查严重违规 ${severe}`);
    if ((r.keyboard_reachable_ratio ?? 0) !== 1) problems.push(`键盘可达 ${((r.keyboard_reachable_ratio ?? 0) * 100).toFixed(0)}%`);
    if (r.focus_visible_ratio !== undefined && r.focus_visible_ratio !== 1) problems.push(`可见焦点 ${(r.focus_visible_ratio * 100).toFixed(0)}%`);
    if ((r.console_errors ?? []).length) problems.push(`控制台错误 ${r.console_errors.length} 条`);
    if (r.reflow_ok === false) problems.push("320px 重排失败");
    if (r.zoom_ok === false) problems.push("200% 缩放重排失败");
    if ((r.clipped_text ?? []).length) problems.push(`文本裁切 ${r.clipped_text.length} 处`);
    const maxCls = Math.max(0, ...Object.values(r.cls ?? {}));
    if (maxCls >= 0.1) problems.push(`CLS=${maxCls}（阈值 0.1）`);
    add("无障碍与渲染", problems.length === 0 ? "pass" : "fail",
      problems.length ? problems.join("; ") : `同源指纹一致；axe 严重违规 0，键盘可达 100%，可见焦点 100%，控制台 0 错，reflow/200% 缩放 OK，无裁切，CLS≤${maxCls}`);
  }
}

// —— 9. 环境诚实 ——
{
  const browserDims = ["无障碍与渲染", "迭代自评", "执行竞争"];
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
console.log("结论：全部通过。");
process.exit(0);
