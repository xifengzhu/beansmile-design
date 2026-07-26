# 设计 Agent 系统设计规范

日期：2026-07-24
状态：已完成对话确认，待书面复核

## 1. 产品定义

本系统是一套在 Codex 或 Claude 中运行的设计 Agent 与 Skills。它把产品需求转化为有依据、符合平台习惯、视觉完成度高的可点击 HTML 原型。

第一版面向以下产品界面：

- Web
- 微信小程序
- iOS App
- Android App
- 响应式移动 Web

PPT 与 PDF 不进入第一版核心流程。后续将它们实现为独立输出 Skill，复用本系统的品牌令牌、字体和色彩规则、证据库及审计机制。

## 2. 目标与非目标

### 2.1 目标

- 从业务目标、目标用户和目标平台出发，而不是从视觉风格出发。
- 默认产出可点击、高保真、响应式 HTML 原型。
- 关键设计决策附简短依据、来源和适用范围。
- 品牌语言跨端一致，导航、控件、手势和反馈遵循各平台习惯。
- 默认满足 WCAG 2.2 AA，并叠加目标平台的官方规范。
- 同时评估可用性、平台适配、无障碍与视觉质量。
- 通过可复查的文件、截图、测试结果和决策记录形成完整交付包。

### 2.2 非目标

- 第一版不直接创建 Figma 文件。
- 第一版不生成生产级小程序、Web 或原生 App 代码。
- 第一版不承担 PPT/PDF 的叙事与分页设计。
- 不把灵感网站、流行趋势或色彩联想当作用户研究证据。
- 不承诺存在适用于所有平台、用户和语言的固定字号或颜色答案。

## 3. 核心原则

1. 用户任务优先：每个页面和组件都服务于明确用户任务。
2. 平台行为原生：品牌视觉可以统一，交互行为不能无视平台习惯。
3. 证据分级：区分硬性标准、官方建议、研究结论、行业惯例与灵感。
4. 创作与评审分离：负责创作的主 Agent 不独自给自己的结果判定通过。
5. 真实内容验证：使用接近真实长度和结构的内容，不用占位文掩盖问题。
6. 全状态设计：默认覆盖正常、空、加载、错误、成功、禁用和焦点等状态。
7. 可访问性是底线：快速模式也不能跳过硬性无障碍与可操作性检查。
8. 用户保留最终决定权：非法律与非安全冲突可以明确覆盖，但必须记录风险和例外。

## 4. 总体架构

系统采用混合式架构：一个 Design Director、五个流程 Skills、两个独立评审 Agent，以及一个版本化依据库。

```text
需求与素材
    |
    v
Design Director
    |-- 需求研究 Skill
    |-- UX 架构 Skill
    |-- 视觉系统 Skill
    |-- HTML 原型 Skill
    |-- 依据记录 Skill <--> 版本化依据库
    |
    |-- 规范审计 Agent  ----只读评审----|
    |-- 视觉评审 Agent  ----只读评审----|
    |                                   |
    +---------判断、修订、记录取舍<------+
    |
    v
设计交付包
```

Design Director 是唯一设计决策中心。两个评审 Agent 只返回结构化问题，不直接修改原型、令牌或决策记录。

本章描述的是逻辑架构（谁负责什么）。第 5 章描述执行架构（这些逻辑组件在 Codex/Claude 上如何落地），第 6 章描述整个系统依赖的运行环境前提与能力边界。

## 5. 实现架构

第 4 章的逻辑组件不直接对应任何运行时实体。本章定义它们在 Codex 与 Claude 上的落地方式，以及跨端保持一致所需的抽象。目标是：同一套 Skill / Agent 逻辑，通过一层适配器在两端等价运行。

### 5.1 逻辑组件到执行原语的映射

| 逻辑组件 | 在 Claude 中 | 在 Codex 中 | 跨端共同约定 |
|---|---|---|---|
| Design Director | 主会话（主循环 Agent） | 主会话 | 唯一有权写 `context.yaml` 与最终交付物的角色 |
| 5 个流程 Skill | 通过 Skill 工具加载的技能 | prompt 模块 / 可复用指令模板 | 输入输出一律经文件系统与 `context.yaml`，不靠会话内隐式记忆 |
| 2 个评审 Agent | sub-agent（Agent 工具，只读工具集） | 独立的只读会话 | 只挂载只读快照，返回结构化 `findings`，无写权限 |
| 依据库 | 仓库内版本化文件 | 仓库内版本化文件 | 由 Git 管理版本，见第 10 章 |
| 统一设计上下文 | `context.yaml` 单一事实源 | `context.yaml` 单一事实源 | 见第 8 章字段定义 |

关键约束：**Skill 与评审 Agent 都不直接调用某一端的私有 API**，只依赖 5.4 定义的抽象能力接口。这样双端差异被隔离在适配器层，逻辑层保持一致。

### 5.2 状态传递与单一事实源

- 全流程只有一个可写状态文件 `context.yaml`，仅 Design Director 可写。
- 每个 Skill 在被调度时收到：`context.yaml` 的只读副本 + 本 Skill 声明的输入产物路径。
- Skill 产出写入自己负责的产物文件（如 `brief.md`、`flows.md`），并返回一份"建议合并到 context 的字段补丁"。
- Director 校验补丁是否只触及该 Skill 声明的可写字段（字段级 diff 检查），通过后才合并；不通过则视为该阶段失败，进入第 15 章失败处理。

这为第 8 章"任何阶段只能修改自己负责的字段"提供了强制机制：不是靠约定，而是靠 Director 的 diff 门禁。

每个 Skill 必须在其定义中声明读写白名单，例如：

```yaml
skill: ux_architecture
reads: [project, users, goals, constraints, decisions]
writes: [artifacts.flows, stage]
produces: [flows.md]
```

白名单的 schema 见 `schemas/skill-manifest.schema.json`，五个流程 Skill 的完整清单见 `schemas/skill-manifests.yaml`。

### 5.3 评审的只读快照机制

为保证第 3 章原则 4（创作与评审分离），评审必须对一个冻结、只读的快照进行，而非对 Director 正在编辑的活动状态：

1. Director 在触发评审前，把当前交付物冻结到 `audit/snapshots/<artifact_version>/`，`artifact_version` 单调递增。
2. 评审 Agent 仅被授予该快照目录与依据库的**只读**权限，无法访问可写的 `context.yaml`，也无法写任何原型/令牌/决策文件。
3. 评审 Agent 把结果写到独立目录 `audit/findings/<reviewer>-<artifact_version>.yaml`，结构见 7.8。
4. Director 读取 findings 后自行判断与修订。评审 Agent 之间互不可见对方的 findings，避免相互锚定。

### 5.4 平台无关的能力抽象层

Skill 与 Agent 只依赖以下四类抽象能力；每一端提供一个 adapter 实现它们：

| 抽象能力 | 说明 | 典型实现（Claude / Codex） |
|---|---|---|
| 会话调度 | 派发 Skill、串接阶段、管理确认门 | 主循环 + Skill 工具 / 主循环 + 指令模块 |
| 文件读写 | 读写产物、快照、findings、context | 内置文件工具 / 沙箱文件系统 |
| 只读子代理 | 派发无写权限的评审会话 | Agent 工具（限制工具集） / 独立只读会话 |
| 浏览器自动化 | 运行 axe、Playwright、截图、缩放/重排检查 | 沙箱内 headless Chromium（见第 6 章） |

若某端缺失某项能力（最常见是浏览器自动化），按第 6 章降级策略处理，并把受影响结论标注为"未验证"，绝不静默当作通过。

### 5.5 裁决的可审计性

Director 既是创作者又在第 15 章承担评审冲突裁决，这会削弱创作/评审分离。为此附加约束：

- 任何裁决（含两评审冲突、规则覆盖）必须写入 `decisions.md`，记录：冲突项、依据的规则与证据等级、决定理由、决定人。
- 涉及 `blocker` 级别的裁决不得由 Director 单方拍板，必须走一次用户确认门。
- 裁决记录进入交付包，可被事后复查，形成对 Director 自裁的外部约束。

## 6. 环境前提与约束

本系统的质量承诺高度依赖运行环境的能力，且用 HTML 表达原生/小程序界面存在固有保真度边界。本章把这些依赖显式列为前提，避免"看似测过、实则空转"。

### 6.1 硬性运行环境前提

完整执行第 14 章质量门禁，运行环境必须具备：

