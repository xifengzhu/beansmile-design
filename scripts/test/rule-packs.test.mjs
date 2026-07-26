// 规则包注册表与激活矩阵测试（分层扩展 §10.1/§10.2）。
// lib 函数用合成 packs/rules 对象直接测；涉及真实注册表的用 loadRulePacks 实测。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRules } from "../lib/rules.mjs";
import { loadRulePacks, validateRulePacks, applicableRules, canonicalRuleHash } from "../lib/rule-packs.mjs";
import { industryPackFile } from "../lib/findings.mjs";

// —— 合成夹具 ——

const RULE = (id, file, extra = {}) => ({
  id, title: id, rule: "r", publisher: "P",
  source_url: `https://good.example-authority.org/${id}`,
  source_version: "v1", last_verified: "2026-07-25",
  platforms: ["web", "mobile_web"], scope: ["x"], strength: "recommended",
  evidence_grade: "B", rationale: "r", check_method: "manual",
  _file: file, ...extra,
});

const HOST = "good.example-authority.org";

function basePacks() {
  return [
    { id: "p-a", kind: "foundation", files: ["a.yaml"], activation: { type: "always" }, allowed_source_hosts: [HOST] },
    { id: "p-b", kind: "industry", files: ["industry-b.yaml"], activation: { type: "industry", values: ["b_ind"] }, allowed_source_hosts: [HOST] },
  ];
}
function baseRules() {
  return [RULE("a-one", "a.yaml"), RULE("b-one", "industry-b.yaml")];
}
const FILES = ["a.yaml", "industry-b.yaml"];

function check(mutate = () => {}, { packs = basePacks(), rules = baseRules(), ruleFiles = [...FILES] } = {}) {
  mutate({ packs, rules, ruleFiles });
  return validateRulePacks({ packs, rules, ruleFiles });
}

// —— 正向：真实注册表 ——

test("真实注册表通过 validateRulePacks，8 个规则文件恰好归包", () => {
  const r = validateRulePacks();
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  const { packs, byFile } = loadRulePacks();
  const { files } = loadRules();
  assert.equal(files.length, 8);
  for (const f of files) assert.ok(byFile.has(f), `文件未归包: ${f}`);
  assert.equal(packs.reduce((n, p) => n + p.files.length, 0), files.length);
});

test("回归：{web,mobile_web} + general + none 的适用集与旧筛选逻辑逐 id 一致", () => {
  const { rules } = loadRules();
  const { packs } = loadRulePacks();
  const project = { platforms: ["web", "mobile_web"], industry: "general", reference_system: "none" };
  const got = applicableRules(project, rules, packs).map((a) => a.rule_id).sort();
  // 旧逻辑：industry-*.yaml 只在 industry 匹配（文件名归一）时进入；其余按平台交集。
  const legacy = rules.filter((r) => {
    const file = r._file ?? "";
    if (file.startsWith("industry-") && file !== industryPackFile(project.industry)) return false;
    return (r.platforms ?? []).some((p) => project.platforms.includes(p));
  }).map((r) => r.id).sort();
  assert.deepEqual(got, legacy);
  assert.ok(got.length > 0);
});

test("ecommerce 项目激活 industry-ecommerce；saas_b2b 精确匹配注册表原始 slug", () => {
  const { rules } = loadRules();
  const { packs } = loadRulePacks();
  const ecom = applicableRules({ platforms: ["web"], industry: "ecommerce", reference_system: "none" }, rules, packs);
  assert.ok(ecom.some((a) => a.pack_id === "industry-ecommerce"));
  assert.ok(!ecom.some((a) => a.pack_id === "industry-saas-b2b"));
  const saas = applicableRules({ platforms: ["web"], industry: "saas_b2b", reference_system: "none" }, rules, packs);
  assert.ok(saas.some((a) => a.pack_id === "industry-saas-b2b"));
  assert.ok(!saas.some((a) => a.pack_id === "industry-ecommerce"));
});

test("applicableRules 返回结构完整：rule/rule_id/pack_id/file/rule_sha256", () => {
  const out = applicableRules({ platforms: ["web"], reference_system: "none" }, baseRules(), basePacks());
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.rule_id, "a-one");
  assert.equal(a.pack_id, "p-a");
  assert.equal(a.file, "a.yaml");
  assert.match(a.rule_sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.rule.id, "a-one");
});

