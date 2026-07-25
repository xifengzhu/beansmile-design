# beansmile-design

`beansmile-design` 是一套运行在 Codex 或 Claude 中的设计 Agent 运行时。它从业务目标、用户任务和目标平台出发，把产品需求转化为可点击、响应式、高保真的 HTML 原型，以及包含决策依据、截图、评审结果和验收报告的可审计交付包。

它不是生产前端框架，也不直接生成生产级 Web、原生 App 或小程序代码。项目重点解决的是设计过程的一致性、可追溯性和质量验收。

## 核心能力

| 组成 | 作用 |
|---|---|
| Design Director | 维护任务状态、调度各阶段、记录用户确认并作出最终设计裁决 |
| 5 个流程 Skills | 完成需求研究、UX 架构、视觉系统、HTML 原型和决策记录 |
| 2 个只读评审 | 分别执行规范审计和视觉评审，避免创作方自行判定通过 |
| 版本化依据库 | 管理 WCAG、平台规范、设计工艺和行业规则 |
| 可执行质量门 | 校验上下文、字段权限、阶段转换、浏览器行为、快照、评审和最终交付 |

支持的目标平台包括：

- Web
- 响应式移动 Web
- iOS App
- Android App
- 微信小程序

Web 和响应式移动 Web 具备完整的浏览器自动化检查链路。原生 App 与微信小程序以 HTML 近似原型表达，其中无法由 HTML 忠实验证的系统控件、原生手势、安全区和运行时行为需要人工清单或真机验证。

## 快速开始

### 1. 环境要求

- Node.js 18 或更高版本
- npm
- Chrome，或由 Playwright 安装的 Chromium

安装依赖：

```bash
npm install
```

如果本机没有可用的 Chrome/Chromium，可安装 Playwright 对应的浏览器：

```bash
npx playwright install chromium
```

### 2. 验证运行环境

```bash
npm run check
npm test
npm run env:check
```

`env:check` 会真实启动一次浏览器，而不只是检查依赖是否存在：

- 退出码 `0`：Node、Playwright、axe-core 和浏览器自动化均可用。
- 退出码 `3`：进入降级状态，浏览器相关结论只能标为“未验证”，任务不能标记为已完成。
- 其他非零退出码：命令失败，需要先修复环境或参数问题。

### 3. 在 Claude Code 或 Codex 中启用 Skills

