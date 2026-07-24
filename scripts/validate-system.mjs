#!/usr/bin/env node
// 系统一致性总校验：依据库 + Skill 清单 + 注册表一致性。
import { validateRules } from "./lib/rules.mjs";
import { validateManifests } from "./lib/manifests.mjs";
import { validateRegistry } from "./lib/registry.mjs";

let ok = true;
function report(name, r, summary) {
  if (r.ok) {
    console.log(`✓ ${name}：${summary}`);
  } else {
    ok = false;
    console.error(`✗ ${name} 失败：`);
    for (const e of r.errors) console.error(`  - ${e}`);
  }
}

const rules = validateRules();
report("依据库", rules, `${rules.count} 条规则`);
const manifests = validateManifests();
report("Skill 清单", manifests, `${manifests.count} 个 Skill`);
const registry = validateRegistry();
report("注册表一致性", registry, `${registry.count} 个条目，flow↔manifest 一一对应`);

process.exit(ok ? 0 : 1);
