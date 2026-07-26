// 迭代轮次与增量截图携带链（规范 27.3）。screenshot.mjs（生成端）与 acceptance.mjs
// （校验端）共用本实现：中间轮只重截变更页省 token，验收用"三方哈希一致"的携带链
// 校验封"谎称未变、跳过截图"——伪造需同时篡改两轮 meta，而首末轮强制全量 +
// 末轮与交付原型同源（既有门）锚定交付态真实。
// meta.json v2：meta_version/round/page_hashes(仍全树口径)/tokens_sha256/pages[]/shots[]。
// pages[] 每页 {name, slug, status: "shot"|"carried", shots, from_round?, page_sha256?}；
// carried 只允许一跳引用某个实拍轮（生成时解析到最近 shot 轮，禁转引）。
// 无 meta_version 的 v1.7 meta 按全量轮兼容处理，不追溯。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diffHashMaps } from "./hash.mjs";

export const ITERATION_VIEWPORT_LABELS = ["mobile-375", "tablet-768", "desktop-1440"];

export function expectedShots(slug) {
  return ITERATION_VIEWPORT_LABELS.map((l) => `${slug}.${l}.png`);
}

// 列出 audit/iterations/ 下的轮次目录，按轮号升序。
export function collectRounds(iterRoot) {
  if (!existsSync(iterRoot)) return [];
  return readdirSync(iterRoot).map((d) => /^round-(\d+)$/.exec(d)).filter(Boolean)
    .map((m) => ({ dir: m[0], n: Number(m[1]) })).sort((a, b) => a.n - b.n);
}