Skill 定义遵循 [Agent Skills 开放标准](https://agentskills.io)（SKILL.md 格式），Claude Code 和 Codex CLI 都原生支持。运行一次：

```bash
npm run setup:agents
```

该命令把 `skills/` 下的 8 个 Skill 以相对符号链接挂进 `.claude/skills/` 和 `.codex/skills/`（两个目录已被 Git 忽略，每位使用者在自己的克隆里运行一次即可）。命令幂等，新增 Skill 后重跑一次即可更新。

之后**在仓库根目录**开启会话：

| 工具 | 调用方式 |
|---|---|
| Claude Code | `/design-director`，或直接描述设计任务（按 description 自动触发） |
| Codex CLI | `$design-director`，或用 `/skills` 选择器浏览 |

注意：所有 Skill 中的脚本命令都假定当前目录是本仓库根目录，会话必须从这里启动；交付包目录则可以通过 `--package` 指向任意位置。

### 4. 初始化交付包

下面的示例会在 `outputs/demo` 创建专业模式的 Web 交付包。`outputs/` 已被 Git 忽略，可以替换为其他目录。

```bash
npm run init -- \
  --package outputs/demo \
  --name "示例项目" \
  --mode professional \
  --task-type new_design \
  --platforms web,mobile_web \
  --primary-user "需要完成核心任务的目标用户" \
  --industry general
```

可选值：

- `--mode`：`professional` 或 `quick`
- `--task-type`：`new_design` 或 `redesign`
- `--platforms`：`web`、`mobile_web`、`ios`、`android`、`mini_program`，多个值用逗号分隔
- `--industry`：已有行业规则包为 `ecommerce`、`saas_b2b`；通用产品使用 `general`

初始化后验证上下文：

```bash
npm run validate:context -- outputs/demo/context.yaml
```

### 5. 启动设计任务

主会话入口是 `design-director` Skill：在 Claude Code 中输入 `/design-director`，在 Codex 中输入 `$design-director`，由它按阶段调度其余 Skill。未启用 Skill 机制时，也可以直接让 Agent 阅读 [`skills/design-director/SKILL.md`](skills/design-director/SKILL.md)。示例任务描述：

```text
请按 design-director 的专业模式执行设计任务。
交付包目录使用 outputs/demo，目标平台为 web 和 mobile_web。
从需求澄清开始，一次只问一个需要我决定的问题，并在每个确认门等待我的答复。
```

初始化只创建交付包骨架。此时运行最终验收会因缺少阶段产物、浏览器结果、快照和双评审而失败，这是预期行为。完整流程结束后再运行：

```bash
npm run accept -- --package outputs/demo
```

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

内部脚本使用 [`skills/registry.yaml`](skills/registry.yaml) 中的 canonical snake_case ID，例如 `requirements_research`、`ux_architecture` 和 `html_prototype`，不要传目录使用的连字符名称。

### 原型、评审与验收

| 命令 | 用途 |
|---|---|
| `npm run shot -- --package <目录> --candidates` | 对 2 至 3 个执行候选进行双视口截图 |
| `npm run shot -- --package <目录> --round <N>` | 对所有原型页面生成一轮 375/768/1440 视口截图 |
| `npm run browser:check -- --package <目录> --version <版本>` | 运行 axe、键盘、焦点、重排、缩放、溢出、CLS、控制台和核心场景检查 |
| `npm run snapshot -- --package <目录> --version <版本>` | 冻结不可覆盖的评审快照并写入内容哈希 manifest |
| `npm run review:record -- --package <目录> --version <版本> --in <findings.yaml>` | 校验并落盘只读评审返回的 findings |
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
    |-- findings/                # 标准与视觉评审结果
    `-- report.md                # 聚合评审和交付判定
```

最终验收要求交付包中的原型、浏览器结果、截图、快照和两份评审都绑定当前 `artifact_version`。评审后若修改 `prototype/` 或 `design-tokens.json`，必须升级版本并重新执行截图自评、浏览器检查、快照和双评审。

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

运行时角色的唯一注册入口是 [`skills/registry.yaml`](skills/registry.yaml)：

- 流程 Skills：`requirements_research`、`ux_architecture`、`visual_system`、`html_prototype`、`decision_record`
- 评审 Skills：`standards_audit`、`visual_review`
- 调度角色：`design_director`

## 核心契约

### 单一事实源

每个设计任务只有一个可写状态文件 `context.yaml`。Skill 读取上下文和声明的输入文件，产出业务文件及建议补丁；只有 Design Director 可以通过受控脚本把补丁合并回上下文。

### 字段与阶段门禁

[`skill-manifests.yaml`](docs/superpowers/specs/schemas/skill-manifests.yaml) 声明 5 个流程 Skill 的读写白名单和必需产物。补丁合并前会同时检查：

1. 修改路径是否位于该 Skill 的 `writes` 白名单。
2. 合并后的上下文是否符合 [`context.schema.json`](docs/superpowers/specs/schemas/context.schema.json)。
3. 阶段转换是否合法，专业模式确认门是否已记录。
4. `artifact_version` 是否保持单调递增。

### 独立评审与版本绑定

规范审计和视觉评审只能读取冻结快照，互相不可见，也不能直接修改原型或上下文。Director 使用 `record-findings.mjs` 校验 [`findings.schema.json`](docs/superpowers/specs/schemas/findings.schema.json)、截图哈希、规则覆盖和版本后再落盘。

只有 `blocker` 直接阻止交付；每个 `warning` 仍必须在 `decisions.md` 中以 `[finding:<id>]` 记录处理方式或接受风险。

## 开发与扩展

### 修改或新增 Skill

1. 在 `skills/<name>/SKILL.md` 定义职责、输入、输出和执行约束。
2. 在 `skills/registry.yaml` 登记 canonical ID、目录和运行时类型。
3. 流程 Skill 还需要更新 `docs/superpowers/specs/schemas/skill-manifests.yaml` 的读写白名单与产物。
4. 若增加上下文字段，同步更新 `context.schema.json`、门禁逻辑和对应测试。
5. 运行 `npm run check` 与 `npm test`，确认注册表、manifest 和实现一致。

### 修改或新增规则

规则卡位于 [`evidence/rules/`](evidence/rules/)，并由 [`rule-card.schema.json`](docs/superpowers/specs/schemas/rule-card.schema.json) 约束。新增规则时必须提供稳定 ID、目标平台、规则强度、证据等级、来源 URL 和最后核实日期，并保证 `conflicts_with` 可解析。

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

## 平台验证边界

| 平台 | 可自动验证 | 仍需人工或真机验证 |
|---|---|---|
| Web / 响应式移动 Web | 布局、响应式重排、键盘、焦点、语义、对比度、状态、资源错误、核心任务 | 依赖特定外部系统的真实联调 |
| iOS | 信息架构、视觉层级、内容、状态、部分无障碍属性 | 返回手势、动态字体、安全区、系统控件真实行为 |
| Android | 信息架构、视觉层级、内容、状态、部分无障碍属性 | 系统返回、系统栏、动态颜色、原生反馈 |
| 微信小程序 | 页面结构、视觉、状态和核心操作路径 | 胶囊按钮、tabBar、原生组件、授权弹窗、下拉刷新 |

原生平台人工清单位于 [`templates/native-checklists/`](templates/native-checklists/)。无法执行浏览器或真机验证时，必须明确标注“未验证”或“待人工验证”，不能把缺失的检查记为通过。

## 延伸文档

- [设计 Agent 系统设计规范](docs/superpowers/specs/2026-07-24-design-agent-system-design.md)
- [README 内容设计规范](docs/superpowers/specs/2026-07-25-readme-design.md)
- [统一上下文 schema](docs/superpowers/specs/schemas/context.schema.json)
- [Skill manifest schema](docs/superpowers/specs/schemas/skill-manifest.schema.json)
- [Findings schema](docs/superpowers/specs/schemas/findings.schema.json)
- [Design Director 使用说明](skills/design-director/SKILL.md)
