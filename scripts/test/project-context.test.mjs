// 最小上下文投影测试（规范 27.6）。投影与 hardenedGate 共用同一份 manifest——
// 这里既测 projectContext 纯函数对真实 manifests 的键集收敛，也测 CLI 的出入口。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { projectContext } from "../lib/context.mjs";
import { loadManifests, resolveManifest } from "../lib/manifests.mjs";

const CLI = resolve(import.meta.dirname, "..", "project-context.mjs");

const FULL_CTX = {
  project: { name: "x", mode: "professional", task_type: "new_design", platforms: ["web"], reference_system: "none", industry: "general", package_format_version: 3, delivery_outputs: ["design_specification", "design_presentation"] },
  users: { primary: "访客" },
  goals: ["g1"],
  brand: { tone: "冷静" },
  constraints: ["c1"],
  assumptions: ["a1"],
  decisions: [{ id: "d1", rule_ids: ["wcag-x"] }],
  exceptions: [],
  artifacts: {
    brief: { path: "brief.md", artifact_version: "1" },
    flows: { path: "flows.md", artifact_version: "1" },
    tokens: { path: "design-tokens.json", artifact_version: "1" },
    prototype: { path: "prototype/index.html", artifact_version: "2" },
    design_document: { path: "Design.md", artifact_version: "1", phase: "approved_contract" },
  },
  confirmations: { requirements: { summary: "s", user_reply: "同意" } },
  stage: "prototype",
};

test("正向：html_prototype 投影含 reads 字段，artifacts 下只含 flows/tokens", () => {
  const { bySkill } = loadManifests();
  const view = projectContext(FULL_CTX, bySkill.get("html_prototype").reads);
  assert.deepEqual(Object.keys(view).sort(), ["artifacts", "brand", "constraints", "goals", "project", "users"]);
  assert.deepEqual(Object.keys(view.artifacts).sort(), ["flows", "tokens"]);
  assert.ok(!("prototype" in view.artifacts), "artifacts.prototype 未声明，不得出现");
});

test("对抗：全部 7 个 patch-capable Skill 的投影键集 ⊆ reads 展开（confirmations/decisions 等绝不泄漏）", () => {
  const { manifests } = loadManifests();
  assert.equal(manifests.length, 7);
  for (const m of manifests) {
    const resolved = m.operations ? resolveManifest(m.skill, Object.keys(m.operations)[0]) : m;
    const view = projectContext(FULL_CTX, resolved.reads);
    const allowedTop = new Set(resolved.reads.map((p) => p.split(".")[0]));
    for (const top of Object.keys(view)) {
      assert.ok(allowedTop.has(top), `${m.skill} 投影泄漏了未声明字段: ${top}`);
      const seconds = resolved.reads.filter((p) => p.startsWith(`${top}.`)).map((p) => p.split(".")[1]);
      if (seconds.length) {
        for (const k of Object.keys(view[top])) {
          assert.ok(seconds.includes(k), `${m.skill} 投影泄漏了 ${top}.${k}`);
        }
      }
    }
    // 高危字段：未声明的 Skill 一律不可见
    if (!resolved.reads.some((p) => p.startsWith("confirmations"))) assert.ok(!("confirmations" in view));
    if (!resolved.reads.some((p) => p.startsWith("exceptions"))) assert.ok(!("exceptions" in view));
  }
});

test("design_specification prepare/finalize 投影严格按 operation 分离", () => {
  const prepare = resolveManifest("design_specification", "prepare");
  const finalize = resolveManifest("design_specification", "finalize");
  const prepareView = projectContext(FULL_CTX, prepare.reads);
  const finalizeView = projectContext(FULL_CTX, finalize.reads);
  assert.deepEqual(Object.keys(prepareView.artifacts).sort(), ["brief", "flows"]);
  assert.deepEqual(
    Object.keys(finalizeView.artifacts).sort(),
    ["brief", "design_document", "flows", "prototype", "tokens"],
  );
});

test("CLI：--out 生成带警示头的 YAML，内容与纯函数一致", () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-ctx-"));
  writeFileSync(join(dir, "context.yaml"), yaml.dump(FULL_CTX));
  const out = join(dir, "view.yaml");
  execFileSync("node", [CLI, "--package", dir, "--skill", "visual_system", "--out", out]);
  const text = readFileSync(out, "utf8");
  assert.ok(text.startsWith("# visual_system 的 reads 投影视图"));
  assert.ok(text.includes("不要回写"));
  const parsed = yaml.load(text);
  const { bySkill } = loadManifests();
  assert.deepEqual(parsed, projectContext(FULL_CTX, bySkill.get("visual_system").reads));
  rmSync(dir, { recursive: true, force: true });
});

test("CLI：design_specification 强制 operation，且输出标记 operation", () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-ctx-operation-"));
  writeFileSync(join(dir, "context.yaml"), yaml.dump(FULL_CTX));
  const missing = spawnSync("node", [CLI, "--package", dir, "--skill", "design_specification"]);
  assert.equal(missing.status, 2);
  assert.ok(String(missing.stderr).includes("--operation"));

  const out = join(dir, "prepare.yaml");
  execFileSync("node", [CLI, "--package", dir, "--skill", "design_specification", "--operation", "prepare", "--out", out]);
  assert.ok(readFileSync(out, "utf8").startsWith("# design_specification/prepare 的 reads 投影视图"));

  const normalWithOperation = spawnSync("node", [CLI, "--package", dir, "--skill", "visual_system", "--operation", "prepare"]);
  assert.equal(normalWithOperation.status, 2);
  assert.ok(String(normalWithOperation.stderr).includes("不支持 operation"));
  rmSync(dir, { recursive: true, force: true });
});

test("CLI：未知 skill / 缺 context.yaml → 退出码 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-ctx-"));
  writeFileSync(join(dir, "context.yaml"), yaml.dump(FULL_CTX));
  const bad = spawnSync("node", [CLI, "--package", dir, "--skill", "html-prototype"]); // 连字符=错误形态
  assert.equal(bad.status, 2);
  assert.ok(String(bad.stderr).includes("canonical"));
  const noCtx = mkdtempSync(join(tmpdir(), "proj-ctx-empty-"));
  assert.equal(spawnSync("node", [CLI, "--package", noCtx, "--skill", "visual_system"]).status, 2);
  rmSync(dir, { recursive: true, force: true });
  rmSync(noCtx, { recursive: true, force: true });
});
