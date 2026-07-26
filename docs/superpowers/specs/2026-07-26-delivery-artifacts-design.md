# Design.md 与设计方案 PPT 交付能力设计

日期：2026-07-26
状态：已完成对话确认，待书面复核

## 1. 背景与决策

现有设计 Agent 的核心交付是经过研究、UX、视觉、原型、浏览器检查和双评审的设计包，但开发团队仍需自行把这些分散产物整理成实施说明，业务与产品团队也缺少一份可以独立讲清设计方案的演示文稿。

本次新增两项交付能力：

- `developer_handoff`：生成面向开发、可直接实施的根目录文件 `Design.md`。
- `design_presentation`：生成完整设计方案演示 `presentation/design-system.pptx`。

两个能力采用独立的交付型 Skill，在当前版本双评审通过后、`review -> delivered` 之前运行。它们不成为新的阶段，也不修改已评审的设计产物。

用户确认的产品决策如下：

- 专业模式强制生成两份文件，快速模式仅在用户要求时生成。
- `Design.md` 是完整开发交接文档，不只是设计意图摘要。
- PPT 采用参考文件的完整方案叙事，不局限于狭义设计系统页面。
- PPT 必须是原生可编辑 `.pptx`；文字、色块、表格和基础图形不可整页栅格化。
- PPT 采用“稳定报告外壳 + 项目视觉”的混合模式。

## 2. 参考文件结论

参考文件为飞书 Wiki 节点中的 `Kivo官网改版设计方案.pptx`：

`https://beansmile.feishu.cn/wiki/IjK1wJlg6i50zlk8zizcgDCMnCe?from=from_copylink`

该文件共 18 页，叙事由以下部分组成：封面、改版问题、设计主线、问题与方案对照、设计系统、核心页面方案、设计价值论证、边界与遗留事项、后续排期。

本系统只复用这套叙事逻辑，不复制 Kivo 的颜色、品牌素材或逐页栅格化实现。每个项目的输出必须使用本项目已确认的品牌资产、设计令牌、原型截图和内容。

## 3. 目标与非目标

### 3.1 目标

- 让开发可以仅凭 `Design.md`、原型和资源完成实施拆分与验收。
- 让产品、业务、客户和开发可以通过一份完整 PPT 理解设计问题、方案、系统、核心页面、价值与后续工作。
- 保证两份文件与同一个已评审冻结版本绑定，不能引用不同版本。
- 对文件存在性、内容覆盖、来源绑定、可编辑性和视觉 QA 建立机器门禁。
- 保持现有阶段链 `intake -> research -> ux -> visual -> prototype -> review -> delivered` 不变。

### 3.2 非目标

- 不生成生产级前端或原生应用代码。
- 不把 `Design.md` 变成某一前端框架专用的代码设计书；只有用户提供技术栈时才加入对应实现映射。
- 不要求 PPT 固定为 18 页或复刻参考文件版式。
- 不允许交付 Skill 新增未经评审的页面、交互、组件或设计决策。
- 不把 PDF、HTML 演示或整页图片封装的 PPTX 当作可编辑 PPTX 的替代品。

## 4. 总体架构

两份交付物只从当前已通过双评审的冻结版本生成。原型快照在评审前创建，而 warning 处理和聚合报告在评审后形成，因此 Director 还要在派发前生成一份只读的 `audit/delivery/source-manifest.json`：

```text
audit/snapshots/3/                  # 示例：当前 artifact_version=3
  + brief、flows、tokens、prototype、评审前 decisions
                              +
audit/delivery/source-manifest.json
  + snapshot manifest digest
  + 最终 context 投影、追加后的 decisions
  + browser results、实际使用的 screenshots
  + version-bound findings、audit report
                              |
                              v
                   评审交付门通过
             blocker=0，warning 已处理，快照无漂移
                              |
                 +------------+------------+
                 |                         |
                 v                         v
       developer_handoff          design_presentation
             Design.md          presentation/design-system.pptx
                 |                         |
                 +------------+------------+
                              |
                              v
                    交付物独立 QA 与验收
                              |
                              v
                          delivered
```

