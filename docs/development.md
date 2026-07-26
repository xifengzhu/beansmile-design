# 开发指南

本指南面向维护和扩展项目的开发者，覆盖仓库结构、核心契约、扩展入口和测试验收。日常使用（工作流、常用命令、交付包结构）见[使用指南](usage.md)。

## 项目结构

```text
beansmile-design/
|-- skills/                      # Director、流程 Skills、评审 Skills 及其参考资料
|-- scripts/                     # 上下文、门禁、浏览器、快照、评审与验收运行时
|   |-- lib/                     # schema、规则、浏览器、哈希和 findings 等共享模块
|   `-- test/                    # Node 内置测试套件
|-- evidence/rules/              # WCAG、平台、设计工艺和行业规则卡
|-- fixtures/blockers/           # blocker 召回与误报测试样本
|-- templates/native-checklists/ # iOS、Android、小程序人工核对清单
`-- docs/superpowers/specs/      # 系统设计、schema 与内容规范
```

运行时角色的唯一注册入口是 [`skills/registry.yaml`](../skills/registry.yaml)：

- 流程 Skills：`requirements_research`、`ux_architecture`、`visual_system`、`html_prototype`、`decision_record`
- 评审 Skills：`standards_audit`、`visual_review`
- 调度角色：`design_director`

## 核心契约

### 单一事实源

每个设计任务只有一个可写状态文件 `context.yaml`。Skill 读取上下文和声明的输入文件，产出业务文件及建议补丁；只有 Design Director 可以通过受控脚本把补丁合并回上下文。

### 字段与阶段门禁

[`skill-manifests.yaml`](superpowers/specs/schemas/skill-manifests.yaml) 声明 5 个流程 Skill 的读写白名单和必需产物。补丁合并前会同时检查：

1. 修改路径是否位于该 Skill 的 `writes` 白名单。
2. 合并后的上下文是否符合 [`context.schema.json`](superpowers/specs/schemas/context.schema.json)。
3. 阶段转换是否合法，专业模式确认门是否已记录。
4. `artifact_version` 是否保持单调递增。

### 独立评审与版本绑定

规范审计和视觉评审只能读取冻结快照，互相不可见，也不能直接修改原型或上下文。Director 使用 `record-findings.mjs` 校验 [`findings.schema.json`](superpowers/specs/schemas/findings.schema.json)、截图哈希、规则覆盖和版本后再落盘。

只有 `blocker` 直接阻止交付；每个 `warning` 仍必须在 `decisions.md` 中以 `[finding:<id>]` 记录处理方式或接受风险。

## 开发与扩展

### 修改或新增 Skill

1. 在 `skills/<name>/SKILL.md` 定义职责、输入、输出和执行约束。
2. 在 `skills/registry.yaml` 登记 canonical ID、目录和运行时类型。
3. 流程 Skill 还需要更新 `docs/superpowers/specs/schemas/skill-manifests.yaml` 的读写白名单与产物。
4. 若增加上下文字段，同步更新 `context.schema.json`、门禁逻辑和对应测试。
5. 运行 `npm run check` 与 `npm test`，确认注册表、manifest 和实现一致。

### 修改或新增规则

规则卡位于 [`evidence/rules/`](../evidence/rules/)，并由 [`rule-card.schema.json`](superpowers/specs/schemas/rule-card.schema.json) 约束。新增规则时必须提供稳定 ID、目标平台、规则强度、证据等级、来源 URL 和最后核实日期，并保证 `conflicts_with` 可解析。

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
```

这些命令分别验证系统内部一致性、运行时行为、规则库质量、已知 blocker 的召回与误报，以及当前机器能否真正执行浏览器自动化。召回测试只证明 fixture 覆盖范围内的能力，不能替代真实原型的浏览器检查和双评审。

针对具体交付包，最终运行：

```bash
npm run accept -- --package <交付包目录>
```

最终验收会检查交付结构、上下文、规则可追溯性、来源真实性、行业规则参与、候选竞争、截图迭代、浏览器结果、快照完整性、双评审、warning 处理和当前版本绑定。

## 延伸文档

- [设计 Agent 系统设计规范](superpowers/specs/2026-07-24-design-agent-system-design.md)
- [统一上下文 schema](superpowers/specs/schemas/context.schema.json)
- [Skill manifest schema](superpowers/specs/schemas/skill-manifest.schema.json)
- [Findings schema](superpowers/specs/schemas/findings.schema.json)