- 可用的 headless 浏览器（Chromium 系），支持真实渲染、截图、视口与缩放控制。
- Node 运行时，以及 `axe-core`、`playwright`（或等效）可安装可执行。
- 允许在沙箱内启动本地静态服务或直接以 `file://` 打开原型。

这些是**前提条件**，不是可选项。系统启动时应自检这些能力是否具备，并把结果写入 `audit/environment.md`。

### 6.2 浏览器自动化不可用时的降级

当环境不具备 6.1 的浏览器能力时：

- 明确标注哪些质量门无法执行（axe 自动检查、Playwright 交互、真实截图、200% 缩放/窄视口重排、溢出与遮挡检查）。
- 这些项的结论只能记为"未验证"，写入 `audit/report.md`，并列出用户需自行验证的步骤。
- **不得**把"未验证"当作"通过"，也不得据此宣布满足 WCAG 或完成定义（第 17 章）。
- 若核心阻断检查（第 14.2 节）因此无法执行，任务不能标记为已完成，只能标记为"待人工验证"。

### 6.3 HTML 原型的平台保真度边界

输出是 HTML，而目标平台包含原生 App 与小程序。规范审计 Agent 必须在"HTML 能验证的项"上给出平台合规判定，在"HTML 无法忠实表达的项"上只给出"设计意图一致性"判定，并转入人工核对清单。

| 平台 | HTML 原型可自动验证 | HTML 无法忠实验证（需人工清单或超出第一版范围） |
|---|---|---|
| Web / 响应式移动 Web | 布局、响应式重排、键盘与焦点、语义结构、对比度、状态、溢出与遮挡 | 无重大缺口——Web 本身即目标载体 |
| iOS App | 信息架构、视觉层级、内容与状态、色彩对比 | 返回滑动等原生手势、系统级动态字体、安全区真实行为、系统控件真实交互 |
| Android App | 信息架构、视觉层级、内容与状态、色彩对比 | 系统返回、边到边与系统栏、动态颜色（Material You）、涟漪等原生控件反馈 |
| 微信小程序 | 页面结构、视觉、状态、核心操作路径 | 胶囊按钮/tabBar 真实行为、原生组件能力（picker、scroll-view 等）、授权弹窗、原生下拉刷新 |

对无法在 HTML 验证的项：

- 审计 Agent 输出"设计意图一致"或"存在偏差"，不输出"平台合规通过"。
- 系统生成 `audit/native-checklist.md`，逐项列出需在真机或模拟器确认的内容。
- 这些项的最终合规不计入本次自动化结论，与第 14.1 节的符合性边界一致。

### 6.4 第一版范围与保真度声明

- 完整的自动化质量门只对 Web / 响应式移动 Web **完全成立**。
- iOS、Android、微信小程序在第一版按"HTML 近似原型 + 平台适配人工清单"交付。
- 每个交付包必须在 `README.md` 中声明其保真度边界：哪些结论是自动验证的、哪些是人工待验证的、哪些超出本次范围。

## 7. 组件职责与接口

### 7.1 Design Director

职责：

- 识别任务类型、目标平台与工作模式。
- 一次只提出一个需要用户决定的问题。
- 建立并维护唯一的设计上下文。
- 调度各 Skills，管理专业模式的确认门。
- 向评审 Agent 提供只读快照并处理其反馈。
- 对冲突规则进行裁决，记录假设、覆盖与例外。
- 汇总最终设计包并执行完成定义。

输入：用户需求、品牌素材、参考案例、现有产品资料、目标平台和限制。
输出：设计上下文、阶段性方案、最终设计包和完成状态。

### 7.2 需求研究 Skill

职责：

- 提取业务目标、目标用户、核心任务和成功指标。
- 区分新产品设计与现有产品改版。
- 识别平台惯例、领域风险和必要竞品参考。
- 对来源标记“已核实”“推断”或“用户提供”。

输出：`brief.md` 的研究与约束部分。

### 7.3 UX 架构 Skill

职责：

- 生成关键任务流、页面地图和信息架构。
- 定义导航、页面责任、入口、出口和异常路径。
- 列出每个核心界面的内容、动作和状态。
- 优先采用用户熟悉的平台模式；任何非常规交互必须说明收益。

输出：`flows.md` 与页面清单。

### 7.4 视觉系统 Skill

职责：

- 基于品牌、内容与使用情境提出二至三个真正不同的视觉方向。
- 定义颜色、字体、间距、圆角、图标、层级、密度、动效和响应式令牌。
- 使用真实内容与关键页面展示方向差异。
- 保持品牌语言一致，同时允许不同平台采用原生控件和行为。

输出：视觉方向预览、选定方向说明与 `design-tokens.json`。

### 7.5 HTML 原型 Skill

职责：

- 根据已确认的用户流和视觉系统生成可点击高保真 HTML。
- 覆盖核心流程、交互反馈和关键状态。
- 支持目标视口和必要的响应式重排。
- 使用语义 HTML、可见焦点、键盘操作和可访问名称。
- 使用稳定尺寸与约束，避免动态内容造成布局跳动、遮挡或溢出。

输出：`prototype/index.html` 与 `prototype/assets/`。

### 7.6 依据记录 Skill

职责：

- 将设计问题映射到适用规则，而不是堆砌无关引用。
- 解析规则强度、平台、版本、冲突和例外。
- 为关键决策写简短说明，并保留完整来源信息。
- 发现本地规则可能过期时，只查询对应官方来源。

输出：`decisions.md`、引用清单和规则使用记录。

### 7.7 规范审计 Agent

只读检查以下内容：

- WCAG 2.2 AA
- 目标平台的官方交互模式
- 颜色对比、键盘、焦点、语义和可访问名称
- 字体缩放、文本间距覆盖、内容重排与触控目标
- 页面状态、响应式行为、内容溢出与遮挡
- 决策依据、来源版本与例外记录

对第 6.3 节列出的、HTML 无法忠实表达的平台原生项，只输出"设计意图一致性"判定并转入人工清单，不输出"平台合规通过"。

输出结构：严重级别、位置、失败规则、用户影响、证据和建议修复方式。

### 7.8 视觉评审 Agent

只读评估以下八个维度：

1. 视觉层级
2. 版式节奏
3. 字体系统
4. 色彩系统
5. 组件一致性
6. 内容适配
7. 品牌辨识度
8. 完成度

视觉评审按用户影响和视觉影响排序，不给一个掩盖问题的综合分数。它不能以个人偏好或当前趋势否定已确认的品牌方向。

两个评审 Agent 使用相同的只读返回结构：

```yaml
reviewer: standards | visual
artifact_version: string
verdict: pass | fail
findings:
  - id: string
    severity: blocker | warning | note
    location: string
    rule_id: string | null
    evidence: string
    user_impact: string
    recommendation: string
```

只有 `blocker` 会阻止交付。`warning` 可以在说明影响和后续处理建议后交付，`note` 只用于非必要改进。

## 8. 统一设计上下文

Design Director 维护一份机器可读的任务上下文，所有 Skills 和评审 Agent 只通过它交换状态。最低字段如下：

```yaml
project:
  name: string
  mode: professional | quick
  task_type: new_design | redesign
  platforms: [web | mini_program | ios | android | mobile_web]
users:
  primary: string
  needs: []
goals:
  business: []
  user_tasks: []
  success_criteria: []
brand:
  assets: []
  attributes: []
constraints: []
assumptions: []
decisions: []
exceptions: []
artifacts: {}
stage: intake | research | ux | visual | prototype | review | delivered
```

任何阶段只能修改自己负责的字段；Design Director 负责合并并检查前后矛盾。该约束由 5.2 节的字段级 diff 门禁强制执行，而不仅是约定。完整字段定义与校验规则见 `schemas/context.schema.json`。

## 9. 双模式工作流

### 9.1 专业模式

专业模式为默认模式：

1. 澄清：确认目标、用户、平台、限制与成功标准。
2. 研究：核实相关平台模式、领域特点和参考案例。
3. 确认门 A：用户确认需求与成功标准。
4. UX：生成用户流程、信息架构、页面和状态范围。
5. 确认门 B：用户确认流程和页面范围。
6. 视觉：展示二至三个视觉方向及各自依据。
7. 确认门 C：用户选择或修订视觉方向。
8. 原型：生成高保真响应式 HTML 与关键状态。
9. 自动检查：执行无障碍、交互、响应式、溢出和运行错误检查。
10. 双重评审：规范审计 Agent 与视觉评审 Agent 独立评审。
11. 修订：Design Director 处理问题并记录取舍。
12. 交付：阻断问题清零后生成标准设计包。