`source-manifest.json` 记录以上每个输入的相对路径与 SHA-256，并计算 `source_bundle_digest`。交付型 Skill 的输入是这份 manifest 及其列出的只读文件。Skill 返回文件和一份仅更新自己 artifact key 的字段补丁；Director 通过既有 diff 门禁后才合并。

生成开始前与结束后都要校验快照 manifest digest、source bundle digest 及逐文件哈希。生成期间若任一源文件变化，当前输出作废并重新派发。

## 5. 模式语义

`context.project.delivery_outputs` 记录本次要求的交付型 Skill：

```yaml
project:
  delivery_outputs:
    - developer_handoff
    - design_presentation
```

- 专业模式：两个值都必须存在，初始化或迁移时不得静默省略。
- 快速模式：默认可为空；用户可以按需请求一个或两个输出。
- 一旦出现在 `delivery_outputs`，采用与专业模式相同的内容和质量门禁，不提供“低质量快速 PPT”分支。

## 6. Skill 与注册表契约

`skills/registry.yaml` 新增两个 `kind: deliverable` 条目。现有 manifest 机制扩展为同时覆盖 `flow` 和 `deliverable` 两种会返回 context 补丁的 Skill；评审和 Director 仍不进入 manifest。

### 6.1 developer_handoff

```yaml
skill: developer_handoff
reads:
  - project
  - users
  - goals
  - brand
  - constraints
  - assumptions
  - decisions
  - exceptions
  - artifacts.flows
  - artifacts.tokens
  - artifacts.prototype
writes:
  - artifacts.handoff
produces:
  - Design.md
required_modes: [professional]
```

它不得写 `stage`，不得修改 `brief.md`、`flows.md`、`design-tokens.json`、`decisions.md` 或 `prototype/`。

### 6.2 design_presentation

```yaml
skill: design_presentation
reads:
  - project
  - users
  - goals
  - brand
  - constraints
  - assumptions
  - decisions
  - exceptions
  - artifacts.flows
  - artifacts.tokens
  - artifacts.prototype
writes:
  - artifacts.presentation
produces:
  - presentation/design-system.pptx
  - audit/presentation/manifest.json
  - audit/presentation/qa.json
required_modes: [professional]
```

它同样不得写 `stage` 或修改任何已评审设计产物。渲染图属于 QA 证据，写入 `audit/presentation/rendered/`，不逐项列入静态 `produces`。

### 6.3 调度隔离

两个 Skill 分别使用全新会话，可并行运行。它们只收到自身 context 投影、冻结快照索引、当前 `audit/report.md` 和允许读取的文件，不继承完整主会话历史，也不读取对方的草稿输出。

Director 是唯一可以把通过门禁的 artifact 补丁合并到 `context.yaml` 并推进 `delivered` 的角色。

## 7. context.yaml 与来源绑定

`artifacts` 条目增加 `source_manifest_digest`、`source_bundle_digest` 和 `sha256`：

```yaml
artifacts:
  handoff:
    path: Design.md
    artifact_version: "3"
    source_manifest_digest: "sha256:snapshot-manifest"
    source_bundle_digest: "sha256:delivery-source-bundle"
    sha256: "sha256:design-md"
    updated_by: developer_handoff
  presentation:
    path: presentation/design-system.pptx
    artifact_version: "3"
    source_manifest_digest: "sha256:snapshot-manifest"
    source_bundle_digest: "sha256:delivery-source-bundle"
    sha256: "sha256:design-system-pptx"
    updated_by: design_presentation
```

两个 artifact 的 `artifact_version` 必须等于 `artifacts.prototype.artifact_version`，两个来源摘要必须分别等于快照 manifest digest 和 delivery source bundle digest。文件哈希必须由验收脚本重新计算，不能只信 Skill 自报值。示例中的版本 `"3"` 仅表示当前 artifact version，不是固定版本号。

