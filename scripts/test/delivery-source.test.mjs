import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { buildDeliverySource, verifyDeliverySource } from "../lib/design-source.mjs";
import { canonicalDigest } from "../lib/hash.mjs";
import { makeReviewedDesignPackage } from "./design-delivery-fixture.mjs";

const CLI = resolve(import.meta.dirname, "..", "prepare-delivery.mjs");

test("delivery source is deterministic and detects append-only decision drift", () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const first = buildDeliverySource(pkg.root, { now: "2026-07-27T02:00:00Z" });
    const second = buildDeliverySource(pkg.root, { now: "2026-07-28T02:00:00Z" });
    assert.equal(first.source_bundle_digest, second.source_bundle_digest);
    assert.deepEqual(verifyDeliverySource(pkg.root, second), []);
    const paths = second.files.map((entry) => entry.path);
    for (const required of [
      "audit/delivery/context.yaml",
      "audit/snapshots/3/manifest.json",
      "audit/snapshots/3/Design.md",
      "decisions.md",
      "audit/results.json",
      "audit/report.md",
      "audit/findings/standards-3.yaml",
      "audit/findings/visual-3.yaml",
      "audit/screenshots/final.png",
    ]) assert.ok(paths.includes(required), required);

    writeFileSync(join(pkg.root, "decisions.md"), "changed after bundle\n");
    assert.ok(verifyDeliverySource(pkg.root, second).some((issue) => /decisions\.md/.test(issue)));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("delivery source fails closed on every frozen evidence class", () => {
  const cases = [
    ["snapshot digest", (root) => {
      const path = join(root, "audit", "snapshots", "3", "manifest.json");
      const doc = JSON.parse(readFileSync(path, "utf8"));
      doc.digest = "f".repeat(64);
      writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    }, /snapshot|manifest/],
    ["contract lock", (root) => writeFileSync(join(root, "audit", "design", "contract-lock.json"), "{}\n"), /lock/],
    ["snapshot contract", (root) => writeFileSync(join(root, "audit", "snapshots", "3", "Design.md"), "changed\n"), /snapshot|Design\.md|快照/],
    ["findings", (root) => writeFileSync(join(root, "audit", "findings", "visual-3.yaml"), "changed\n"), /findings/],
    ["results", (root) => writeFileSync(join(root, "audit", "results.json"), "{}\n"), /results\.json/],
    ["report", (root) => writeFileSync(join(root, "audit", "report.md"), "changed\n"), /report\.md/],
    ["screenshots", (root) => writeFileSync(join(root, "audit", "screenshots", "final.png"), "changed\n"), /screenshots/],
    ["active tokens", (root) => writeFileSync(join(root, "design-tokens.json"), '{"direction_id":"D3","semantic":{"color":{"primary":"#ffffff"}}}\n'), /design-tokens|活动产物|快照/],
    ["active prototype", (root) => writeFileSync(join(root, "prototype", "index.html"), "changed after review\n"), /prototype|活动产物|快照/],
    ["context projection", (root) => {
      const path = join(root, "context.yaml");
      const ctx = yaml.load(readFileSync(path, "utf8"));
      ctx.goals.user_tasks.push("新增未经冻结的任务");
      writeFileSync(path, yaml.dump(ctx));
    }, /context/],
  ];
  for (const [name, mutate, expected] of cases) {
    const pkg = makeReviewedDesignPackage();
    try {
      const manifest = buildDeliverySource(pkg.root);
      mutate(pkg.root);
      assert.ok(verifyDeliverySource(pkg.root, manifest).some((issue) => expected.test(issue)), name);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("delivery source binds the current contract revision", () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const manifest = buildDeliverySource(pkg.root);
    const changed = { ...manifest, contract_revision: 99 };
    const { generated_at, source_bundle_digest, ...payload } = changed;
    changed.source_bundle_digest = canonicalDigest(payload);
    assert.ok(
      verifyDeliverySource(pkg.root, changed).some((issue) => /contract revision|contract_revision/.test(issue)),
    );
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("delivery source rejects locked contract context drift before freezing", () => {
  const cases = [
    ["task", (ctx) => ctx.goals.user_tasks.push("删除账户")],
    ["constraint", (ctx) => ctx.constraints.push("必须支持离线模式")],
  ];
  for (const [name, mutate] of cases) {
    const pkg = makeReviewedDesignPackage();
    try {
      const contextPath = join(pkg.root, "context.yaml");
      const ctx = yaml.load(readFileSync(contextPath, "utf8"));
      mutate(ctx);
      writeFileSync(contextPath, yaml.dump(ctx));
      assert.throws(
        () => buildDeliverySource(pkg.root),
        /contract.*context|context.*契约|冻结.*context/i,
        name,
      );
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("delivery source accepts authorized post-lock design facts", () => {
  const cases = [
    ["decision", (ctx) => ctx.decisions.push({
      id: "visual-density",
      summary: "采用紧凑密度",
      decided_by: "director",
    })],
    ["assumption", (ctx) => ctx.assumptions.push({
      id: "browser-rendered",
      statement: "浏览器渲染结果已人工复核",
      status: "confirmed",
      source: "verified",
    })],
    ["exception", (ctx) => ctx.exceptions.push({
      id: "native-check-pending",
      rule_id: "wcag-1.4.3-contrast-minimum",
      reason: "原生壳层尚未接入",
      risk: "原生环境仍需复核",
      scope: "native shell",
    })],
  ];
  for (const [name, mutate] of cases) {
    const pkg = makeReviewedDesignPackage();
    try {
      const contextPath = join(pkg.root, "context.yaml");
      const ctx = yaml.load(readFileSync(contextPath, "utf8"));
      mutate(ctx);
      writeFileSync(contextPath, yaml.dump(ctx));
      assert.doesNotThrow(() => buildDeliverySource(pkg.root), name);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("delivery source preserves facts already frozen into the contract context", () => {
  const cases = [
    ["deleted decision", (ctx) => { ctx.decisions = []; }],
    ["rewritten decision", (ctx) => { ctx.decisions[0].summary = "改写已锁定方向"; }],
    ["duplicate decision", (ctx) => { ctx.decisions.push({ ...ctx.decisions[0] }); }],
  ];
  for (const [name, mutate] of cases) {
    const pkg = makeReviewedDesignPackage();
    try {
      const contextPath = join(pkg.root, "context.yaml");
      const ctx = yaml.load(readFileSync(contextPath, "utf8"));
      mutate(ctx);
      writeFileSync(contextPath, yaml.dump(ctx));
      assert.throws(
        () => buildDeliverySource(pkg.root),
        /冻结.*decision|decision.*删除|decision.*改写|decision.*重复/i,
        name,
      );
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});

test("delivery source allows a frozen tentative assumption to resolve", () => {
  const pkg = makeReviewedDesignPackage({
    initialAssumptions: [{
      id: "browser-available",
      statement: "交付环境可运行真实浏览器",
      status: "tentative",
      source: "inferred",
    }],
  });
  try {
    const contextPath = join(pkg.root, "context.yaml");
    const ctx = yaml.load(readFileSync(contextPath, "utf8"));
    ctx.assumptions[0].status = "confirmed";
    writeFileSync(contextPath, yaml.dump(ctx));
    assert.doesNotThrow(() => buildDeliverySource(pkg.root));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("delivery source rejects paths escaping the package", () => {
  const pkg = makeReviewedDesignPackage();
  try {
    const manifest = buildDeliverySource(pkg.root);
    const escaped = structuredClone(manifest);
    escaped.files[0].path = "../outside.md";
    const { generated_at, source_bundle_digest, ...payload } = escaped;
    escaped.source_bundle_digest = canonicalDigest(payload);
    assert.ok(verifyDeliverySource(pkg.root, escaped).some((issue) => /越界|包外|非法路径/.test(issue)));
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("delivery source replacement is atomic on interruption", () => {
  const pkg = makeReviewedDesignPackage();
  try {
    buildDeliverySource(pkg.root, { now: "2026-07-27T02:00:00Z" });
    const manifestPath = join(pkg.root, "audit", "delivery", "source-manifest.json");
    const contextPath = join(pkg.root, "audit", "delivery", "context.yaml");
    const oldManifest = readFileSync(manifestPath);
    const oldContext = readFileSync(contextPath);
    assert.throws(() => buildDeliverySource(pkg.root, {
      now: "2026-07-28T02:00:00Z",
      beforeCommit: () => { throw new Error("interrupt"); },
    }), /interrupt/);
    assert.deepEqual(readFileSync(manifestPath), oldManifest);
    assert.deepEqual(readFileSync(contextPath), oldContext);
    assert.equal(readdirSync(join(pkg.root, "audit")).some((entry) => entry.startsWith(".tmp-delivery-")), false);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }
});

test("delivery preparation requires review stage, clean full reviews, and explicit overwrite", () => {
  const pkg = makeReviewedDesignPackage();
  try {
    let result = spawnSync("node", [CLI, "--package", pkg.root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    result = spawnSync("node", [CLI, "--package", pkg.root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /overwrite|已存在/);
    result = spawnSync("node", [CLI, "--package", pkg.root, "--overwrite"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(pkg.root, { recursive: true, force: true });
  }

  const invalidStage = makeReviewedDesignPackage();
  try {
    const path = join(invalidStage.root, "context.yaml");
    const ctx = yaml.load(readFileSync(path, "utf8"));
    ctx.stage = "prototype";
    writeFileSync(path, yaml.dump(ctx));
    const result = spawnSync("node", [CLI, "--package", invalidStage.root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /review/);
  } finally {
    rmSync(invalidStage.root, { recursive: true, force: true });
  }
});

test("delivery preparation rejects blockers and unhandled warnings", () => {
  for (const severity of ["blocker", "warning"]) {
    const pkg = makeReviewedDesignPackage();
    try {
      const path = join(pkg.root, "audit", "findings", "standards-3.yaml");
      const doc = yaml.load(readFileSync(path, "utf8"));
      doc.findings.push({
        id: `${severity}-1`,
        severity,
        location: "prototype/index.html",
        evidence: "实测 320px 下存在需要处理的问题",
        user_impact: "影响用户提交询价",
        recommendation: "修复后重新评审",
      });
      if (severity === "blocker") doc.verdict = "fail";
      writeFileSync(path, yaml.dump(doc));
      assert.throws(() => buildDeliverySource(pkg.root), severity === "blocker" ? /blocker/ : /warning|decisions/);
    } finally {
      rmSync(pkg.root, { recursive: true, force: true });
    }
  }
});