// —— 对抗：注册表结构（§10.1）——

test("重复归属：同一文件属于两个包 → 拒绝", () => {
  const r = check(({ packs }) => { packs[1].files.push("a.yaml"); });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("重复归属") && e.includes("a.yaml")));
});

test("幽灵文件：注册表引用不存在的 yaml → 拒绝", () => {
  const r = check(({ packs }) => { packs[0].files.push("ghost.yaml"); });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("幽灵文件") && e.includes("ghost.yaml")));
});

test("孤儿文件：evidence/rules 有文件未归包 → 拒绝", () => {
  const r = check(({ ruleFiles }) => { ruleFiles.push("orphan.yaml"); });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("孤儿文件") && e.includes("orphan.yaml")));
});

test("空包 → 拒绝", () => {
  const r = check(({ packs }) => { packs.push({ id: "p-empty", kind: "craft", files: [], activation: { type: "always" }, allowed_source_hosts: [HOST] }); });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("空包") || e.includes("minItems")));
});

test("重复包 id → 拒绝", () => {
  const r = check(({ packs, ruleFiles }) => {
    packs.push({ id: "p-a", kind: "craft", files: ["c.yaml"], activation: { type: "always" }, allowed_source_hosts: [HOST] });
    ruleFiles.push("c.yaml");
  });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("重复包 id: p-a")));
});

test("未知 activation type → schema 拒绝", () => {
  const r = check(({ packs }) => { packs[0].activation = { type: "sometimes" }; });
  assert.ok(!r.ok && r.errors.some((e) => e.startsWith("schema:")));
});

test("type=always 带 values → schema 拒绝", () => {
  const r = check(({ packs }) => { packs[0].activation = { type: "always", values: ["x"] }; });
  assert.ok(!r.ok && r.errors.some((e) => e.startsWith("schema:")));
});

test("industry 包缺 values / values 为空 → schema 拒绝", () => {
  const missing = check(({ packs }) => { packs[1].activation = { type: "industry" }; });
  assert.ok(!missing.ok);
  const empty = check(({ packs }) => { packs[1].activation = { type: "industry", values: [] }; });
  assert.ok(!empty.ok);
});

test("空 allowed_source_hosts → 拒绝", () => {
  const r = check(({ packs }) => { packs[0].allowed_source_hosts = []; });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("allowed_source_hosts") || e.startsWith("schema:")));
});

test("包内卡 source_url host 不在白名单 → 拒绝", () => {
  const r = check(({ rules }) => { rules[0].source_url = "https://random-blog.example.net/post"; });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("不在包白名单") && e.includes("a-one")));
});

test("同 type 激活值跨包重复 → 拒绝；不同 type 同值不冲突", () => {
  const dup = check(({ packs, ruleFiles }) => {
    packs.push({ id: "p-b2", kind: "industry", files: ["industry-b2.yaml"], activation: { type: "industry", values: ["b_ind"] }, allowed_source_hosts: [HOST] });
    ruleFiles.push("industry-b2.yaml");
  });
  assert.ok(!dup.ok && dup.errors.some((e) => e.includes("激活值跨包重复") && e.includes("b_ind")));
  const ok = check(({ packs, ruleFiles, rules }) => {
    packs.push({
      id: "p-rs", kind: "reference_system", files: ["system-b.yaml"],
      activation: { type: "reference_system", values: ["b_ind"] }, allowed_source_hosts: [HOST],
      dimensions: { layout: "covered", typography: "covered", color: "covered", spacing: "covered", components: "covered", interaction: "covered", content: "covered", accessibility: "covered" },
    });
    ruleFiles.push("system-b.yaml");
    rules.push(RULE("sys-one", "system-b.yaml"));
  });
  assert.deepEqual(ok.errors, []);
});

// —— 对抗：reference_system 包纪律 ——

function rsPack(dimensions) {
  return {
    id: "system-x", kind: "reference_system", files: ["system-x.yaml"],
    activation: { type: "reference_system", values: ["x_sys"] }, allowed_source_hosts: [HOST],
    ...(dimensions !== undefined ? { dimensions } : {}),
  };
}
const FULL_DIMS = { layout: "covered", typography: "covered", color: "covered", spacing: "covered", components: "covered", interaction: "covered", content: "covered", accessibility: "covered" };