## 8. Design.md 内容契约

`Design.md` 使用 YAML frontmatter 和稳定 Markdown 标题，兼顾阅读与机器校验：

```yaml
---
artifact_version: "3"
source_manifest_digest: "sha256:snapshot-manifest"
source_bundle_digest: "sha256:delivery-source-bundle"
platforms: [web, mobile_web]
generated_at: "2026-07-26T12:00:00Z"
---
```

正文固定包含以下一级章节：

1. `实施概览`：项目目标、实施范围、非目标、目标平台和技术栈事实。
2. `信息架构与路由`：页面、路由、入口、出口、导航关系和权限前提。
3. `页面规格`：每个页面的目的、内容顺序、组件、交互和跳转。
4. `状态规格`：正常、加载、空、错误、成功、禁用、焦点及业务特有状态。
5. `响应式与平台适配`：各目标视口或平台的布局、导航、输入和反馈变化。
6. `组件契约`：属性、变体、状态、内容长度、复用边界和依赖。
7. `设计令牌`：实际语义 token、值、用途和禁止误用说明。
8. `资源清单`：图片、图标、字体、动画等资源的路径、用途、裁切和替代文本。
9. `无障碍要求`：语义、键盘、焦点、名称、对比度、重排、触控目标和人工核验项。
10. `开发验收用例`：每个核心流程的前置条件、步骤、预期结果和错误路径。
11. `决策、例外与边界`：已确认决策、规则引用、例外、遗留项和待人工验证项。

每个原型页面必须有独立的三级标题，并声明 `prototype_path`；每个核心场景必须逐字引用 `prototype/scenarios.json` 的 flow 名称。文档只写已存在于冻结输入中的事实。技术栈未知时明确写“技术栈未指定”，不得虚构框架、组件库或 API。

### 8.1 Design.md 机器校验

校验脚本重新解析源产物并检查：

- frontmatter 的版本、快照 digest 和 delivery source bundle digest 正确。
- 所有必需章节存在且非空。
- `prototype/` 中每个 HTML 页面都出现在页面规格中。
- `prototype/scenarios.json` 中每个成功与错误场景都有验收用例。
- 文档引用的 token 名称存在于 `design-tokens.json`。
- 所有本地资源路径存在且不越出交付包。
- 不含 `TBD`、`TODO`、占位文、空章节或未解释假设。
- 不出现源文件中没有的新页面、新组件或新业务结论。

最后一项以页面、flow、token、asset 和 decision 标识的集合闭合为机器门，语义层面的新决策风险由 Director 做最终检查。

## 9. 设计方案 PPT 内容契约

固定文件路径为 `presentation/design-system.pptx`。默认建议 14 至 20 页，但页数不是验收条件；小型项目可以合并页面，大型项目可以扩展核心页面章节。

必须覆盖八个叙事角色：

1. 封面：项目名称、设计方案、版本。
2. 现状问题、业务目标与设计目标。
3. 设计主线与“问题 -> 方案”映射。
4. 设计系统：颜色、字体、间距、组件、图标、图片和动效语言。
5. 核心页面和关键流程方案。
6. 设计价值论证：只使用原型、流程和已核实证据，不虚构转化率、收入或用户反馈。
7. 已知边界、遗留事项、实施风险和人工验证项。
8. 开发及产品团队的后续步骤。

每页只承担一个主要叙事任务。页标题应表达结论，不用“页面展示”“设计说明”等生产提示语。外部事实、外部图片和非平凡主张在该页 speaker notes 的 `[Sources]` 区块中记录来源；项目内部产物记录相对路径和快照版本。

### 9.1 视觉模型

PPT 使用已确认的混合模型：