export function readRoundMeta(iterRoot, n) {
  const p = join(iterRoot, `round-${n}`, "meta.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// 增量计划（纯函数）。返回 { full, reason? } 或 { full:false, changed:[page], carried:[entry] }。
// 保守规则：assets/**、design-tokens.json 或任何非页面文件变化 → 全部页面视为变更
// （共享样式/共享资源全局生效，防"改共享 CSS 只截一页"）；页面增删同理。
export function planIncremental({ prevMeta, prevRound, currentHashes, tokensSha256, pages, pageSlug }) {
  const prevHashes = prevMeta?.page_hashes;
  if (!prevHashes) return { full: true, reason: "上一轮 meta 缺 page_hashes" };
  if ((prevMeta.meta_version ?? 1) < 2) return { full: true, reason: "上一轮为 v1 meta（无令牌指纹），保守全量" };
  if ((prevMeta.tokens_sha256 ?? null) !== (tokensSha256 ?? null)) {
    return { full: true, reason: "design-tokens.json 有变化（令牌全局生效）" };
  }

  const pageNames = new Set(pages.map((p) => p.name));
  const changedKeys = new Set();
  for (const [k, h] of Object.entries(prevHashes)) if (currentHashes[k] !== h) changedKeys.add(k);
  for (const k of Object.keys(currentHashes)) if (!(k in prevHashes)) changedKeys.add(k);
  for (const k of changedKeys) {
    const rel = k.replace(/^prototype\//, "");
    if (rel.startsWith("assets/")) return { full: true, reason: `共享资源变化: ${k}` };
    if (!k.endsWith(".html") || !pageNames.has(rel)) return { full: true, reason: `非页面文件变化: ${k}` };
  }

  const changed = pages.filter((p) => changedKeys.has(`prototype/${p.name}`));
  const carried = pages.filter((p) => !changedKeys.has(`prototype/${p.name}`)).map((p) => {
    // from_round 解析到最近的实拍轮（禁转引：上一轮若也是 carried，直接沿用其 from_round）
    let from = prevRound;
    const prevEntry = (prevMeta.pages ?? []).find((e) => e?.name === p.name);
    if (prevEntry?.status === "carried" && Number.isInteger(prevEntry.from_round)) from = prevEntry.from_round;
    const slug = pageSlug(p.name);
    return {
      name: p.name, slug, status: "carried", from_round: from,
      page_sha256: currentHashes[`prototype/${p.name}`], shots: expectedShots(slug),
    };
  });
  return { full: false, changed, carried };
}

// 验收「迭代自评」维度的完整判定（原 acceptance 5b 迁入 + 携带链校验）。
// 返回 { exists, rounds, problems }。activeHashes = 当前活动交付物指纹。
export function iterationChainIssues(pkgRoot, activeHashes) {
  const iterRoot = join(pkgRoot, "audit", "iterations");
  if (!existsSync(iterRoot)) return { exists: false, rounds: 0, problems: ["缺 audit/iterations/：截图-自评-迭代循环未发生"] };
  const rounds = collectRounds(iterRoot);
  const problems = [];
  if (rounds.length < 2) problems.push(`仅 ${rounds.length} 轮（要求 ≥2）`);
  const metaByN = new Map(rounds.map((r) => [r.n, readRoundMeta(iterRoot, r.n)]));

  rounds.forEach((r, idx) => {
    const rd = join(iterRoot, r.dir);
    const files = readdirSync(rd);
    const pngs = files.filter((x) => x.endsWith(".png"));
    const meta = metaByN.get(r.n);
    const isV2 = (meta?.meta_version ?? 1) >= 2;
    if (!pngs.length) problems.push(`${r.dir} 无截图`);
    if (!files.includes("meta.json")) problems.push(`${r.dir} 缺 meta.json（旧版截图产物，需用当前 screenshot.mjs 重跑）`);
    else if (!meta) problems.push(`${r.dir}/meta.json 解析失败`);

    if (!files.includes("notes.md")) problems.push(`${r.dir} 缺 notes.md（自评未记录）`);
    else {
      const notes = readFileSync(join(rd, "notes.md"), "utf8").trim();
      if (notes.length < 50) problems.push(`${r.dir}/notes.md 过短（${notes.length} 字符），不构成有效自评`);
      else {
        const newShots = isV2 ? (meta.shots ?? []) : pngs; // v2：只有当轮实际新截的图算自评证据
        if (!newShots.some((p) => notes.includes(p))) {
          problems.push(`${r.dir}/notes.md 未引用当轮实际新截的截图文件名${isV2 ? "（carried 图不算当轮证据）" : ""}`);
        }
      }
    }

    if (!isV2 || !meta) return; // v1.7 meta 按全量轮兼容，不做携带链检查

    for (const s of meta.shots ?? []) {
      if (!files.includes(s)) problems.push(`${r.dir} meta 登记的截图缺失: ${s}`);
    }
    const entries = Array.isArray(meta.pages) ? meta.pages : [];
    const carriedEntries = entries.filter((e) => e?.status === "carried");
    const isFirst = idx === 0, isLast = idx === rounds.length - 1;
    if ((isFirst || isLast) && carriedEntries.length) {
      problems.push(`${r.dir} 为${isFirst ? "首" : "末"}轮但含 carried 页（首末轮必须全量重截）: ${carriedEntries.slice(0, 3).map((e) => e.name).join(",")}`);
    }
    for (const e of carriedEntries) {
      const key = `prototype/${e.name}`;
      if (!Number.isInteger(e.from_round) || e.from_round >= r.n) {
        problems.push(`${r.dir} carried 页 ${e.name} 的 from_round 非法: ${e.from_round}`); continue;
      }
      const src = metaByN.get(e.from_round) ?? readRoundMeta(iterRoot, e.from_round);
      if (!src) { problems.push(`${r.dir} carried 页 ${e.name} 引用的 round-${e.from_round} 不存在或无 meta`); continue; }
      if ((src.meta_version ?? 1) >= 2) {
        const srcEntry = (src.pages ?? []).find((x) => x?.name === e.name);
        if (!srcEntry || srcEntry.status !== "shot") {
          problems.push(`${r.dir} carried 页 ${e.name} 引用的 round-${e.from_round} 中该页非实拍（禁转引 carried→carried）`); continue;
        }
      }
      // 三方哈希一致：当前轮 page_hashes === 引用轮 page_hashes === carried 记录 page_sha256
      const cur = meta.page_hashes?.[key], srcHash = src.page_hashes?.[key];
      if (!(cur && srcHash && e.page_sha256 && cur === srcHash && cur === e.page_sha256)) {
        problems.push(`${r.dir} carried 页 ${e.name} 哈希链断裂（当前轮/round-${e.from_round}/carried 记录三方不一致）——"未变更"声明不成立，须重截`); continue;
      }
      const srcDir = join(iterRoot, `round-${e.from_round}`);
      const srcFiles = existsSync(srcDir) ? readdirSync(srcDir) : [];
      const want = e.shots?.length ? e.shots : expectedShots(e.slug ?? String(e.name).replaceAll("/", "__"));
      for (const s of want) {
        if (!srcFiles.includes(s)) problems.push(`${r.dir} carried 页 ${e.name} 在 round-${e.from_round} 缺截图 ${s}`);
      }
    }
  });

  // 末轮同源（既有门保留）：末轮 page_hashes 与交付原型逐字节一致。
  const last = rounds[rounds.length - 1];
  if (last) {
    const meta = metaByN.get(last.n);
    if (meta) {
      const drift = diffHashMaps(meta.page_hashes ?? {}, activeHashes, ["prototype"]);
      if (drift.length) problems.push(`末轮（${last.dir}）后原型又被改动且未复评: ${drift.slice(0, 3).join("; ")}`);
    }
  }
  return { exists: true, rounds: rounds.length, problems };
}