### 9.2 快速模式

快速模式适用于范围明确的简单页面：

1. 收集最小 Brief：用途、用户、平台和品牌。
2. 采用一个合理视觉方向直接生成原型。
3. 执行与专业模式相同的硬性质量检查。
4. 交付原型、关键依据、假设和审计结果。

快速模式可以跳过单独的研究报告、多个视觉方向和阶段确认，但不能跳过目标平台、关键状态、WCAG 2.2 AA、多视口截图、溢出检查、运行错误检查和依据记录。

## 10. 依据库

### 10.1 来源分层

规则按以下优先级裁决：

1. 法律、安全和硬性无障碍要求
2. 目标平台的官方规范
3. 当前项目的用户任务和研究证据
4. 品牌要求与跨端一致性
5. 成熟可用性原则与领域研究
6. 趋势、案例和色彩启发

该顺序不是只看发布者名称的机械排序。规则的 `strength` 与项目证据强度必须一起参与裁决：直接观察到的当前用户任务证据可以覆盖官方的建议性模式，但不能覆盖法律、安全、平台技术限制或硬性无障碍要求。任何覆盖都需要写入决策记录。

第一版范围说明：由于第一版不含真实用户测试适配器（见第 19 章），上述第 3 层"研究证据"的实际来源限于用户在 Brief 中提供并标注为"已核实"的任务证据。缺乏此类证据时，第 3 层不激活，不得以推断或灵感冒充研究证据触发覆盖。

初始官方来源包括：

- W3C Web Content Accessibility Guidelines 2.2
- WAI-ARIA Authoring Practices Guide
- Apple Human Interface Guidelines
- Google Material Design 3
- 微信小程序官方设计指南与组件文档

Nielsen Norman Group、ISO 9241-210 及适用的领域研究可作为可用性依据。Google Design、OpenDesign 和其他案例库属于灵感层，不作为用户行为结论的唯一证据。

### 10.2 规则卡结构

每条规则必须包含：

```yaml
id: string
title: string
rule: string
publisher: string
source_url: string
source_version: string
last_verified: YYYY-MM-DD
platforms: []
scope: []
strength: required | recommended | heuristic
evidence_grade: A | B | C | D
rationale: string
check_method: automated | manual | mixed
exceptions: []
conflicts_with: []
```

建议将官方规范和可重复验证的研究标为较高证据等级；行业惯例与色彩联想标为启发性等级。系统不得伪造来源、版本或核实日期。

`strength`（规则强制力）与 `evidence_grade`（证据质量）是两个独立维度，裁决时按下表合成：

| strength | 裁决约束 |
|---|---|
| required | 不论 evidence_grade 一律遵守，只有更高优先层（第 10.1 节 1–2 层）可豁免 |
| recommended | 默认遵守；当第 3 层已激活的项目证据（evidence_grade A/B）与之冲突时，可被覆盖并记录 |
| heuristic | 作为倾向性建议，可被任何等级更高的证据或明确品牌/项目要求覆盖 |

### 10.3 字体与尺寸规则

系统不能声称 W3C 统一要求正文必须使用某个固定字号。规则需要区分：

- 标准中的可测试要求，例如缩放、重排、对比度和文本间距覆盖后不丢失内容。
- 平台建议，例如 iOS 动态字体、Material 字体层级和各平台触控目标。
- 项目排版建议，例如正文起始字号、行高、行长和信息密度。

Web 正文可以把 16 CSS px 作为常用起点，但它是设计建议，不是 WCAG 的统一强制字号。最终值需要结合字体、语言、设备、内容密度和用户群验证。

### 10.4 色彩心理学边界

色彩首先服务于品牌、语义、状态区分和可读性。色彩联想受文化、行业、上下文和组合方式影响，只能作为低强度启发，不能使用“某颜色必然导致某种心理结果”之类绝对结论。

## 11. 平台适配策略

系统使用“共享品牌令牌 + 平台适配层”：

- 共享：品牌色、字体性格、图形语言、内容语气、核心间距节奏。
- Web：响应式、键盘、焦点、指针与触控并存、语义结构和浏览器重排。
- iOS：遵循 Apple 导航、手势、安全区域、动态字体和控件行为。
- Android：遵循 Material 导航、返回行为、系统栏、动态颜色与控件状态。
- 微信小程序：遵循小程序导航、胶囊区域、安全区、组件能力与常见操作路径。

跨平台复用的是设计意图，不是逐像素复制。原生平台的适配深度受第 6.3 节保真度边界约束：HTML 表达的是意图，真机行为需按人工清单核对。

## 12. 用户要求与规则冲突

当用户要求与规则冲突时：

1. 指出具体冲突、受影响用户和证据等级。
2. 提供至少一个满足原意的合规替代方案。
3. 法律或关键安全要求不能静默覆盖。
4. 其他冲突只有在用户明确坚持时才能覆盖。
5. 所有覆盖写入 `decisions.md`，包括风险、决定人和影响范围。

## 13. 标准交付包

```text
design-project/
├── README.md
├── brief.md
├── flows.md
├── design-tokens.json
├── decisions.md
├── prototype/
│   ├── index.html
│   └── <platform>/
│       └── <flow>.html
└── audit/
    ├── report.md
    ├── results.json
    ├── environment.md
    ├── native-checklist.md
    ├── snapshots/
    ├── findings/
    └── screenshots/
```

`prototype/index.html` 作为总入口，索引各平台与各流程的页面；单一平台单一流程时可退化为仅有 `index.html`。多平台或多流程时按 `prototype/<platform>/<flow>.html` 组织。

`prototype/index.html` 必须可以按 README 的说明本地打开或启动。核心流程不得依赖未说明的私有服务。

原型最低覆盖：

- 可真实点击完成的核心任务
- 接近真实长度和结构的内容
- 空、加载、错误、成功和禁用状态
- 表单校验、焦点、操作反馈和键盘路径
- 目标平台的导航和控件习惯
- 长标题、大字号、空数据等极端内容

## 14. 质量门禁与测试

### 14.1 自动检查

- HTML、CSS 和 JavaScript 基本有效性
- 浏览器控制台错误与资源加载失败
- axe-core 或等效工具的 WCAG 自动检查
- 文本、非文本控件与状态颜色对比度
- 键盘可达性和可见焦点
- 关键流程的 Playwright 交互测试
- 桌面、手机及必要时平板的真实截图
- 水平溢出、文本裁切、内容遮挡和布局跳动
- 200% 缩放与窄视口重排

上述检查以第 6.1 节的浏览器环境为前提；环境不具备时按第 6.2 节降级并标注"未验证"。

自动化工具不能证明完全符合 WCAG，因此语义、阅读顺序、替代文本质量和认知负担仍需人工审计。

任何 WCAG 符合性结论只适用于本次原型、已声明的视口和已测试流程，不自动代表后续生产产品符合 WCAG。

### 14.2 阻断问题

出现以下任一问题时不能交付：

- 核心任务无法完成
- 关键内容或操作不可访问
- 对比度、键盘或焦点存在明确硬性失败
- 页面空白、内容遮挡、裁切或不可恢复溢出
- 缺少关键错误、空或加载状态
- 浏览器控制台出现影响使用的错误
- 关键引用伪造或与实际规则不符

### 14.3 警告问题

轻微视觉不一致、低优先级建议、暂时无法在线核实但明确标注版本的旧规则，可以带说明交付。警告必须进入 `audit/report.md`，并说明影响和建议处理时间。

## 15. 失败处理

- 缺少会改变设计方向的信息：暂停当前阶段，一次只问一个问题。
- 缺少非关键信息：采用明确标记的临时假设，不伪装成用户结论。
- 规则冲突：按来源优先级裁决，并把取舍写入决策记录。
- 官方来源不可访问：使用最后核实版本，标记核实日期和可能过期风险。
- 原型检查失败：保留上一个可用版本，根据复现步骤修订后重新执行完整相关检查。
- 两个评审结论冲突：Design Director 根据用户任务、证据等级和平台要求裁决，不按多数票处理；裁决须按 5.5 节记录，涉及 blocker 时须走用户确认门。
- 运行环境缺失浏览器自动化：按第 6.2 节降级，受影响结论标注"未验证"，任务不得标记为已完成。
- 素材缺失：使用明确授权的生成或占位素材；不得把模糊、无关图片当作完成品。