- 稳定外壳负责页边距、页码、标题层级、正文排版、信息页和表格的可读性。
- 项目视觉负责封面、章节页、色彩与字体样本、页面截图、品牌素材和重点结论。
- 稳定外壳不是单一固定色板；强调色从项目语义 token 中选择，但必须满足演示可读性。
- 禁止复制参考项目的品牌素材、文案或 Kivo 配色。

### 9.2 原生可编辑要求

- 标题、正文、页码、色块、表格、基础图形和简单关系图必须是 PowerPoint 原生对象。
- 原型截图、照片、品牌图像和复杂插画可以作为图片嵌入。
- 封面和章节页可以使用全幅背景图，但标题仍必须是可编辑文本。
- 内容页禁止只有一张覆盖整页的图片；设计系统页必须能分别编辑色板、字体说明和组件标注。
- 不允许通过把 PDF 或逐页 PNG 包进 PPTX 来通过文件格式检查。

### 9.3 presentation manifest 与 QA

`audit/presentation/manifest.json` 为每页记录：

- slide number、稳定 slide id 和 narrative role。
- 使用的项目源文件、截图和外部来源。
- 可编辑文本、形状、表格、图表和图片的实际数量。
- 是否允许全幅背景图及允许理由。

这些对象数量由 PPTX 结构检查器重新计算，不接受自报值。

`audit/presentation/qa.json` 绑定 PPTX SHA-256，并记录：

- 每页渲染图路径和 SHA-256。
- 重叠、裁切、溢出、标题换行、字体替代和空占位符检查结果。
- 逐页检查状态和需要人工确认的项目。
- 渲染器、检查器和输出时间。

结构与渲染检查由仓库脚本根据最终 PPTX 重算，不能接受创作 Skill 自报的 `pass`。Director 必须在独立于 PPT 创作会话的主会话中逐页查看最终渲染图，处理 QA findings 后才登记 presentation artifact。

## 10. PPT 生成能力抽象

`design_presentation` 依赖一个跨运行时的 presentation adapter，而不是在 Skill 内假设单一私有 API。adapter 必须提供：

1. 从空白演示创建并输出 `.pptx`。
2. 创建可编辑文本、形状、表格、图片和 speaker notes。
3. 读取最终 PPTX 的 slide/object 结构。
4. 逐页渲染 PNG。
5. 输出可供重叠、溢出和字体检查使用的布局证据。

Codex adapter 使用可用的 Presentations 能力及 `@oai/artifact-tool`。其他运行时可以使用等价实现，但必须通过相同产物和 QA 门，不能因工具不同降低契约。

环境自检增加 presentation adapter 的创建、导出、重读和渲染探针。只检测命令存在不算通过，探针必须实际生成含可编辑文本的最小 PPTX、重读对象并渲染一页。

## 11. 生成与验收顺序

1. Director 确认当前版本双评审可交付且快照无漂移。
2. Director 生成并冻结 `audit/delivery/source-manifest.json`，再为两个 Skill 分别生成只读 context 投影和文件索引。
3. 两个 Skill 在独立会话中生成输出。
4. `developer_handoff` 运行内容闭合检查。
5. `design_presentation` 运行 PPTX 结构检查、逐页渲染和 QA。
6. 每个 Skill 返回仅含自身 artifact key 的补丁。
7. Director 独立逐页查看 PPT 渲染图，运行 diff 门、重新计算两层来源摘要与文件哈希并合并补丁。
8. `acceptance.mjs` 汇总原有门禁和新增交付门。
9. 所有强制输出通过后，Director 才执行 `review -> delivered`。

## 12. 验收门

新增两个独立维度：

- `开发交接文档`：存在性、内容闭合、快照绑定和哈希均通过。
- `设计方案演示`：存在性、章节覆盖、原生可编辑性、来源、结构和逐页 QA 均通过。

专业模式中任一文件缺失、过期、被篡改或 QA 失败，验收返回 fail。快速模式只对 `project.delivery_outputs` 中声明的输出启用同样门禁。

