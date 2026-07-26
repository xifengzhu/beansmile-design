#!/usr/bin/env node
// 系统一致性总校验：依据库 + 规则包注册表 + 检查映射登记表 + Skill 清单 + 注册表一致性。
import { validateRules, loadRules } from "./lib/rules.mjs";
import { validateRulePacks } from "./lib/rule-packs.mjs";
import { validateCheckMapping } from "./lib/check-mapping.mjs";
import { validateManifests } from "./lib/manifests.mjs";
import { validateRegistry } from "./lib/registry.mjs";
import { playbookIndexIssues } from "./lib/kb-index.mjs";

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
const rulePacks = validateRulePacks();
report("规则包注册表", rulePacks, `${rulePacks.count} 个包，${loadRules().files.length} 文件全部归包`);
const checkMapping = validateCheckMapping(loadRules().byId);
report("检查映射登记表", checkMapping, `${checkMapping.count} 条，全部可解析`);
const manifests = validateManifests();
report("Skill 清单", manifests, `${manifests.count} 个 Skill`);
const registry = validateRegistry();
report("注册表一致性", registry, `${registry.count} 个条目，flow↔manifest 一一对应`);
const kb = playbookIndexIssues();
report("方向章节索引", kb, `${kb.count} 个方向，library ↔ playbooks/ 一一对应`);

process.exit(ok ? 0 : 1);
