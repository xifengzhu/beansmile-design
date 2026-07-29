import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileProtocolIssues } from "../lib/file-protocol.mjs";

function makePrototype(files) {
  const root = mkdtempSync(join(tmpdir(), "file-protocol-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

test("纯静态原型（外链样式+内联脚本）通过 file:// 兼容门", () => {
  const root = makePrototype({
    "prototype/index.html": `<!doctype html><html lang="zh"><head><link rel="stylesheet" href="assets/shared.css"></head>
<body><script>document.title = "ok";</script></body></html>`,
    "prototype/assets/shared.css": "body { color: #111; }",
    "prototype/assets/app.js": "document.querySelector('h1');",
  });
  try {
    assert.deepEqual(fileProtocolIssues(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ES module script 与 fetch/XHR 依赖被 file:// 兼容门拒绝（对抗：门禁 flag 下可通过但客户打开即失效）", () => {
  const root = makePrototype({
    "prototype/index.html": `<!doctype html><html lang="zh"><body>
<script type="module" src="assets/app.mjs"></script>
<script>fetch("./data.json").then((res) => res.json());</script>
</body></html>`,
    "prototype/assets/app.mjs": "export const x = 1;",
    "prototype/assets/loader.js": "const xhr = new XMLHttpRequest();",
  });
  try {
    const issues = fileProtocolIssues(root);
    assert.ok(issues.some((issue) => issue.includes("ES module")), issues.join("\n"));
    assert.ok(issues.some((issue) => issue.includes("prototype/index.html") && issue.includes("fetch")), issues.join("\n"));
    assert.ok(issues.some((issue) => issue.includes("assets/loader.js")), issues.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
