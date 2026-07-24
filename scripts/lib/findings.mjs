// findings 加载与校验（规范 7.8）。评审只返回结构，Director 经此校验后落盘。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { makeValidator } from "./rules.mjs";
import { SCHEMAS } from "./paths.mjs";

let _validate;
function validator() {
  if (!_validate) {
    const ajv = makeValidator();
    _validate = ajv.compile(JSON.parse(readFileSync(SCHEMAS.findings, "utf8")));
  }
  return _validate;
}

export function validateFindingsDoc(doc) {
  const validate = validator();
  const ok = validate(doc);
  return { ok, errors: ok ? [] : validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`) };
}

// 读取某交付包中，对应 artifact_version 的两份 findings（standards + visual）。
export function loadFindingsForVersion(pkgRoot, artifactVersion) {
  const dir = join(pkgRoot, "audit", "findings");
  const out = { standards: null, visual: null, errors: [] };
  if (!existsSync(dir)) { out.errors.push("audit/findings 目录不存在"); return out; }
  for (const reviewer of ["standards", "visual"]) {
    const file = join(dir, `${reviewer}-${artifactVersion}.yaml`);
    if (!existsSync(file)) { out.errors.push(`缺当前版本 findings: ${reviewer}-${artifactVersion}.yaml`); continue; }
    const doc = yaml.load(readFileSync(file, "utf8"));
    const v = validateFindingsDoc(doc);
    if (!v.ok) { out.errors.push(`${reviewer}-${artifactVersion}.yaml schema 失败: ${v.errors.join("; ")}`); continue; }
    if (doc.artifact_version !== artifactVersion) {
      out.errors.push(`${reviewer} findings artifact_version=${doc.artifact_version} 与当前 ${artifactVersion} 不符`);
      continue;
    }
    if (doc.reviewer !== reviewer) { out.errors.push(`${reviewer} findings reviewer 字段=${doc.reviewer} 不符`); continue; }
    out[reviewer] = doc;
  }
  return out;
}

export function countBlockers(doc) {
  return (doc?.findings ?? []).filter((f) => f.severity === "blocker").length;
}