## 16. 隐私与素材治理

- 未经用户同意，不把未公开需求、用户数据或品牌素材上传到第三方服务。
- 外部图片、字体和图标必须记录来源与许可；不明确时使用可替换占位资产并标注。
- 截图和审计报告不得泄露密钥、账号、个人信息或测试数据。
- 联网核实时优先访问官方来源，并仅发送完成核实所需的最小信息。

## 17. 完成定义

一次设计任务只有同时满足以下条件才算完成：

- 原型可按说明正常打开。
- 核心用户任务可以完成。
- 目标平台和关键状态已经覆盖。
- 所有阻断问题为零。
- 关键设计决策有简短依据和可追溯来源。
- 所有假设、覆盖和例外已记录。
- 已生成目标视口的真实截图并完成视觉检查。
- 运行环境具备浏览器自动化，硬性检查已实际执行而非降级为"未验证"；否则只能标记为"待人工验证"，不得标记为已完成。
- 用户确认交付方向与范围。

## 18. 第一版成功标准

### 18.1 基准任务

第一版系统应通过三类基准任务验收：

1. 一个响应式 Web 产品核心流程。
2. 一个微信小程序核心流程。
3. 一个 iOS 或 Android App 核心流程。

每类任务应验证专业模式；至少一个简单页面应验证快速模式。

### 18.2 可机器判定的验收阈值

视觉评审刻意不给综合分（见 7.8），因此验收不依赖主观打分，而依赖以下可自动检查的指标。每项都应能由脚本或 CI 判定通过/失败：

| 维度 | 指标 | 通过阈值 |
|---|---|---|
| 结构稳定 | 交付包目录符合第 13 章结构；`context.yaml` 通过 `schemas/context.schema.json` 校验；每个 Skill 声明的 `produces` 产物均存在 | 全部为真 |
| 规则可追溯 | `decisions.md` 中引用的每个 `rule_id` 都能在依据库解析，且规则卡含 `source_url` 与 `last_verified` | 未解析或缺字段数 = 0 |
| 无伪造来源 | 抽查引用的 `source_url` 可访问或标注为"离线·最后核实版本" | 伪造/悬空来源数 = 0 |
| 评审只读 | 快照 `manifest.json`（逐文件 sha256）完好；活动 `prototype/`、`design-tokens.json` 与快照逐字节一致；`decisions.md` 只允许追加（快照内容须为当前内容前缀）。**不使用 git diff**——交付包目录不入 git，git diff 对其永远为空（确定性假阳性，v1.2 修正） | 篡改/改动/改写数 = 0 |
| 迭代自评 | `audit/iterations/` ≥2 轮；每轮有截图 + 非空 `notes.md` 且引用当轮截图文件名 + `meta.json`；末轮 `page_hashes` 与交付原型一致（改完必须复评） | 全部为真 |
| 流程确认 | 专业模式下 `context.confirmations` 含 requirements/flows/direction 三门记录；direction 候选 ≥2 且 chosen 在候选中（状态机层同时在推进时强制） | 全部为真 |
| 执行竞争 | 专业模式下 `audit/candidates/` 含 ≥2 个候选（各有 HTML + 截图）；`selection.md` ≥100 字符、以 `cand-N/<截图名>` 限定路径引用每个候选的截图、`chosen` 指向存在的候选（v1.3，见第 22.2 节；浏览器不可用时记"未验证"） | 全部为真 |
| 规范覆盖矩阵 | standards findings 含 `rule_coverage`：目标平台（+已激活行业包）的全部适用规则逐条出现，各带 result/checked_via/证据（≥10 字符）；`result=fail` 有对应 blocker/warning finding；Web 规则不用 `intent_only`；与 findings 无自相矛盾（v1.4，见第 23.1 节） | 缺口/矛盾数 = 0 |
| 行业依据 | 专业模式 `project.industry` 必填（通用产品 `general`）；行业规则包存在时，decisions 引用 ≥1 条该包规则（v1.4，见第 23.3 节；industry 非 general 且无对应包时记"未验证"） | 全部为真 |
| 阻断召回 | 向原型注入 N 个已知 blocker（对比度、键盘不可达、缺状态、控制台错误、伪造引用各若干），运行自动检查 | 召回率 = 100% |
| 无障碍与渲染 | `results.json`（checks_version ≥3）与当前原型同源（`page_hashes` 一致）；axe 严重违规；键盘可达；可见焦点比率；控制台错误；320px 重排；640px（≈200% 缩放）重排；文本裁切；加载期 CLS；核心任务场景（`prototype/scenarios.json`，成功+错误双路径）Playwright 逐步执行（v1.4，见第 23.2 节） | 违规 = 0；可达/可见焦点 = 100%；控制台 0 错；重排/缩放 OK；裁切 = 0；CLS < 0.1；场景定义合法且 100% 通过 |
| 视觉质量门 | 视觉评审 `blocker` 数；八维 `dimension_reviews` 语义完整（八维各一、截图存在且 sha256 匹配、observed/evidence 含实测值、非 pass 判定有同维度 finding）；全部 warning 已在 `decisions.md` 以 `[finding:<id>]` 记录处理（修复或接受理由） | blocker = 0；语义问题 = 0；未处理 warning = 0 |
| 环境诚实 | 若浏览器自动化不可用，受影响结论（无障碍与渲染、迭代自评）全部标注"未验证"，任务未标记为已完成 | 无"未验证却判通过"的项 |

以上阈值同时验证：流程按预期执行、输出结构稳定、规则引用可追溯、两个评审 Agent 不直接修改设计、自动检查能捕获故意植入的阻断问题。schema 文件见 `schemas/`。

## 19. 后续扩展

第一版稳定后，可以按以下顺序扩展：

1. Figma 导出或 API 连接器。
2. 组件库与现有 Design System 导入。
3. 真实用户测试记录与研究资料适配器。
4. PPT 输出 Skill。
5. PDF 报告与长文档输出 Skill。

PPT/PDF 扩展需要独立定义叙事、分页、演示场景和打印检查，不能直接复用产品界面的页面结构。

## 20. 生成质量层（v1.1 增补）

第 1–18 章解决"不出错、可追溯、不自欺"（质量下限）；本章定义拉高质量上限的生成侧机制。三者均已随 v1.1 落地。

### 20.1 设计知识库

流程 Skill 携带可执行的设计知识载荷（`skills/<skill>/references/`），生成时**必读**，作为产出的构建方法而非临场发挥：

- `visual-system/references/`：字阶与间距体系（含中文排版特有规则与字体栈）、色彩系统构建方法（色阶展开、语义令牌、60-30-10 纪律、对比度预检表）、8 个风格方向库（人格/适用场景/令牌起点/关键手法）。
- `html-prototype/references/`：组件工艺范式（全局基线 CSS 与按钮/表单/卡片/导航/表格/状态/弹层的质量基准）、打磨清单、素材供给指南（图标/字体/图像与许可记录，衔接第 16 章）。
- 知识库中的工艺主张凡可追溯的，在依据库 `evidence/rules/design-craft.yaml` 有对应规则卡（strength=heuristic，第 10.1 第 5 层），保持"知识可执行、来源可追溯"双通道。

### 20.2 截图-自评-迭代循环

HTML 原型 Skill 在交付评审**之前**必须完成生成时迭代（区别于第 14 章的终局检查）：

1. 每轮用 `scripts/screenshot.mjs` 对全部页面在 375/768/1440 三视口截图至 `audit/iterations/round-N/`。
2. 对照打磨清单逐节自评（含"廉价感"类主观项），记录命中与修复到 `round-N/notes.md`。
3. 至少 2 轮；直到一轮零新增命中才可进入评审。迭代记录进入交付包，供 Director 与评审核查。
4. 浏览器不可用时按 6.2 降级：代码级自评 + 假设记录"视觉未经渲染验证"。

### 20.3 视觉评审标尺

视觉评审的八维度配备判定 rubric（`skills/visual-review/references/rubric.md`）：每维度有判定问题与 blocker/warning/note 判例；证据必须含可核实的具体值；有截图时先看截图、无截图时观感结论降级为 note；"无错但平庸"必须以 warning 显式写出。verdict 的松紧由 rubric 而非评审者临场情绪决定，保证同一快照评审可复现（对齐 18.2）。

## 21. 门禁硬化（v1.2 增补）

