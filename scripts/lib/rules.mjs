// 依据库加载与完整性校验。
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { RULES_DIR, SCHEMAS } from "./paths.mjs";

export function makeValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

// 读取 evidence/rules 下所有 *.yaml，返回 { rules, byId, files }。
export function loadRules() {
  const files = readdirSync(RULES_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  const rules = [];
  for (const file of files) {
    const doc = yaml.load(readFileSync(resolve(RULES_DIR, file), "utf8"));
    if (!doc || !Array.isArray(doc.rules)) {
      throw new Error(`${file}: 缺少顶层 rules 数组`);
    }
    for (const r of doc.rules) rules.push({ ...r, _file: file });
  }
  const byId = new Map();
  for (const r of rules) byId.set(r.id, r);
  return { rules, byId, files };
}

// 校验：逐条 schema 合规 + id 唯一 + conflicts_with 引用可解析。
export function validateRules() {
  const ajv = makeValidator();
  const schema = JSON.parse(readFileSync(SCHEMAS.ruleCard, "utf8"));
  const validate = ajv.compile(schema);
  const { rules, byId, files } = loadRules();
  const errors = [];

  const seen = new Map();
  for (const r of rules) {
    const where = `${r._file} :: ${r.id ?? "(缺 id)"}`;
    const { _file, ...card } = r;
    if (!validate(card)) {
      for (const e of validate.errors) {
        errors.push(`${where}: ${e.instancePath || "(root)"} ${e.message}`);
      }
    }
    if (r.id) {
      if (seen.has(r.id)) errors.push(`重复 id: ${r.id}（${seen.get(r.id)} 与 ${r._file}）`);
      else seen.set(r.id, r._file);
    }
  }

  for (const r of rules) {
    for (const c of r.conflicts_with ?? []) {
      if (!byId.has(c)) errors.push(`${r.id}: conflicts_with 指向不存在的规则 ${c}`);
    }
  }

  return { ok: errors.length === 0, errors, count: rules.length, files };
}
