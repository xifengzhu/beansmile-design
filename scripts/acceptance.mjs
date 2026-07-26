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
import { loadFindingsForVersion, countBlockers, semanticIssuesVisual, semanticIssuesStandards, industryPackFile } from "./lib/findings.mjs";
import { loadRulePacks } from "./lib/rule-packs.mjs";
import { loadFrozenRules, activationGateIssues, MIGRATION_HINT } from "./lib/frozen-rules.mjs";
import { templateClosureIssues } from "./lib/coverage-template.mjs";
import { hashPaths, manifestDigest, verifyManifest, diffHashMaps } from "./lib/hash.mjs";
import { collectCandidates, candidateIssues } from "./lib/candidates.mjs";
import { sharedCssIssues } from "./lib/css-dup.mjs";
import { collectPrototypePages } from "./lib/pages.mjs";
import { iterationChainIssues } from "./lib/iterations.mjs";
import { loadReviewerFindings, semanticIssuesDelta, deltaIssues } from "./lib/delta-review.mjs";
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

// 全部被引用的规则 id（block 2 填充；「行业依据」门复用）。
const referencedRules = new Set();

// —— 2. 规则可追溯 & 3. 无伪造来源 ——
{
  const { byId } = loadRules();
  const referenced = referencedRules;
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
// 分层扩展 §8.4：standards 的适用集出自冻结快照 rules/（loadFrozenRules，与 record-findings
// 同一实现），不读仓库当前 evidence/rules/——规则库升级不追溯漂移。
const frozen = currentVersion ? loadFrozenRules(root, currentVersion) : { ok: false, errors: ["无当前 artifact_version"], cards: null, manifest: null, scope: null };
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
    } else if (!frozen.ok) {
      add("标准合规门", "fail", `冻结规则快照不可用: ${frozen.errors.slice(0, 3).join("; ")}`);
    } else {
      const unacked = unackedWarnings(f.standards);
      // 适用集 = 冻结快照 rules/ 的规则卡（§8.4），与 record-findings 完全同源。
      const coverage = semanticIssuesStandards(f.standards, frozen.cards);
      const sOk = f.standards.verdict === "pass" && countBlockers(f.standards) === 0 && unacked.length === 0 && coverage.length === 0;
      add("标准合规门", sOk ? "pass" : "fail",
        [`standards(v${currentVersion}) verdict=${f.standards.verdict}, blocker=${countBlockers(f.standards)}`,
         coverage.length ? `覆盖矩阵不满足: ${coverage.slice(0, 4).join("; ")}${coverage.length > 4 ? ` 等 ${coverage.length} 项` : ""}`
           : `覆盖矩阵完整（${(f.standards.rule_coverage ?? []).length} 条逐冻结规则核查）`,
         unacked.length ? `未处理 warning（decisions.md 缺 [finding:id] 记录）: ${unacked.join(",")}` : null]
          .filter(Boolean).join(" | "));
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

// —— 5b. 迭代自评（截图-自评-迭代循环确实发生，html-prototype v1.1 门 + 规范 27.3 携带链）——
// 完整判定迁入 scripts/lib/iterations.mjs（与 screenshot.mjs 共用轮次/meta 解析）：
// ≥2 轮；每轮 notes.md 引用当轮实际新截的图；carried 页三方哈希链一致且引用轮实拍图在盘；
// 首末轮全量；末轮 page_hashes 与交付原型一致（改完必须复评）。v1.7 meta 按全量轮兼容。
{
  if (env.degraded) {
    add("迭代自评", "unverified", "浏览器不可用（6.2 降级）：无法产生截图轮次，须人工核对代码级自评记录");
  } else {
    const { rounds, problems } = iterationChainIssues(root, activeHashes);
    add("迭代自评", problems.length === 0 ? "pass" : "fail",
      problems.length ? problems.slice(0, 5).join("; ")
        : `${rounds} 轮迭代，均有截图+自评记录，携带链完整，末轮全量且与交付原型一致`);
  }
}

// v1.8 流程包判定：snapshot_version >= 2 才启用本版新增门（共享样式/迭代评审链/流程确认 mode），
// 历史包输出迁移措辞、不追溯 fail（规范 27.1/27.9）。
const isV2Package = frozen.ok && (frozen.manifest.snapshot_version ?? 1) >= 2;

// —— 5b-2. 共享样式（规范 27.2：多页原型必须抽取共享 CSS，静态检查不受降级豁免）——
{
  if (!existsSync(P("prototype"))) add("共享样式", "fail", "缺 prototype/");
  else if (!isV2Package) add("共享样式", "pass", "v1.7 及以前流程包，共享样式门不追溯（新交付须抽取共享 CSS 到 prototype/assets/）");
  else {
    const issues = sharedCssIssues(root);
    const pageCount = collectPrototypePages(root).length;
    add("共享样式", issues.length === 0 ? "pass" : "fail",
      issues.length ? issues.slice(0, 4).join("; ")
        : (pageCount < 2 ? "单页原型，单文件自包含合法" : `${pageCount} 页均引入 assets/ 共享样式表，无 ≥2KB 重复内联块`));
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

// —— 5e. 行业依据（v1.4：行业 profile 激活时，行业规则必须实际参与决策）——
{
  const industry = ctx?.project?.industry;
  if (mode === "quick") add("行业依据", "pass", "快速模式，无行业依据要求");
  else if (!industry) add("行业依据", "fail", "缺 project.industry（intake 应识别行业；通用产品用 general）");
  else if (industry === "general") add("行业依据", "pass", "行业=general（通用产品，无行业规则包要求）");
  else {
    const packFile = industryPackFile(industry);
    const packRules = loadRules().rules.filter((r) => r._file === packFile);
    if (!packRules.length) {
      add("行业依据", "unverified", `无行业规则包 evidence/rules/${packFile}：行业合规须人工评审（或先补规则包）`);
    } else {
      const used = packRules.filter((r) => referencedRules.has(r.id));
      add("行业依据", used.length ? "pass" : "fail",
        used.length
          ? `行业包 ${packFile}（${packRules.length} 条）中 ${used.length} 条参与决策: ${used.slice(0, 5).map((r) => r.id).join(",")}${used.length > 5 ? " 等" : ""}`
          : `行业包 ${packFile} 存在（${packRules.length} 条）但 decisions 零引用——行业规则未参与设计决策`);
    }
  }
}

// —— 5f–5i. 规则快照四门（分层扩展 §8.5）——
// 快照缺 rules/（未迁移历史包）时四门统一输出迁移提示（§9.1），状态 fail 但措辞不判历史交付非法。
{
  const gates = ["规则包激活", "主参考系统依据", "规范版本绑定", "覆盖模板闭合"];
  if (!currentVersion || !frozen.ok) {
    // 缺 rules/（未迁移历史包）→ 统一迁移提示（§9.1，不判历史交付非法）；
    // 其它失败（哈希漂移/manifest 损坏）→ 展示实际错误。
    const detail = !currentVersion
      ? "无当前 artifact_version，无法定位冻结规则快照"
      : (frozen.errors.some((e) => e.includes(MIGRATION_HINT)) ? MIGRATION_HINT : frozen.errors.slice(0, 2).join("; "));
    for (const g of gates) add(g, "fail", detail);
  } else {
    const { manifest, scope } = frozen;
    const manifestIds = new Set(manifest.rules.map((r) => r.rule_id));
    const f = loadFindingsForVersion(root, currentVersion);

    // a. 规则包激活：context、注册表、激活规则和快照 manifest 一致（spec §8.5，共享实现
    // activationGateIssues——规则库在快照后升级 → fail，提示升版重新 snapshot 评审）。
    {
      const problems = activationGateIssues(ctx?.project ?? {}, manifest, scope, loadRules().rules, loadRulePacks().packs);
      add("规则包激活", problems.length === 0 ? "pass" : "fail",
        problems.length ? problems.slice(0, 3).join("; ") : `context/注册表/冻结 manifest 一致（激活 ${manifestIds.size} 条规则）`);
    }

    // b. 主参考系统依据：选定系统包至少一条规则实际参与设计决策（referencedRules 见块 2）。
    {
      const rs = ctx?.project?.reference_system;
      if (!rs || rs === "none") {
        add("主参考系统依据", "pass", "reference_system=none，无需主参考系统引用");
      } else {
        const rsPackIds = new Set(loadRulePacks().packs
          .filter((p) => p.activation?.type === "reference_system" && (p.activation.values ?? []).includes(rs))
          .map((p) => p.id));
        const rsRuleIds = manifest.rules.filter((r) => rsPackIds.has(r.pack_id)).map((r) => r.rule_id);
        const used = rsRuleIds.filter((id) => referencedRules.has(id));
        add("主参考系统依据", used.length ? "pass" : "fail",
          used.length
            ? `主参考系统 ${rs} 包 ${used.length}/${rsRuleIds.length} 条规则参与决策: ${used.slice(0, 5).join(",")}${used.length > 5 ? " 等" : ""}`
            : `主参考系统 ${rs} 冻结规则 ${rsRuleIds.length} 条但 decisions 零引用——选定系统未实际参与设计决策`);
      }
    }

    // c. 规范版本绑定：findings 覆盖集合与冻结 manifest 完全一致，无缺失/额外/哈希漂移。
    // （哈希漂移由 loadFrozenRules 拦截——走到这里说明冻结卡与 manifest sha 一致。）
    {
      const problems = [];
      if (!f.standards) problems.push(`缺/非法 standards findings: ${f.errors.join("; ")}`);
      else {
        const covIds = new Set((f.standards.rule_coverage ?? []).map((c) => c.rule_id));
        const missing = [...manifestIds].filter((id) => !covIds.has(id));
        const extra = [...covIds].filter((id) => !manifestIds.has(id));
        if (missing.length) problems.push(`coverage 缺冻结规则 ${missing.length} 条: ${missing.slice(0, 3).join(",")}${missing.length > 3 ? "…" : ""}`);
        if (extra.length) problems.push(`coverage 含 manifest 外规则 ${extra.length} 条: ${extra.slice(0, 3).join(",")}${extra.length > 3 ? "…" : ""}`);
      }
      if (!f.visual) problems.push(`缺/非法 visual findings: ${f.errors.join("; ")}`);
      else {
        const bad = (f.visual.findings ?? []).filter((x) => x.rule_id && !manifestIds.has(x.rule_id)).map((x) => `${x.id}→${x.rule_id}`);
        if (bad.length) problems.push(`visual findings 引用 manifest 外 rule_id: ${bad.slice(0, 3).join("; ")}`);
      }
      add("规范版本绑定", problems.length === 0 ? "pass" : "fail",
        problems.length ? problems.slice(0, 3).join("; ") : `standards coverage 与冻结 manifest（${manifestIds.size} 条）逐条一致，visual rule_id 均可解析，无哈希漂移`);
    }

    // d. 覆盖模板闭合：全部模板行由可信自动证据或 reviewer 更新闭合。
    {
      const template = scope.rule_coverage_template ?? [];
      if (!f.standards) add("覆盖模板闭合", "fail", `缺/非法 standards findings: ${f.errors.join("; ")}`);
      else {
        const issues = templateClosureIssues(f.standards.rule_coverage ?? [], template, f.standards.findings ?? []);
        add("覆盖模板闭合", issues.length === 0 ? "pass" : "fail",
          issues.length ? issues.slice(0, 4).join("; ") : `全部 ${template.length} 条模板行闭合（自动预填 ${template.filter((t) => t.state === "prefilled_automated").length} 条），无 null/锁定字段修改/单向阀违规`);
      }
    }
  }
}

// —— 5j. 迭代评审链（规范 27.5）：首版全量双评审；每个中间版本须有全量对或通过语义
// 校验的 delta 对（baseline 链接续、闭合性满足）；快照带 delta/ 时再生比对。
// 拟交付版本的全量双评审由 blocks 4/7 + 规则快照四门把守，本门不重复。
{
  if (!isV2Package) add("迭代评审链", "pass", "v1.7 流程包，无迭代评审链要求（新交付按规范 27.5 记录中间版本评审）");
  else {
    const snapRoot = P("audit", "snapshots");
    const versions = existsSync(snapRoot)
      ? readdirSync(snapRoot).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b) : [];
    const problems = [];
    const cur = Number(currentVersion);
    const first = versions[0];
    if (versions.length > 1 && first !== cur) {
      const firstF = loadFindingsForVersion(root, String(first));
      if (!firstF.standards || !firstF.visual) problems.push(`首版 v${first} 缺全量双评审（首版必须全量，规范 27.5）`);
    }
    let deltaCount = 0, fullCount = 0;
    for (const v of versions.filter((x) => x > first && x < cur)) {
      const full = loadFindingsForVersion(root, String(v));
      if (full.standards && full.visual) { fullCount++; continue; }
      const frozenV = loadFrozenRules(root, String(v));
      for (const reviewer of ["standards", "visual"]) {
        const d = loadReviewerFindings(root, reviewer, String(v));
        if (!d) { problems.push(`中间版 v${v} 缺 ${reviewer} 评审（全量或 delta 均无/非法）`); continue; }
        if (d.kind !== "delta") continue; // 单侧全量 + 单侧 delta 的混排按各自规则查
        if (!frozenV.ok) { problems.push(`中间版 v${v} 冻结规则不可用: ${frozenV.errors[0]}`); continue; }
        const baseline = loadReviewerFindings(root, reviewer, d.doc.baseline_version);
        const issues = semanticIssuesDelta(d.doc, baseline, frozenV, root);
        if (issues.length) problems.push(`中间版 v${v} ${reviewer} delta 不通过: ${issues[0]}`);
        else deltaCount++;
      }
      const deltaDir = join(snapRoot, String(v), "delta");
      if (existsSync(deltaDir)) {
        try {
          const cf = JSON.parse(readFileSync(join(deltaDir, "changed-files.json"), "utf8"));
          problems.push(...deltaIssues(root, cf.baseline_version, String(v)).map((s) => `v${v}: ${s}`));
        } catch (e) { problems.push(`v${v} delta/changed-files.json 不可读: ${String(e.message).split("\n")[0]}`); }
      }
    }
    add("迭代评审链", problems.length === 0 ? "pass" : "fail",
      problems.length ? problems.slice(0, 4).join("; ")
        : `${versions.length} 个版本评审链完整（首版全量，中间版全量 ${fullCount} 个 / delta 评审 ${deltaCount} 份，拟交付版由标准/视觉门全量把守）`);
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
    if ((r.checks_version ?? 1) < 5) problems.push("results.json 为旧版检查产物（缺移动视口页边距渲染检查（v1.6）或更早能力：核心任务场景/200% 缩放/可见焦点/裁切/CLS/同源指纹/截图默认态复位），请重跑 browser-check");
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
    const tf = r.task_flows;
    if (tf) {
      if (tf.definition_errors?.length) problems.push(`核心任务场景定义问题: ${tf.definition_errors.slice(0, 3).join("; ")}`);
      if (tf.failures?.length) problems.push(`核心任务执行失败 ${tf.failures.length}/${tf.total}: ${tf.failures.slice(0, 3).map((x) => `${x.id}(${x.error})`).join("; ")}`);
    } else if ((r.checks_version ?? 1) >= 3) problems.push("results.json 缺 task_flows");
    add("无障碍与渲染", problems.length === 0 ? "pass" : "fail",
      problems.length ? problems.join("; ") : `同源指纹一致；axe 严重违规 0，键盘可达 100%，可见焦点 100%，控制台 0 错，reflow/200% 缩放 OK，无裁切，CLS≤${maxCls}，核心任务场景 ${tf?.passed ?? 0}/${tf?.total ?? 0} 通过（含错误路径）`);
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