背景：2026-07-25 复审确认，v1.1 的多个"强制"仅存在于提示词散文，验收会给违反自身流程的产物发全绿（视觉门只读评审自填 verdict、评审只读 git diff 对 gitignore 的 outputs/ 恒为空、迭代与确认门无消费者、browser-check 采集信号不被消费）。v1.2 把这些提示词约束全部落成机器门：

1. **内容哈希门禁**（`scripts/lib/hash.mjs`）：`snapshot.mjs` 写 `manifest.json`（逐文件 sha256 + digest）；验收校验快照不可变、活动产物与快照一致、`decisions.md` 仅追加。替换失效的 git diff 门。
2. **审计产物同源**：`browser-check.mjs`（checks_version 2）与 `screenshot.mjs` 的每轮 `meta.json` 都携带原型 `page_hashes`；验收拒绝与当前原型指纹不符的陈旧/异次运行产物（同时消解"environment.md 与 results.json 自相矛盾"类问题）。
3. **迭代循环闭环**：20.2 的 ≥2 轮 + notes 要求由验收"迭代自评"维度机器判定；末轮指纹必须等于交付原型（改完必须复评）。
4. **确认门入状态机**：`context.confirmations`（schema 字段）+ `director-advance.mjs --confirm` 记录；专业模式下 research→ux / ux→visual / visual→prototype 缺对应记录时，状态机（含 hardenedGate）拒绝推进。
5. **八维结构化评审**：findings schema 对 visual 评审强制 `dimension_reviews`（八维各一：截图路径+sha256、区域、含实测值的 observed、判定）；`record-findings.mjs` 落盘前做语义校验（截图真实存在且哈希匹配、非 pass 判定须有同维度 finding、warning/blocker 证据须含数值）。rubric 的证据纪律从散文变成 schema+校验。
6. **warning 处置闭环**：验收要求两评审的每条 warning 在 `decisions.md` 以 `[finding:<id>]` 标记处理（修复或接受理由），拒绝沉默放行。
7. **浏览器检查补齐**：640px（≈1280@200% 缩放）重排、可见焦点比率（真实 Tab 遍历 + computed style 对比）、文本裁切（排除 ellipsis）、加载期 CLS；发现阻断信号时退出码 1（结果仍写盘）。
8. **测试套件**：`npm test`（`scripts/test/*.test.mjs`）覆盖哈希/manifest 校验、确认门状态机、八维语义校验的正反例。

刻意不做：不设"最少 N 条 findings"的数量门槛（诱导编造问题）；美学上限仍依赖评审质量，机器门只保证"评审确实看了图、给出了可核实证据、平庸被显式记录"。

## 22. 生成上限层（v1.3 增补）

第 20 章（生成质量层）与第 21 章（门禁硬化）把下限抬起来之后，v1.3 针对复审结论"能稳定专业、够不到高水准"补三块上限机制。上限的四个结构性瓶颈是：知识库只编码工艺基准不编码执行深度、素材管线（系统字体+占位图形）封死品牌表现力、单路径生成靠修补迭代爬不出平庸初版、评审只有绝对 rubric 没有方向对标。

### 22.1 执行深度知识（回答"选定方向之后怎么做到位"）

- `visual-system/references/direction-playbooks.md`：D1–D8 每方向的执行手册——首屏构成、关键手法的具体 CSS 配方、**"敷衍 vs 到位"判别**、翻车点。html-prototype 写码前必读选定方向整节；关键手法至少落地 2 处且在首屏。
- `visual-system/references/layout-composition.md`：版式构成知识——首屏构成 5 模式、留白胆量、区块节奏（宽窄/底色交替）、**视觉记忆点菜单（每交付 ≥2 处）**、动线与不对称张力、图文关系、构成自查清单。
- `visual-system/references/font-pairings.md`：开源中文字体搭配库（Google Fonts / jsdelivr / 官方自托管三类来源，按方向给"展示×界面"配方，含许可与加载纪律）。标题字体从"系统栈默认"升级为"鼓励按库升级"——字体是最强的品牌人格载体。
- `html-prototype/references/assets-guide.md` §3b：生成图像的工艺配方（mesh 渐变、噪点质感、图案底纹、统一风格的空态插画公式、设备样机 CSS）——"没有真图"不等于"看起来没设计"。

### 22.2 执行竞争（结构性对抗平庸初版）

专业模式下，方向确认后 html-prototype **必须**先做候选竞争，赢家才进入全量开发：

1. 同一方向、同一套令牌，出 2–3 个候选关键页（`audit/candidates/cand-N/`），差异在**构成层**（不同首屏模式 × 不同手法组合），不是换颜色。
2. `scripts/screenshot.mjs --candidates` 对候选在 375/1440 双视口截图（图落各候选目录）。
3. 逐候选 Read 截图对比，按 playbook"敷衍 vs 到位"与构成自查写评语，`chosen: cand-N` 与理由写入 `audit/candidates/selection.md`。
4. 验收「执行竞争」维度机器判定（18.2 表）：≥2 候选、各有 HTML+截图、selection.md 以 `cand-N/<截图名>` 限定路径逐候选引用（各候选截图常同名，裸文件名会互相蒙混）、chosen 存在。门禁逻辑在 `scripts/lib/candidates.mjs`，正反例见 `scripts/test/candidates.test.mjs`。

快速模式豁免；浏览器不可用按 6.2 记"未验证"。机器门保证"竞争确实发生、每个候选都被看过、选择被记录"；候选质量本身仍靠 playbook 约束（每个候选都须落地 ≥2 关键手法，选一个陪跑的来假竞争会被视觉评审的方向对标抓到）。

### 22.3 评审方向对标（生成↔评审同一本手册）

视觉评审 rubric 升级：评审前必读已确认方向的 playbook 整节；品牌辨识度维度按"敷衍 vs 到位"判别执行深度（不是"有没有沾边"），evidence 写可数事实（哪个手法、几处、第几屏）；记忆点 <2、关键手法 <2 处或不在首屏、无理由的居中堆叠兜底构成 warning 判例。生成侧与评审侧引用同一份判别标准，"做到位"的定义不再依赖评审者临场判断。

### 22.4 刻意不做

- 不做"美学评分"数值门槛（会诱导刷分式评审）。
- 不强制候选数 >3（边际收益递减，成本翻倍）。
- 不在机器门里判定"赢家真的比落选者好"——那是评审与用户确认门的职责；机器只保证对比过程真实发生且可复查。

## 23. 覆盖证明层（v1.4 增补）

背景：2026-07-25 第三轮复审结论——"能稳定提高下限、具备机制条件，但不能**证明**能稳定产出高水准"。三个证明缺口：① 规范审计无覆盖结构，"pass + 空 findings"可过验收；② 浏览器检查不执行真实核心任务（只有加载/axe/Tab/重排）；③ 行业规范层为零。v1.4 逐条补机器门。

### 23.1 规范覆盖矩阵

standards 评审的 findings 必须附 `rule_coverage`（schema 强制 + `semanticIssuesStandards` 语义校验，record-findings 落盘前与验收各查一次）：

- 目标平台的**全部适用规则**（按规则卡 `platforms` 筛选；行业包只在 `project.industry` 匹配时进入适用集，slug 下划线归一为文件名连字符）逐条出现，缺一条即拒收。
- 每条含 `result`（pass/fail/intent_only/not_applicable）、`checked_via`、证据（≥10 字符，写检查了什么、看到了什么）。
- `result=fail` 必须有同 rule_id 的 blocker/warning finding；反之带 rule_id 的 blocker/warning finding 不得在矩阵写 pass（双向一致性）。
- `intent_only` 仅原生平台项可用（6.3 保真度边界）；Web/mobile_web 规则禁用——HTML 即目标载体。

"没发现问题"从此不等于"合规"：必须证明每条规则都被看过。

### 23.2 可执行核心任务场景

规范 17"核心任务可以完成"从人工声明变成机器执行：

- html-prototype 产出 `prototype/scenarios.json`（manifest produces 强制）：≥1 个 `kind: success`（填写→提交→断言成功态）+ ≥1 个 `kind: error`（漏填/错填→断言错误提示，对应 wcag-3.3.1）；每场景至少一步 `expect_*` 断言。
- step 动作集：`fill/click/press/expect_visible/expect_hidden/expect_text`（`scripts/lib/scenarios.mjs` 静态校验，正反例见 `scripts/test/scenarios.test.mjs`）。
- `browser-check.mjs`（checks_version 3）用 Playwright 逐步执行，结果写入 `results.json.task_flows`；定义问题或执行失败都是阻断信号；验收「无障碍与渲染」维度消费（含同源指纹）。
- 已冒烟验证：双路径断言真实执行，注入错误断言被精确捕获（含实际文本对比）。

