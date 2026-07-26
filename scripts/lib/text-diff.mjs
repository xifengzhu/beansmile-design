// 朴素行级 diff（规范 27.5 delta 包用）。无第三方依赖；两侧输入都是冻结快照文件，
// 输出字节确定（可再生比对）。超大文件回退为"仅记录已变更"，不做逐行展开。
const MAX_LINES = 4000;

// LCS 动态规划 + 回溯，输出紧凑 hunk 文本（只含增删行与行号标记）。
export function diffLines(aText, bText, label = "") {
  const a = String(aText).split("\n");
  const b = String(bText).split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return `--- ${label}\n[文件过大（${a.length}→${b.length} 行），仅记录已变更，请直接对照两个快照]\n`;
  }
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度（用 Int32Array 压内存）
  const n = a.length, m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops = []; // { type: "-"|"+", line, text }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { ops.push({ type: "-", line: i + 1, text: a[i] }); i++; }
    else { ops.push({ type: "+", line: j + 1, text: b[j] }); j++; }
  }
  while (i < n) { ops.push({ type: "-", line: i + 1, text: a[i] }); i++; }
  while (j < m) { ops.push({ type: "+", line: j + 1, text: b[j] }); j++; }
  if (!ops.length) return "";
  const lines = [`--- ${label}`];
  for (const op of ops) lines.push(`${op.type}${op.line}: ${op.text}`);
  return lines.join("\n") + "\n";
}
