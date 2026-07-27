# 开发指南

本指南面向维护和扩展项目的开发者，覆盖仓库结构、核心契约、扩展入口和测试验收。日常使用（工作流、常用命令、交付包结构）见[使用指南](usage.md)。

## 项目结构

```text
beansmile-design/
|-- skills/                      # Director、流程 Skills、评审 Skills 及其参考资料
|-- scripts/                     # 上下文、门禁、浏览器、快照、评审与验收运行时
|   |-- lib/                     # schema、规则、浏览器、哈希和 findings 等共享模块
|   `-- test/                    # Node 内置测试套件
|-- schemas/                     # 上下文、Skill manifest、findings 与规则卡 schema
|-- evidence/rules/              # WCAG、平台、设计工艺和行业规则卡
|-- fixtures/blockers/           # blocker 召回与误报测试样本
|-- templates/native-checklists/ # iOS、Android、小程序人工核对清单
`-- docs/                        # 使用指南与开发指南
```

运行时角色的唯一注册入口是 [`skills/registry.yaml`](../skills/registry.yaml)：

- 流程 Skills：`requirements_research`、`ux_architecture`、`visual_system`、`html_prototype`、`decision_record`
- 交付 Skills：`design_specification`、`design_presentation`
- 评审 Skills：`standards_audit`、`visual_review`
- 调度角色：`design_director`

## 核心契约

### 单一事实源

每个设计任务只有一个可写状态文件 `context.yaml`。Skill 读取上下文和声明的输入文件，产出业务文件及建议补丁；只有 Design Director 可以通过受控脚本把补丁合并回上下文。

`Design.md` 也实行单一所有者：只有 `design_specification` 可写。`prepare` 在 ux 内生成 proposed contract，用户确认后由 Director seal 为 `approved_contract`；`finalize` 在完整评审后只追加 implementation-ready 部分，不得改动第一部分规范化 digest。Visual、Prototype 和 presentation 只消费并绑定它，不能各自维护第二份设计规格。

### 字段与阶段门禁

[`skill-manifests.yaml`](../schemas/skill-manifests.yaml) 声明 5 个流程 Skill 与 2 个 deliverable Skill 的读写白名单和必需产物。`design_specification` 使用 operation-specific manifest：`prepare` 与 `finalize` 有不同 reads 投影，但 writes 都只能是 `artifacts.design_document`。补丁合并前会同时检查：

1. 修改路径是否位于该 Skill 的 `writes` 白名单。
2. 合并后的上下文是否符合 [`context.schema.json`](../schemas/context.schema.json)。
3. 阶段转换是否合法，专业模式确认门是否已记录。
4. `artifact_version` 是否保持单调递增。

### Design contract 与原子来源

新包使用 `project.package_format_version: 3`。`audit/design/contract-source.json` 与 `audit/delivery/source-manifest.json` 通过规范化对象和逐文件 SHA-256 冻结两次生成输入，并用临时目录加原子 rename 发布。`contract_revision` 只在受控契约修订时递增；`artifact_version` 还覆盖同一契约下 Design.md 的合法 finalize/措辞重写。

用户确认会生成 `audit/design/contract-lock.json`。lock 证明确认绑定、flows 哈希和 `downstream_absent`，Visual 与 Prototype patch 必须同时带当前 `design_contract_digest` 和 `contract_lock_sha256`。snapshot format 3 会把 approved Design.md、来源与 lock 冻结进当前 prototype version 目录，最终验收重新计算 active/snapshot digest，防止评审后漂移。

受控回退只由 `design:revise --from design_contract` 执行。它保留旧文件，写入 `audit/revisions/contract-<旧>-to-<新>.json`，把旧 Design.md、tokens、prototype 和 presentation 登记为 stale，并清除受影响确认。历史已 delivered 且 package format 小于 3 的包不追溯失败；主动迁移必须从 ux 重跑新契约链，不能用后补文档沿用旧 verdict。

### 独立评审与版本绑定

规范审计和视觉评审只能读取冻结快照，互相不可见，也不能直接修改原型或上下文。Director 使用 `record-findings.mjs` 校验 [`findings.schema.json`](../schemas/findings.schema.json)、截图哈希、规则覆盖和版本后再落盘。

只有 `blocker` 直接阻止交付；每个 `warning` 仍必须在 `decisions.md` 中以 `[finding:<id>]` 记录处理方式或接受风险。

### Presentation 结构与渲染证据

`design_presentation` 只读取 implementation-ready Design.md 与 reviewed source。`scripts/lib/presentation.mjs` 直接解析 PPTX OOXML，核对八个叙事角色、稳定 slide/object/relationship ID、原生可编辑对象、Sources notes、边界、重叠声明和来源哈希。结构检查不能由生成器自报计数替代。

完整检查通过 LibreOffice 转 PDF，再用 Poppler 渲染每一页 PNG；`qa.json` 绑定 PPTX 与 render SHA。Director 必须实际逐页查看并写 `audit/presentation/director-review.json`，完整检查再验证其覆盖全部页。工具不可用返回 `unverified`/退出码 `3`，永远不能当作 pass。

## 开发与扩展

### 修改或新增 Skill

1. 在 `skills/<name>/SKILL.md` 定义职责、输入、输出和执行约束。
2. 在 `skills/registry.yaml` 登记 canonical ID、目录和运行时类型。
3. flow/deliverable Skill 还需要更新 `schemas/skill-manifests.yaml` 的读写白名单与产物；多操作 Skill 同步更新 operation schema、投影、diff/apply 和测试。
4. 若增加上下文字段，同步更新 `context.schema.json`、门禁逻辑和对应测试。
5. 运行 `npm run check` 与 `npm test`，确认注册表、manifest 和实现一致。

### 修改或新增规则

规则卡位于 [`evidence/rules/`](../evidence/rules/)，并由 [`rule-card.schema.json`](../schemas/rule-card.schema.json) 约束。新增规则时必须提供稳定 ID、目标平台、规则强度、证据等级、来源 URL 和最后核实日期，并保证 `conflicts_with` 可解析。

```bash
npm run validate:rules
npm run check
```

### 修改运行时门禁

共享逻辑集中在 `scripts/lib/`。修改上下文、快照、浏览器检查、规则或 findings 语义时，应在 `scripts/test/` 添加相应的正向和对抗性测试，避免只对现有 fixture 形状有效。

## 测试与验收

提交前至少运行：

```bash
npm run check
npm test
npm run validate:rules
npm run recall -- --out /tmp/beansmile-design-recall.json
npm run env:check
npm run presentation:probe
```

这些命令分别验证系统内部一致性、运行时行为、规则库质量、已知 blocker 的召回与误报，以及当前机器能否真正执行浏览器自动化和 PPTX 创建/重读/渲染。召回测试只证明 fixture 覆盖范围内的能力，不能替代真实原型的浏览器检查、双评审和 Director 逐页检查。

针对具体交付包，最终运行：

```bash
npm run accept -- --package <交付包目录>
```

最终验收会保留既有质量门，并追加 `设计前契约`、`开发交接文档`、`设计方案演示` 三维；检查 package/snapshot 格式迁移、来源与锁、当前契约评审链、最终 Design.md、PPTX 结构、render QA 和独立 Director review。`director-advance --stage delivered` 会同步运行该验收，任何非零状态都不写 context。

## 延伸文档

- [统一上下文 schema](../schemas/context.schema.json)
- [Skill manifest schema](../schemas/skill-manifest.schema.json)
- [Findings schema](../schemas/findings.schema.json)