### 23.3 行业规则层

- `context.project.industry`（schema 字段，init `--industry`，intake 识别、requirements-research 核实）：有规则包的行业用对应 slug，通用产品用 `general`。专业模式验收必填。
- 行业规则包 `evidence/rules/industry-<slug>.yaml`，与依据库同 schema 同校验（10.1 第 5 层，strength recommended/heuristic，不覆盖 WCAG/平台规范只叠加领域纪律）。首批：`ecommerce`（8 条：费用透明/游客结账/表单最少化/感知安全/产品页要素/订单确认/错误恢复/空态引导）与 `saas_b2b`（8 条：空态引导/破坏性操作分级确认/状态可见/进度分级/防滑差错/防理解错误/数据表任务/方案对比表），全部 source_url 于 2026-07-25 curl 核实（Baymard/NN/g，evidence_grade B/C）。
- 双门禁：验收「行业依据」——industry 缺失判 fail；行业包存在但 decisions 零引用判 fail；industry 非 general 且无包记"未验证"（行业合规须人工评审）。覆盖矩阵（23.1）同时要求行业包规则逐条核查。

### 23.4 基准交付物（待执行，非代码任务）

18.1 的三类基准任务（响应式 Web、微信小程序、iOS/Android 核心流程）需在 v1.2–v1.4 全部门禁下端到端跑通并归档，才能把承诺从"有能力产出"升级为"能稳定产出"。确认门要求用户答复原文，**不能自动化伪造**——基准任务必须与用户协作执行。旧 demo（outputs/demo-web）在新门禁下按预期 fail，不作为基准。

### 23.5 承诺边界（当前准确的产品承诺）

能产出经过通用规范、可访问性、视觉流程与（已备包行业的）行业纪律约束的高保真 HTML 原型；Web/移动 Web 自动验证完整（含核心任务可执行证明），原生平台验证设计意图 + 人工清单；未备包行业不提供行业合规保证（验收显式记"未验证"）。"能稳定产出高水准"的证据以 23.4 基准交付物为准。

## 24. 门禁反规避硬化（v1.5 增补）

背景：2026-07-25 第四轮外部复审用对抗性构造证明，三个机器门**自己承诺范围内**的检查存在字节级绕过（不是 22.4 声明的"美学不判"边界问题）：① 两个字节相同的候选能通过执行竞争门——"竞争确实发生"未被执行；② 八维评审全部引用同一张截图、模板化 observed 复制八份也能通过——"评审确实逐维看了图"未被执行；③ 场景与 flows.md 核心任务零绑定，两个只断言 `body` 可见的场景可分别冒充成功/错误路径——"核心任务可以完成"退化为"页面能打开"。另实证一个证据污染 bug：④ browser-check 在键盘 Tab 遍历**之后**截图且不复位状态，审计截图残留焦点态（demo 移动截图中 skip link 焦点框压住页面标题）——评审依赖的"真实渲染证据"本身失真。v1.5 逐条封堵：

### 24.1 候选同一性（`scripts/lib/candidates.mjs`）

- 每个候选的 HTML 内容组合摘要（目录内全部 `.html` 逐文件 sha256 排序后再 hash）两两不得相同；相同即判"候选内容完全相同，竞争未发生"。
- 候选截图组合摘要同样两两不得相同——HTML 不同但截图相同意味着截图并非渲染自该候选。
- 边界声明：机器只判**字节级同一**。"改一个字符的伪差异"不在机器门职责内——22.2 已规定候选差异须在构成层，近似重复由视觉评审按 playbook 方向对标判定（22.3）。对抗性测试须同时覆盖"字节相同 → 拒绝"与"仅一字符差异 → 机器门放行（留给评审）"，把这条边界钉进测试。

### 24.2 视觉评审证据多样性（`scripts/lib/findings.mjs`）

- `audit/screenshots/` 存在 ≥2 张截图时（browser-check 恒产出桌面+移动两视口，实践中恒成立），八维 `dimension_reviews` 引用的**不同**截图必须 ≥2 张；全部同图即判"未逐维看图"。截图仅 1 张时不误伤（单图包降级为哈希匹配即可）。
- 八维的 `observed` 文本两两不得完全相同；出现重复即判"模板化复制，不构成逐维观察"。
- 边界声明：机器仍不判断 observed 的**语义**真假（那需要另一个会看图的评审，无限回归）；本节只把"逐维看图"的最低物证从"格式合规"抬到"引用多样 + 文本不可复制"。判断真假的兜底仍是 23.4 的人工盲评抽检。

### 24.3 场景绑定与断言有效性（`scripts/lib/scenarios.mjs`）

- 每个场景新增必填字段 `flow`：其值必须逐字出现在包内 `flows.md` 中——场景声称证明的任务必须是 IA 文档里真实存在的核心任务，杜绝"自造场景自证可用"。`flows.md` 缺失时场景定义直接判非法。
- `expect_*` 断言的 selector 归一（trim + 小写）后不得为 `body` / `html` / `*` / `:root`——"页面存在"不构成任务完成证明。
- 每个场景至少含一步交互（`fill`/`click`/`press`）——零交互的"场景"只是加载检查，规范 17 要求的是"填写 → 提交 → 断言"。
- `prototype/scenarios.json` 格式变更同步至 html-prototype SKILL.md（manifest produces 不变）。

### 24.4 审计截图默认态（`scripts/browser-check.mjs`，checks_version 4）

- 键盘遍历、重排/缩放检查全部完成后，截图前 **reload 页面**再截桌面/移动双视口——审计截图必须是用户首见的默认态，不得残留测试驱动的焦点浮层/悬停态。
- checks_version 升至 4；验收「无障碍与渲染」维度拒绝 `checks_version < 4` 的旧产物（截图可能残留焦点态，评审证据不可信）。

### 24.5 刻意不做

- 不做候选间视觉相似度（像素 diff/SSIM）阈值门——阈值可调等于可博弈，且会误伤"同构成不同密度"的合法候选；近似重复交给评审方向对标。
- 不做 observed 的近似重复检测（编辑距离等）——同上，改写一个词即可绕过，徒增复杂度；exact-dup 挡住的是零成本复制，有成本的伪造由盲评抽检兜底。
- 不要求场景步骤与 flows.md 的步骤逐一对应——flows.md 是自由文本，强行结构化绑定会把 IA 文档变成填表；`flow` 逐字引用已足以建立可核查的映射。

## 25. 渲染几何页边距检查（v1.6 增补）

### 25.1 动机（真实漏检事故）

首个端到端交付包（个人主页）的案例详情页在移动视口下正文贴视口左右边缘：`<div class="wrap case-body">` 把容器类与区块类挂在同一元素上，`.case-body { padding: 72px 0 }` 声明在 `.wrap { padding: 0 16px }` 之后、优先级相同，**padding 简写把水平页边距整体覆盖为 0**。三层既有检查全部漏过：

- 机器层：reflow/缩放门只判横向溢出，内容"向内贴边"不产生溢出；axe 不认为这是违规。
- 声明层：间距档位检查 grep 的是 CSS 声明值，`72px 0` 里的 72 与 0 都是合法档位值。
- 评审层：视觉评审 rubric 八维无"距视口边缘最小内边距"判据，且案例页顶部（内层干净 `.wrap`）边距正常，掩护了下方贴边区。

教训：**间距纪律必须在渲染盒几何层面复核一次**，声明合法 ≠ 渲染正确。

### 25.2 检查定义（`scripts/lib/edge-inset.mjs` + `scripts/browser-check.mjs`，checks_version 5）

- 移动检查视口（375×812）下，对**直接承载文本节点**的可见元素（与低对比度采样同口径；排除 clip-path 隐藏工艺、≤2px 隐藏元素、水平视口外与视口上方收纳元素）量 `getBoundingClientRect`：距视口左或右边缘 **严格小于 8px**（UA 默认 body margin 基线）即判贴边，`impact: serious` 计入阻断信号。
- 结果写入 `results.json.edge_insets`（逐页 offenders，含元素、文本片段、左右实测内距），供评审与验收引用。
- 采集在页面上下文自包含执行，阈值判定为纯函数（`edgeOffenders`），单测覆盖正向与对抗用例（贴右边、负坐标越界、恰好等于阈值、空输入）。
- checks_version 升至 5；验收「无障碍与渲染」维度拒绝 `checks_version < 5` 的旧产物（沿用 24.4 的升版拒旧惯例）。