如果 PPTX 已生成但渲染能力不可用，`设计方案演示` 返回 unverified，交付包保持 `review` 并标记待人工验证；不能进入 `delivered`。如果 adapter 连可编辑 PPTX 都无法生成，直接返回 fail，不提供格式降级。

## 13. 变更与错误处理

- 交付 Skill 发现需要新增设计决策时停止生成，Director 将任务退回相应设计阶段，升版后重走截图、快照和双评审。
- 源 manifest 在生成期间变化时丢弃输出，不能把旧输出登记到新版本。
- 仅修正文档措辞或 PPT 排版且没有新增设计事实时，可以在同一源版本重新生成，但必须重新运行对应 QA 并更新文件哈希。
- 在验收前手工编辑 PPTX 会使哈希和 QA 绑定失效，必须重新检查；`delivered` 后复制出的下游版本不再代表本交付包的审计结论。
- 生成器不可用、字体缺失、图片损坏、输出无法重读或渲染时，报告具体能力和文件位置，不得静默删页或栅格化绕过。

## 14. 历史包迁移

新增交付门由新的快照版本启用。历史已处于 `delivered` 的包不因缺少 `Design.md` 或 PPT 被追溯判错。

历史包若要补交这两份文件，必须显式迁移：补写 `project.delivery_outputs`，使用当前工具重新冻结、双评审、生成交付物并验收。不能直接从历史活动目录生成后沿用旧 verdict。

## 15. 测试策略

### 15.1 注册表与 diff 门

- 两个 deliverable id、目录和 manifest 一一对应。
- 投影视图只包含声明的 context 字段。
- 合法补丁只能更新自身 artifact key。
- 修改 `stage`、prototype、tokens、decisions 或另一个交付 artifact 必须失败。

### 15.2 模式与版本

- 新专业模式包缺任一交付物必须失败。
- 快速模式未请求时允许缺失，请求一个或两个后按声明验收。
- artifact version、snapshot digest、source bundle digest、文件哈希任一错配必须失败。
- 生成期间源快照漂移必须拒绝登记。
- 旧快照版本输出迁移提示，不追溯撤销历史 delivered 结论。

### 15.3 Design.md

- 正向夹具覆盖全部页面、流程、状态、token 和 asset。
- 分别删除必需章节、页面、错误路径、token 或资源引用时必须失败。
- `TBD`、`TODO`、占位文、越界路径和虚构页面必须失败。

### 15.4 PPTX

- 正向夹具包含可编辑文本、色板、表格、截图、notes、manifest 和全部渲染页。
- 缺叙事角色、缺来源、slide/render 数不一致必须失败。
- 内容页整页图片化、空占位符、对象数量自报不符必须失败。
- 重叠、裁切、溢出、标题异常换行和字体替代必须失败或按明确人工项返回 unverified。
- QA 绑定旧 PPTX SHA 或渲染图被替换必须失败。

## 16. 文档与完成定义

实现时同步更新：

- `skills/design-director/SKILL.md`：在 review 与 delivered 之间增加交付型 Skill 调度。
- 两个新 Skill 的 `SKILL.md` 及必要 references。
- `skills/registry.yaml`、manifest schema 与 manifest 清单。
- `schemas/context.schema.json` 和初始化参数。
- `scripts/env-check.mjs`、交付物检查脚本与 `scripts/acceptance.mjs`。
- `docs/usage.md` 的阶段说明、命令和交付包目录树。
- 原系统设计规范中“PPT 不进入第一版”的范围声明，明确本能力从新快照版本起生效。

完成必须同时满足：

- 新的注册表、schema、diff 门、模式和迁移测试通过。
- `Design.md` 内容闭合的正向与对抗测试通过。
- 可编辑 PPTX 的创建、重读、逐页渲染和对抗夹具测试通过。
- `npm run check`、`npm test`、`npm run validate:rules` 通过。
- 使用一个新的专业模式示例包实际生成两份文件，并由 `acceptance.mjs` 判定通过。
