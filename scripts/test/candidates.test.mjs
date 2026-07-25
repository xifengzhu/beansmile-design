// 执行竞争门禁语义测试：竞争确实发生、每个候选都被看过、选择被记录。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { candidateIssues, collectCandidates } from "../lib/candidates.mjs";

// 各候选内容必须真实不同（规范 24.1），fixture 默认按候选名区分内容。
function makePkg(cands = ["cand-1", "cand-2"], { selection } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bsd-cand-"));
  for (const cand of cands) {
    const cd = join(dir, "audit", "candidates", cand);
    mkdirSync(cd, { recursive: true });
    writeFileSync(join(cd, "index.html"), `<html><!-- ${cand} 构成 --></html>`);
    writeFileSync(join(cd, `index.desktop-1440.png`), `PNG-${cand}`);
  }
  if (selection !== undefined) writeFileSync(join(dir, "audit", "candidates", "selection.md"), selection);
  return dir;
}

const GOOD_SELECTION = `# 候选对比与择优

## cand-1（不对称分栏）
cand-1/index.desktop-1440.png：构成有张力，display 76px 与正文形成 4.75× 跳跃，但首屏记忆点只有字号 1 处。

## cand-2（编辑错位）
cand-2/index.desktop-1440.png：标题跨栏压图 120px，粗细线系统 + 首字下沉共 3 处手法落地，构成明显更完整。

chosen: cand-2
理由：cand-2 关键手法落地 3 处 > cand-1 的 1 处，错位构成的品牌辨识度更强；行长 34 字合规。
`;

test("完整竞争（≥2 候选、各有截图、selection 逐个引用并声明 chosen）→ 通过", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  assert.deepEqual(candidateIssues(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test("缺 audit/candidates/ → 竞争未发生", () => {
  const dir = mkdtempSync(join(tmpdir(), "bsd-cand-"));
  assert.ok(candidateIssues(dir).some((s) => s.includes("执行竞争未发生")));
  rmSync(dir, { recursive: true, force: true });
});

test("候选仅 1 个 → 拒绝（自弹自唱不是竞争）", () => {
  const dir = makePkg(["cand-1"], { selection: GOOD_SELECTION.replaceAll("cand-2", "cand-1") });
  assert.ok(candidateIssues(dir).some((s) => s.includes("候选仅 1 个")));
  rmSync(dir, { recursive: true, force: true });
});

test("候选无截图 → 拒绝（不许纸上谈兵）", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  rmSync(join(dir, "audit", "candidates", "cand-2", "index.desktop-1440.png"));
  assert.ok(candidateIssues(dir).some((s) => s.includes("cand-2 无截图")));
  rmSync(dir, { recursive: true, force: true });
});

test("缺 selection.md / 过短 / 缺 chosen 声明 → 逐项拒绝", () => {
  const noSel = makePkg();
  assert.ok(candidateIssues(noSel).some((s) => s.includes("缺 audit/candidates/selection.md")));
  rmSync(noSel, { recursive: true, force: true });

  const short = makePkg(["cand-1", "cand-2"], { selection: "选 cand-2，chosen: cand-2" });
  assert.ok(candidateIssues(short).some((s) => s.includes("过短")));
  rmSync(short, { recursive: true, force: true });

  const noChosen = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION.replace("chosen: cand-2", "选了第二个") });
  assert.ok(candidateIssues(noChosen).some((s) => s.includes("缺 `chosen: cand-N` 声明")));
  rmSync(noChosen, { recursive: true, force: true });
});

test("chosen 指向不存在的候选 → 拒绝", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION.replace("chosen: cand-2", "chosen: cand-9") });
  assert.ok(candidateIssues(dir).some((s) => s.includes("不存在的候选 cand-9")));
  rmSync(dir, { recursive: true, force: true });
});

test("selection.md 未以限定路径引用某候选的截图 → 拒绝（每个候选都要看过；裸文件名同名蒙混无效）", () => {
  const sel = GOOD_SELECTION.replace("cand-1/index.desktop-1440.png：构成有张力，display 76px 与正文形成 4.75× 跳跃，但首屏记忆点只有字号 1 处。",
    "index.desktop-1440.png：没细看，感觉不如另一个。"); // 裸文件名与 cand-2 同名，不构成对 cand-1 的引用
  const dir = makePkg(["cand-1", "cand-2"], { selection: sel });
  assert.ok(candidateIssues(dir).some((s) => s.includes("未以 cand-1/<截图名> 形式引用")));
  rmSync(dir, { recursive: true, force: true });
});

// —— 候选同一性（规范 24.1）——

test("两个候选 HTML 字节相同 → 拒绝（复制粘贴不是竞争）", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  writeFileSync(join(dir, "audit", "candidates", "cand-2", "index.html"), "<html><!-- cand-1 构成 --></html>");
  assert.ok(candidateIssues(dir).some((s) => s.includes("HTML 内容完全相同")));
  rmSync(dir, { recursive: true, force: true });
});

test("HTML 改名但内容相同仍被识别（摘要与文件名无关）", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  rmSync(join(dir, "audit", "candidates", "cand-2", "index.html"));
  writeFileSync(join(dir, "audit", "candidates", "cand-2", "home.html"), "<html><!-- cand-1 构成 --></html>");
  assert.ok(candidateIssues(dir).some((s) => s.includes("HTML 内容完全相同")));
  rmSync(dir, { recursive: true, force: true });
});

test("HTML 不同但截图字节相同 → 拒绝（截图并非渲染自各自候选）", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  writeFileSync(join(dir, "audit", "candidates", "cand-2", "index.desktop-1440.png"), "PNG-cand-1");
  assert.ok(candidateIssues(dir).some((s) => s.includes("截图完全相同")));
  rmSync(dir, { recursive: true, force: true });
});

test("仅一字符差异 → 机器门放行（字节级同一是机器边界，近似重复留给评审方向对标）", () => {
  const dir = makePkg(["cand-1", "cand-2"], { selection: GOOD_SELECTION });
  writeFileSync(join(dir, "audit", "candidates", "cand-2", "index.html"), "<html><!-- cand-1 构成! --></html>");
  assert.deepEqual(candidateIssues(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test("collectCandidates 按序号排序且忽略非 cand-* 目录", () => {
  const dir = makePkg(["cand-2", "cand-10", "cand-1"], { selection: GOOD_SELECTION });
  mkdirSync(join(dir, "audit", "candidates", "notes"), { recursive: true });
  assert.deepEqual(collectCandidates(dir).cands, ["cand-1", "cand-2", "cand-10"]);
  rmSync(dir, { recursive: true, force: true });
});
