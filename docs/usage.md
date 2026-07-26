# 使用指南

本指南面向执行设计任务的使用者，覆盖完整工作流、常用命令、交付包结构和平台验证边界。环境准备、启用 Skills 和初始化第一个交付包见 [README「快速开始」](../README.md#快速开始)。

## 工作流

```text
需求与素材
    |
    v
intake -> research -> ux -> visual -> prototype -> review -> delivered
    |          |       |       |             |           |
    |          |       |       |             |           +-- 最终验收与交付
    |          |       |       |             +-- 浏览器检查、快照、双评审
    |          |       |       +-- 候选竞争、高保真原型、截图迭代
    |          |       +-- 视觉方向与设计令牌
    |          +-- 任务流、页面地图与状态矩阵
    +-- 目标、用户、平台、行业与约束
```

### 专业模式

| 阶段 | 主要产物或动作 | 用户确认 |
|---|---|---|
| `intake` | 初始化 `context.yaml`，澄清目标、用户、平台、行业与限制 | 无 |
| `research` | `brief.md` | 确认需求与成功标准 |
| `ux` | `flows.md` | 确认任务流和页面范围 |
| `visual` | 视觉方向、`design-tokens.json` | 从至少两个候选方向中选择或提出修订 |
| `prototype` | 候选竞争、`prototype/`、场景定义、至少两轮截图自评 | 已选方向作为约束 |
| `review` | 浏览器检查、不可变快照、规范审计、视觉评审、修订记录 | blocker 裁决需要用户确认 |
| `delivered` | `audit/report.md` 和最终机器验收 | 交付 |

三个确认门必须记录用户的原始答复，不能由 Agent 代拟：

```bash
node scripts/director-advance.mjs \
  --package outputs/demo \
  --confirm requirements \
  --summary "需求与成功标准摘要" \
  --reply "用户答复原文"
```

`flows` 确认门使用相同格式。视觉方向确认还需要候选与选中项：

```bash
node scripts/director-advance.mjs \
  --package outputs/demo \
  --confirm direction \
  --summary "视觉方向摘要" \
  --reply "用户答复原文" \
  --candidates D1,D2,D3 \
  --chosen D2
```

### 快速模式

快速模式适用于范围明确的简单页面。它缩短需求和视觉方向的确认过程，但不会跳过目标平台、关键状态、WCAG 2.2 AA、真实截图、控制台错误、内容溢出、决策依据或双评审等硬性质量要求。

## 常用命令

### 系统与依据库

| 命令 | 用途 |
|---|---|
| `npm run check` | 校验依据库、5 个流程 Skill 清单和 Skill 注册表的一致性 |
| `npm test` | 运行 Node 测试套件 |
| `npm run validate:rules` | 校验规则卡 schema、ID 唯一性和冲突引用 |
| `npm run validate:context -- <context.yaml>` | 校验任务上下文及当前阶段 |
| `npm run env:check` | 探测 Node、Playwright、axe-core，并真实启动浏览器 |
| `npm run setup:agents` | 把 Skills 链接进 `.claude/skills/` 与 `.codex/skills/`（幂等） |
| `npm run recall -- --out <报告路径>` | 对已知 blocker fixtures 运行召回与误报测试 |

### 状态与补丁门禁

| 命令 | 用途 |
|---|---|
| `npm run init -- --package <目录> ...` | 初始化交付包与 `context.yaml` |
| `node scripts/director-advance.mjs --package <目录> --stage <阶段>` | 由 Director 推进合法阶段 |
| `npm run gate:diff -- --skill <canonical_id> --before <context.yaml> --patch <patch.yaml>` | 只检查 Skill 补丁的字段权限、schema、阶段和版本 |
| `npm run apply -- --package <目录> --skill <canonical_id> --patch <patch.yaml>` | 门禁通过后合并补丁并写回上下文 |
| `npm run ctx:project -- --package <目录> --skill <canonical_id> [--out <文件>]` | 按 Skill reads 白名单生成 context 字段投影视图（派发用，规范 27.6） |
| `npm run mode:suggest -- --platforms web --pages 1 --flows 2 --brand-exploration false` | 快速模式建议（须经用户确认后 `--confirm mode` 落盘，规范 27.8） |

内部脚本使用 [`skills/registry.yaml`](../skills/registry.yaml) 中的 canonical snake_case ID，例如 `requirements_research`、`ux_architecture` 和 `html_prototype`，不要传目录使用的连字符名称。

### 原型、评审与验收

| 命令 | 用途 |
|---|---|
| `npm run shot -- --package <目录> --candidates` | 对 2 至 3 个执行候选进行双视口截图 |
| `npm run shot -- --package <目录> --round <N>` | 对所有原型页面生成一轮 375/768/1440 视口截图（首轮与收官轮必须全量） |
| `npm run shot -- --package <目录> --round <N> --incremental` | 第 2 轮起只重截变更页，未变页记 carried 并链到实拍轮（规范 27.3） |
| `npm run lint:proto -- --package <目录>` | 静态检查多页原型共享样式抽取（规范 27.2，降级环境同样强制） |
| `npm run browser:check -- --package <目录> --version <版本>` | 运行 axe、键盘、焦点、重排、缩放、溢出、CLS、控制台和核心场景检查 |
| `npm run snapshot -- --package <目录> --version <版本>` | 冻结不可覆盖的评审快照并写入内容哈希 manifest（含紧凑评审包 review-bundle） |
| `npm run snapshot -- --package <目录> --version <版本> --delta-from <基线版本>` | 冻结中间版本快照并生成 delta 增量评审包（规范 27.5） |
| `npm run review:record -- --package <目录> --version <版本> --in <findings.yaml>` | 校验并落盘只读评审返回的 findings |
| `npm run review:record -- --package <目录> --version <版本> --in <findings.yaml> --delta` | 落盘中间版本增量评审（闭合性校验：遗留问题须核销或再断言） |
| `npm run review:aggregate -- --package <目录> --version <版本>` | 聚合规范与视觉评审，生成 `audit/report.md` |
| `npm run accept -- --package <目录>` | 执行最终机器验收 |
| `npm run accept -- --package <目录> --check-urls` | 最终验收并在线核实已引用规则来源 |

浏览器相关脚本使用统一退出码语义：`0` 表示检查通过，`1` 表示发现失败项，`2` 表示参数错误，`3` 表示浏览器能力不可用、结果待人工验证。

## 交付包结构

```text
outputs/demo/
|-- context.yaml                 # 唯一机器可读任务状态
|-- README.md                    # 本次交付的范围与验证边界
|-- brief.md                     # 业务目标、用户、约束和成功标准
|-- flows.md                     # 任务流、页面地图和状态矩阵
|-- design-tokens.json           # 原始层与语义层设计令牌
|-- decisions.md                 # 规则引用、关键决策、覆盖和例外
|-- prototype/
|   |-- index.html               # 可点击原型入口
|   |-- scenarios.json           # 成功与错误路径的可执行场景
|   `-- assets/
`-- audit/
    |-- environment.md           # 环境能力和降级状态
    |-- candidates/              # 专业模式的执行候选与选择记录
    |-- iterations/              # 原型截图自评迭代
    |-- screenshots/             # 最终多视口截图
    |-- results.json             # 浏览器自动检查结果
    |-- snapshots/<version>/     # 绑定版本的不可变评审快照
    |   |-- rules/review-bundle.yaml  # 紧凑评审规则包（冻结卡确定性投影，规范 27.4）
    |   `-- delta/               # 中间版本增量评审包（变更清单/diff/遗留 findings，规范 27.5）
    |-- findings/                # 标准与视觉评审结果（中间版本为 <reviewer>-<v>-delta.yaml）
    `-- report.md                # 聚合评审和交付判定
```

最终验收要求交付包中的原型、浏览器结果、截图、快照和两份评审都绑定当前 `artifact_version`。评审后若修改 `prototype/` 或 `design-tokens.json`，必须升级版本并重新执行截图自评、浏览器检查、快照和评审——首版与拟交付版为全量双评审，中间版本可用 delta 增量评审（规范 27.5，验收「迭代评审链」维度核对链完整性）。

## 平台验证边界

| 平台 | 可自动验证 | 仍需人工或真机验证 |
|---|---|---|
| Web / 响应式移动 Web | 布局、响应式重排、键盘、焦点、语义、对比度、状态、资源错误、核心任务 | 依赖特定外部系统的真实联调 |
| iOS | 信息架构、视觉层级、内容、状态、部分无障碍属性 | 返回手势、动态字体、安全区、系统控件真实行为 |
| Android | 信息架构、视觉层级、内容、状态、部分无障碍属性 | 系统返回、系统栏、动态颜色、原生反馈 |
| 微信小程序 | 页面结构、视觉、状态和核心操作路径 | 胶囊按钮、tabBar、原生组件、授权弹窗、下拉刷新 |

原生平台人工清单位于 [`templates/native-checklists/`](../templates/native-checklists/)。无法执行浏览器或真机验证时，必须明确标注“未验证”或“待人工验证”，不能把缺失的检查记为通过。