### 25.3 召回基准

- `fixtures/blockers/edge-flush.html` 复刻事故形态（容器类+区块类同元素、简写覆盖），类别 `edge-flush`，`browser_only`（渲染几何静态必然漏检）；`scripts/lib/browser-detectors.mjs` 在移动视口检出。干净基线依赖 UA 默认 8px margin，阈值取严格小于保证零误报。

### 25.4 刻意不做

- 不做"最小页边距须等于 design-tokens 的 page-margin"强绑定——全出血（full-bleed）图片/色带是合法设计，只有**文本**贴边是缺陷；令牌一致性属评审判断。
- 不在桌面视口重复此检查——桌面下 max-width 居中留白会掩盖同类问题产生噪声，移动视口是最敏感且用户可感知的暴露面。

## 26. 规范库分层扩展·基础设施（v1.7 增补）

本章为指针章节：完整规范见《UI/UX 规范库分层扩展设计》（`docs/superpowers/specs/2026-07-25-uiux-standards-expansion-design.md`，2026-07-26 修订版）。本次落地其实施顺序第 1–4 步（规则包基础设施），第 5–7 步（WCAG 完整性索引、APG、内容/认知/国际化、Ant Design 与 Carbon 主参考包）留待后续批次。

### 26.1 已落地能力

- **规则包注册表**：`evidence/rule-packs.yaml`（`rule-pack.schema.json` 校验），现有 8 个规则文件全部归包（foundation/platform/industry/craft 四类）；`npm run check` 校验孤儿/幽灵/重复归属/空包/来源 host 白名单/reference_system 包禁 required 与八维声明。
- **共享激活函数**：`scripts/lib/rule-packs.mjs` 的 `applicableRules(project, rules, packs)` 为唯一适用集实现；`context.project.reference_system` 必填（首批枚举 none/ant_design/carbon），未知值抛错不回退。
- **规则版本绑定**：`snapshot.mjs` 冻结激活规则副本至 `audit/snapshots/<v>/rules/`（`rules-manifest.json` 规范化哈希 + `review-scope.yaml`）；record-findings 与 acceptance 均以冻结集校验（`scripts/lib/frozen-rules.mjs` 单一实现），规则库升级不追溯污染历史结论。
- **覆盖模板与成本控制**：机器预生成 `rule_coverage_template`（`prefilled_automated` 三重前提：检查映射登记表 `scripts/lib/check-mapping.mjs` + page_hashes 同源 + 版本一致；首批映射 3 条，keyboard 刻意不入表）；N/A 候选保守扫描（`na-scan.mjs`，2 条）；受控合并 `npm run review:merge-coverage` 实施**单向阀**（pass→fail 允许升级、fail→pass 一律拒绝）；成本四项统计入 review-scope 与最终报告。
- **验收新增四门**：规则包激活、主参考系统依据、规范版本绑定、覆盖模板闭合；未迁移历史包统一输出「需要迁移后重验」（§9.1 语义：历史 delivered 结论不追溯失效）。

### 26.2 测试

正向 + 对抗共新增 50 用例（注册表 23、覆盖模板 18、冻结绑定 9），全库 108 测试。对抗面：幽灵/孤儿文件、私货卡（快照含 manifest 外卡）、哈希漂移、fail→pass 篡改、未确认 N/A、注册表升级后激活门报不一致等。

## 27. Token 效率层（v1.8 增补）

### 27.1 目标与不变量

背景：首批端到端实测证明系统"质量优先、Token 偏高"——样本多页专业任务中 4 轮双评审文本输入约 551k tokens、7 轮迭代 84 张截图中 49% 哈希完全重复、4 个页面各内联同一份 26.4KB CSS、评审 Agent 可能通读整个 `evidence/rules/`。本章目标：多页专业任务减少 40%–60% 文本输入、消除接近一半的重复迭代图读取。

**不变量（省 token 的红线）**：不合并两个评审角色；不删减 WCAG 规则；不对迭代轮数设硬上限；**最终交付版本仍走全量双评审 + 全量浏览器检查**——本章所有机制只作用于中间过程（中间轮截图、中间版本评审、上游知识加载、上下文派发），验收对最终版本的既有门禁一律不放松。历史包（快照无 `snapshot_version >= 2` 标记，即 v1.7 及以前产物）不追溯判非法，新门禁输出迁移措辞（§9.1 语义）。

### 27.2 共享样式抽取门（`scripts/lib/css-dup.mjs` + `scripts/lint-prototype.mjs`）

多页原型（`prototype/**/*.html` ≥2 页）：① 每页必须以 `<link>` 引入至少一个 `prototype/assets/` 下的共享样式表；② 规范化（剥注释、压空白）后内容 sha256 相同且长度 ≥2048 字符的内联 `<style>` 块出现在 ≥2 个页面即判 fail。页面私有小段样式（<2KB）不管；`audit/candidates/` 豁免（候选刻意单文件自包含）；单页项目豁免。检查为纯静态（无浏览器依赖），`npm run lint:proto` 供 html-prototype 自检，验收新增「共享样式」维度调用同一实现——**不放进 browser-check**，保证降级环境不豁免。

### 27.3 增量截图（`scripts/screenshot.mjs --incremental` + `scripts/lib/iterations.mjs`）

- 首轮与收官轮必须全量；第 2 轮起可用 `--incremental`：与上一轮 `meta.json` 的 `page_hashes` 比对（`diffHashMaps`），只重截变更页。**保守规则**：`prototype/assets/**` 或 `design-tokens.json` 任何变化 → 全部页面视为变更（共享样式全局生效，防"改共享 CSS 只截一页"）；变更页数为 0 → 拒绝执行（空轮不构成迭代，勿刷轮数）。
- `meta.json` 升级 v2：新增 `meta_version: 2` 与 `pages[]`，每页 `{name, slug, status: "shot"|"carried", from_round?, page_sha256?, shots?}`；`page_hashes` 仍为全树口径不变。carried 只允许一跳引用某个真实截图轮（生成时自动解析到最近 shot 轮，禁转引链）。
- **验收携带链校验**（`iterationChainIssues`，acceptance 5b 迁入）：首末轮全量；每条 carried 记录三方哈希一致（当前轮 `page_hashes[页]` === 引用轮同键值 === 记录内 `page_sha256`），引用轮该页须为 shot 且 PNG 真实在盘；meta 登记的 shots 文件必须存在；notes.md 仍须引用**当轮实际新截**的图（carried 不算当轮证据）。伪造"谎称未变"需同时篡改两轮 meta，而末轮全量 + 末轮与交付原型逐字节同源（既有门）锚定交付态真实。无 `meta_version` 的 v1.7 meta 按全量轮兼容处理。

### 27.4 紧凑评审规则包（`scripts/lib/review-bundle.mjs`）

- `snapshot.mjs` 冻结规则后追加生成 `rules/review-bundle.yaml`：激活规则按 `rule_id` 排序的**确定性投影**，每条含 `rule_id/pack_id/state/title/rule/check_method/platforms/scope/strength` 及可选 `exceptions/na_candidate`；剔除 `publisher/source_url/source_version/last_verified/rationale/evidence_grade/conflicts_with`（溯源与裁决字段留在冻结全卡，评审需要时回读），也不带行级 `rule_sha256`（完整性由再生比对整体保证，逐规则哈希在 `rules-manifest.json`）。Web 48 条实测较冻结全卡省约 30% 字节（且评审从"读 3 个来源文件 + 可能通读 107 条规则库"收敛为"读 1 个已按适用集筛好的文件"）；bundle 由 `applicableRules` 派生、不假设规则数，规则库扩张（扩展设计第 5–7 步）后收益自动放大。
- **再生比对门**：`buildReviewBundle` 为 snapshot 与校验方共用的纯函数；`loadFrozenRules` 在冻结卡哈希校验通过后用冻结卡重建 bundle 并比对 sha256——篡改 bundle 软化规则文本即被抓（篡改冻结卡本身已被既有哈希门拦）。v1.7 老快照无 bundle → 返回 `bundle: null`，评审回退读全卡，不报错。
- standards-audit 的评审输入首选 bundle，同时**收回 `evidence/rules/` 读权限**（修正 v1.7 措辞残留——§8.4 本就要求评审只读冻结集）。

### 27.5 中间版本增量评审（`scripts/lib/delta-review.mjs` + `schemas/findings-delta.schema.json`)