test("reference_system 包含 strength: required → 拒绝", () => {
  const r = check(({ packs, rules, ruleFiles }) => {
    packs.push(rsPack(FULL_DIMS));
    ruleFiles.push("system-x.yaml");
    rules.push(RULE("sys-req", "system-x.yaml", { strength: "required" }));
  });
  assert.ok(!r.ok && r.errors.some((e) => e.includes("reference_system 包不得含 strength: required")));
});

test("reference_system 包缺 dimensions / 八维缺项 → schema 拒绝", () => {
  const none = check(({ packs, rules, ruleFiles }) => {
    packs.push(rsPack(undefined));
    ruleFiles.push("system-x.yaml");
    rules.push(RULE("sys-one", "system-x.yaml"));
  });
  assert.ok(!none.ok);
  const { accessibility, ...seven } = FULL_DIMS;
  const partial = check(({ packs, rules, ruleFiles }) => {
    packs.push(rsPack(seven));
    ruleFiles.push("system-x.yaml");
    rules.push(RULE("sys-one", "system-x.yaml"));
  });
  assert.ok(!partial.ok);
});

test("dimensions not_applicable 缺 reason → schema 拒绝；带 reason → 通过", () => {
  const noReason = check(({ packs, rules, ruleFiles }) => {
    packs.push(rsPack({ ...FULL_DIMS, content: { status: "not_applicable" } }));
    ruleFiles.push("system-x.yaml");
    rules.push(RULE("sys-one", "system-x.yaml"));
  });
  assert.ok(!noReason.ok);
  const withReason = check(({ packs, rules, ruleFiles }) => {
    packs.push(rsPack({ ...FULL_DIMS, content: { status: "not_applicable", reason: "该系统不提供内容写作规范" } }));
    ruleFiles.push("system-x.yaml");
    rules.push(RULE("sys-one", "system-x.yaml"));
  });
  assert.deepEqual(withReason.errors, []);
});

// —— 激活矩阵（§10.2）——

const RS_PACKS = () => [...basePacks(), { ...rsPack(FULL_DIMS) }];
const RS_RULES = () => [...baseRules(), RULE("sys-one", "system-x.yaml")];

test("reference_system=none / 缺失 → 不激活任何 reference_system 包", () => {
  for (const project of [{ platforms: ["web"], reference_system: "none" }, { platforms: ["web"] }]) {
    const out = applicableRules(project, RS_RULES(), RS_PACKS());
    assert.ok(!out.some((a) => a.pack_id === "system-x"));
    assert.ok(out.some((a) => a.rule_id === "a-one"));
  }
});

test("选定 x_sys → 激活 system-x 包；行业不匹配不激活行业包", () => {
  const out = applicableRules({ platforms: ["web"], industry: "other_ind", reference_system: "x_sys" }, RS_RULES(), RS_PACKS());
  assert.ok(out.some((a) => a.pack_id === "system-x"));
  assert.ok(!out.some((a) => a.pack_id === "p-b"));
});

test("未知 reference_system 值 → 抛错，不自动回退（§9.2）", () => {
  assert.throws(
    () => applicableRules({ platforms: ["web"], reference_system: "fluent" }, RS_RULES(), RS_PACKS()),
    /未知主参考系统.*fluent/
  );
});

test("平台交集为空的规则不进入适用集", () => {
  const rules = [RULE("a-ios", "a.yaml", { platforms: ["ios"] }), RULE("a-web", "a.yaml")];
  const out = applicableRules({ platforms: ["web"], reference_system: "none" }, rules, basePacks());
  assert.deepEqual(out.map((a) => a.rule_id), ["a-web"]);
});

// —— 规范化哈希 ——

test("canonicalRuleHash：键序不同的等价卡（含嵌套）哈希相同；内容不同则不同；_file 不参与", () => {
  const a = { id: "r1", title: "t", platforms: ["web"], meta: { x: 1, y: [{ b: 2, a: 1 }] }, _file: "f1.yaml" };
  const b = { _file: "f2.yaml", meta: { y: [{ a: 1, b: 2 }], x: 1 }, platforms: ["web"], title: "t", id: "r1" };
  assert.equal(canonicalRuleHash(a), canonicalRuleHash(b));
  assert.notEqual(canonicalRuleHash(a), canonicalRuleHash({ ...a, title: "t2" }));
});