- 协议：**首个版本与拟交付版本全量双评审**（现状不变，验收「标准合规门/视觉质量门/规则快照四门」一行不改）；中间版本（首版与拟交付版之间）可用 delta 评审。验收本就只消费当前版本的全量 findings，delta 结论不进验收。
- **delta 包**（确定性、可再生）：`snapshot.mjs --delta-from <prev>` 在新快照内生成 `delta/`（计入快照 manifest 哈希）：`changed-files.json`（两个冻结快照的 `diffHashMaps` 结果）、`files.diff`（`scripts/lib/text-diff.mjs` 朴素逐行 diff，两侧都是冻结快照故字节确定）、`open-findings.yaml`（前版 blocker/warning findings + coverage fail 规则清单，机器汇取）、`changed-pages.json`。校验方从两个冻结快照 + 前版 findings 重建比对（`deltaIssues`，同 27.4 再生门模式）。
- **delta findings**：经 `record-findings.mjs --delta` 落盘为 `audit/findings/<reviewer>-<v>-delta.yaml`——与全量 `-<v>.yaml` 命名区隔，`loadFindingsForVersion` 只找全量名，且全量 schema `additionalProperties: false` 拒收 `baseline_version` 字段，**delta 永不可能冒充全量评审**（双保险）。语义校验（`semanticIssuesDelta`）：baseline findings 存在且逐版接续；rule_id 都在冻结 manifest 内；截图哈希纪律与全量同源（复用同一子函数）；**闭合性——baseline 的每条 open blocker/warning 必须出现在 `resolved_findings`（≥10 字核销证据）或 `findings`（再断言）中**，缺一拒收：省 token 不许静默丢问题。
- **验收新增「迭代评审链」维度**：对每个介于首版与当前版本之间的中间版本，须存在全量 findings 对或通过语义校验的 delta 对；仅 `snapshot_version >= 2` 的包启用，老包输出「v1.7 流程包，无迭代评审链要求」。

### 27.6 最小上下文投影（`scripts/project-context.mjs`）

§5.2 的 reads 白名单此前只用于出向门禁（越权补丁拒绝），入向仍传完整 `context.yaml`。v1.8 将既有 `projectContext(ctx, reads)`（`scripts/lib/context.mjs`）接线为 CLI `npm run ctx:project -- --package <dir> --skill <id>`：按该 Skill manifest 的 `reads` 生成字段投影视图。Director 派发协议同步：每个流程 Skill 收到**投影视图 + 声明的输入产物路径**，且每次派发使用全新子代理会话（不继承完整聊天历史）。投影与 `hardenedGate` 共用同一份 manifest，无第二实现。评审侧不变（本就禁读 context.yaml）。

### 27.7 知识库按方向章节路由

`skills/visual-system/references/direction-playbooks.md`（约 12KB，8 个平行方向章节）拆分为 `references/playbooks/_intro.md`（总则 + 候选竞争构成要求）+ `D1.md`–`D8.md`。两阶段加载协议：**方向选定前**读 `direction-library.md`（方向索引）+ `color-system.md` + `type-and-spacing.md`，提案候选只读候选方向的 `Dn.md` + `_intro.md`；**方向确认后**只读选定 `Dn.md` + `font-pairings.md` 中该方向配方节 + `layout-composition.md`。不再要求每次调用通读 8 个方向的完整执行手册。结构一致性门：`npm run check` 校验 `direction-library.md` 声明的方向与 `playbooks/` 文件一一对应（无缺章、无孤儿，`scripts/lib/kb-index.mjs`，与规则包幽灵/孤儿检查同构）。

### 27.8 快速模式自动分类（`scripts/lib/mode-classifier.mjs`）

- `suggestMode()` 纯函数（`npm run mode:suggest` CLI）：单页 且 流程 ≤2 且 无品牌探索 且 单平台 → 建议 `quick` 并给出理由；任一输入缺失 → `professional`（不猜）。分类只产生**建议**，Director 须把理由呈给用户确认。
- **模式确认门机器化**：`director-advance.mjs --confirm mode`（`context.schema.json` 的 `confirmations` 新增 `mode` 键，`--reply` 仍须用户答复原文）。验收「流程确认」维度：`mode === "quick"` 的 v1.8 包（`snapshot_version >= 2`）须存在 `confirmations.mode`，缺失即 fail；老包不追溯。
- 快速模式的既有硬底线（WCAG 2.2 AA、多视口截图、溢出/console 检查、依据记录，§9.2）均为验收无条件维度，不受本节影响。

### 27.9 复审修正（v1.8 落地后第一轮外部复审，3 P1 + 3 P2 逐条封堵）

- **审计证据视口初始化（checks_version 6）**：此前 `screenshot.mjs` 先按默认 1280px 加载再缩放视口、`browser-check.mjs` 在 640px reload 后直接换视口截图——依赖初始化宽度的响应式页面（JS 断点、一次性布局计算）会把错误状态截进审计证据。修正：迭代截图每个视口用**独立 context 并在设置视口后才导航**；审计截图每个视口**先设尺寸再 reload**（同时保留 24.4 的默认态复位语义）。checks_version 升至 6，验收拒绝旧产物（沿用升版拒旧惯例）。
- **迭代覆盖精确化**：「首末轮全量」不再只看"有 PNG 且无 carried"——每轮 `pages[]` 必须与该轮 `page_hashes` 中的 HTML 页面**一一对应**（漏登记/幽灵页都拒），实拍页三视口 PNG 缺一即 fail；末轮 `page_hashes` 被交付原型同源门锚定，覆盖校验因此传递到真实页面列表。v1.8 包（snapshot_version≥2）**强制 meta_version≥2**——删掉 meta_version 降级到 v1 兼容路径以跳过携带链/覆盖校验的规避无效（v1.7 老包的 v1 meta 仍按兼容语义放行）。
- **评审链严格版本绑定**：`loadReviewerFindings` 要求文档内 `artifact_version` 等于文件名版本（文件里写别的版本号即拒载）；「迭代评审链」维度对首版与全部中间版的**全量评审完整复用全量语义门**（冻结规则 + 覆盖矩阵 + 模板闭合 + 视觉八维证据），不再只查文件存在；delta findings **必须绑定同版本快照的 `delta/changed-files.json`** 且 `baseline_version` 一致——无 delta 包或基线脱钩即拒收。
- **变更页全局展开**：`delta/changed-pages.json` 对共享资产（`assets/**`）、`design-tokens.json`、页面删除等全局生效的变化**展开为全部页面**（`expanded_all: true` + reason），只有纯页面级 HTML 改动才按页增量——防视觉 delta 漏看受影响页。`decisions.md` 纳入 delta diff 范围（standards 评审可见基线后追加的裁决），但不触发页面展开。
- **快照原子性**：`--delta-from` 等参数在创建任何目录**之前**校验完毕；快照组装到临时目录、全部成功后原子 rename——中途失败不再留下会被不可覆盖门卡死的半成品。
- **模式分类输入合法性**：`suggestMode` 要求页面数为正整数、流程数为非负整数，拒绝负数/NaN/Infinity/小数（非法输入与信息缺失同样保守回退专业模式）。

### 27.10 刻意不做

- **不做 CSS AST 级相似度**——只封"规范化后逐字节重复"的零成本复制；规则重排序绕过属残余风险，由视觉评审组件一致性维度兜底（同 24.5 的 exact-dup 边界哲学）。
- **不机器验证"Agent 实际读了哪章知识库"**——不可验证；产出质量仍由既有门守（候选竞争、确认门 C、视觉评审方向对标）。`font-pairings.md` 不拆分（5.5KB，收益低于维护成本）。
- **不对中间版本 delta findings 做覆盖矩阵全量闭合**——那正是要省的成本；最终版本的覆盖模板闭合门原样保留。
- **不校验中间轮 meta 哈希的历史真实性**——快照体系外无法复算；末轮全量 + 末轮同源是硬锚，暴露面与 v1.7 一致未加宽。携带链是防低成本谎报的一致性检查，不是密码学证明。
- **不自动降级到快速模式**——分类只建议，用户不确认不生效。
- **不追溯历史包**——共享样式、迭代评审链、模式确认三门均以 `snapshot_version >= 2` 判新老，历史 delivered 结论不失效。
- **提示缓存与并行评审不在本章范围**——缓存只降费用与延迟、并行只降墙钟时间，均不减少名义 token，不构成本章意义上的优化。
