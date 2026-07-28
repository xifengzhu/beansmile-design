# Design.md 与设计方案 PPT 交付能力设计

日期：2026-07-26
状态：已实现并完成端到端验收

## 1. 背景与决策

现有设计 Agent 的核心交付是经过研究、UX、视觉、原型、浏览器检查和双评审的设计包，但视觉与原型 Agent 缺少一份在创作前冻结的统一设计契约，开发团队也需自行把分散产物整理成实施说明。业务与产品团队则缺少一份可以独立讲清设计方案的演示文稿。

本次新增两项交付能力：

- `design_specification`：在视觉设计前生成根目录 `Design.md` 的设计契约，双评审后在同一文件补齐开发实施规格。
- `design_presentation`：生成完整设计方案演示 `presentation/design-system.pptx`。

`design_specification` 是两次运行、单文件单所有者的 Skill：第一次位于 `ux -> visual` 之前，第二次位于双评审通过后、`review -> delivered` 之前。`design_presentation` 只在第二次完成后运行。两者不新增生命周期阶段；`Design.md` 的冻结契约部分在第二次运行时不可修改。

用户确认的产品决策如下：

- 专业模式强制生成两份文件，快速模式仅在用户要求时生成。
- `Design.md` 必须在视觉或原型创作前存在并指导下游 Agent，不能在评审后临时补写来伪装前置契约。
- 同一个 `Design.md` 先形成经用户确认的设计契约，后补齐实际 token、组件、资源、原型和评审信息，最终成为完整开发交接文档。
- 设计后补齐不得静默改变已确认的页面、流程、状态和约束；需要改变时必须回退、递增契约版本并重新确认。
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

- 在创作前形成统一、可确认、可机器绑定的设计契约，指导视觉系统和 HTML 原型 Agent。
- 让开发可以凭最终版 `Design.md`、原型和资源完成实施拆分与验收。
- 让产品、业务、客户和开发可以通过一份完整 PPT 理解设计问题、方案、系统、核心页面、价值与后续工作。
- 保证设计前契约、视觉令牌、原型、最终 `Design.md` 和 PPT 具有可验证的来源链，不能引用不同契约或设计版本。
- 对文件存在性、内容覆盖、来源绑定、可编辑性和视觉 QA 建立机器门禁。
- 保持现有阶段链 `intake -> research -> ux -> visual -> prototype -> review -> delivered` 不变。

### 3.2 非目标

- 不生成生产级前端或原生应用代码。
- 不把 `Design.md` 变成某一前端框架专用的代码设计书；只有用户提供技术栈时才加入对应实现映射。
- 不另建与 `Design.md` 竞争的 `Handoff.md`；设计前约束和设计后实施事实必须保留在同一个事实源中。
- 不在设计前版中预留 `TBD`、`TODO` 或空章节；尚未产生的实施事实只在第二次运行时增加。
- 不要求 PPT 固定为 18 页或复刻参考文件版式。
- 不允许第二次 `design_specification` 或 `design_presentation` 运行新增未经确认、未经评审的页面、交互、组件或设计决策。
- 不把 PDF、HTML 演示或整页图片封装的 PPTX 当作可编辑 PPTX 的替代品。

## 4. 总体架构

`Design.md` 先约束设计，再记录设计的最终实现。Director 在 UX 完成后生成只读的 `audit/design/contract-source.json`，列出 `brief.md`、`flows.md`、相关 context 投影、决策与规则输入的相对路径和 SHA-256。`design_specification prepare` 只能从该清单生成设计契约。

```text
brief.md + flows.md + context 投影 + 规则/决策
                         |
                         v
       audit/design/contract-source.json
                         |
                         v
      design_specification prepare
              Design.md
         phase=proposed_contract
                         |
                  用户确认门 B
                         |
           Director seal + contract lock
                         |
                         v
                visual_system
             绑定 contract_digest
                         |
                         v
                html_prototype
             绑定 contract_digest
                         |
              浏览器检查、快照、双评审
                         |
       audit/delivery/source-manifest.json
                         |
                         v
      design_specification finalize
              Design.md
       phase=implementation_ready
                         |
                         v
            design_presentation
       presentation/design-system.pptx
                         |
                         v
                      delivered
```

`contract_digest` 只对 `Design.md` 中冻结的“设计契约”部分做规范化解析后计算，不包含 frontmatter 和后续增加的“实施规格”，避免自引用。`prepare` 先产出 `phase: proposed_contract` 的文件和暂不合并的 artifact 补丁。用户确认后，Director 通过确定性的 seal 命令把 frontmatter 改为 `approved_contract`，合并补丁并生成 `audit/design/contract-lock.json`。lock 记录 `contract_digest`、`flows.md` 哈希、确认记录哈希、阶段转换和当时不存在下游设计产物的事实；Visual 与 Prototype 产物同时绑定 `contract_digest` 和 contract lock 哈希。seal 只允许修改 frontmatter 状态与确认元数据，不得改变第一部分正文。

原型快照仍在评审前创建并包含设计前版 `Design.md`。双评审通过后，Director 生成 `audit/delivery/source-manifest.json`，绑定快照 manifest、最终 context 投影、追加后的 decisions、浏览器结果、实际截图、当前 findings、聚合报告及设计契约。第二次运行只能据此补齐实施规格。PPT 再额外绑定最终 `Design.md` 的 SHA-256。

每次生成开始前和结束后都要校验相应 source manifest、逐文件哈希和 contract lock。生成期间任一源文件变化时，当前输出作废并重新派发。

## 5. 模式语义

`context.project.delivery_outputs` 记录本次要求的交付型 Skill：

```yaml
project:
  delivery_outputs:
    - design_specification
    - design_presentation
```

- 专业模式：两个值都必须存在。`design_specification prepare` 和用户确认发生在 `ux -> visual` 前，`finalize` 发生在双评审后。
- 快速模式：默认可为空；用户可以按需请求一个或两个输出。请求 `design_presentation` 时隐式要求 `design_specification`，因为 PPT 只能读取最终版 `Design.md`。
- 快速模式请求 `design_specification` 后，必须在首次视觉或原型创作前运行 `prepare` 并取得用户确认；不能降级为仅在评审后补写。
- 一旦请求任一输出，采用与专业模式相同的内容和质量门禁，不提供低质量快速文档或 PPT 分支。

## 6. Skill 与注册表契约

`skills/registry.yaml` 新增两个 `kind: deliverable` 条目。现有 manifest 机制扩展为同时覆盖 `flow` 和 `deliverable` 两种会返回 context 补丁的 Skill，并支持同一个 Skill 按 `operation` 使用不同读白名单。评审和 Director 仍不进入 manifest。

### 6.1 design_specification

```yaml
skill: design_specification
operations:
  prepare:
    reads:
      - project
      - users
      - goals
      - brand
      - constraints
      - assumptions
      - decisions
      - exceptions
      - artifacts.brief
      - artifacts.flows
    writes: [artifacts.design_document]
  finalize:
    reads:
      - project
      - users
      - goals
      - brand
      - constraints
      - assumptions
      - decisions
      - exceptions
      - artifacts.brief
      - artifacts.flows
      - artifacts.tokens
      - artifacts.prototype
      - artifacts.design_document
    writes: [artifacts.design_document]
produces:
  - Design.md
required_modes: [professional]
```

两次操作都不得写 `stage`，不得修改 `brief.md`、`flows.md`、`design-tokens.json`、`decisions.md` 或 `prototype/`。Director 通过 `--operation prepare|finalize` 选择 manifest；未传、传错或把一个操作的投影用于另一个操作都必须失败。`prepare` 返回的补丁在用户确认前保持 provisional，不得合并；Director 的 seal 命令只做确定性的元数据更新、重新校验文件哈希并合并该补丁，不承担创作。

`visual_system` 的 reads 增加 `artifacts.design_document`；`html_prototype` 同时读取 `artifacts.design_document`、`artifacts.flows` 和 `artifacts.tokens`。两者的 artifact 补丁必须回写所消费的 `design_contract_digest` 和 `contract_lock_sha256`。

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
  - artifacts.design_document
writes:
  - artifacts.presentation
produces:
  - presentation/design-system.pptx
  - audit/presentation/manifest.json
  - audit/presentation/qa.json
required_modes: [professional]
```

它只接受 `phase: implementation_ready` 且与当前原型版本匹配的 `Design.md`，不得写 `stage` 或修改任何已评审设计产物。渲染图属于 QA 证据，写入 `audit/presentation/rendered/`，不逐项列入静态 `produces`。

### 6.3 调度隔离

`design_specification prepare`、`design_specification finalize` 和 `design_presentation` 每次分别使用全新会话，只收到对应 operation 的 context 投影、source manifest 和允许读取的文件，不继承完整主会话历史。`design_presentation` 依赖最终版 `Design.md`，因此不能与 `finalize` 并行。

Director 是唯一可以把通过门禁的 artifact 补丁合并到 `context.yaml` 并推进 `delivered` 的角色。

## 7. context.yaml 与来源绑定

设计前版经过用户确认并 seal 后，context 条目如下：

```yaml
artifacts:
  design_document:
    path: Design.md
    phase: approved_contract
    artifact_version: "1"
    contract_revision: 1
    contract_digest: "sha256:locked-design-contract"
    contract_source_digest: "sha256:contract-source-bundle"
    sha256: "sha256:design-md"
    updated_by: design_specification
confirmations:
  flows:
    summary: "已确认 flows.md 与 Design.md 设计契约"
    reply: "用户答复原文"
    flows_sha256: "sha256:flows-md"
    design_contract_digest: "sha256:locked-design-contract"
    contract_lock_sha256: "sha256:contract-lock"
```

第二次运行更新同一个 artifact，不创建 `handoff` 副本：

```yaml
artifacts:
  design_document:
    path: Design.md
    phase: implementation_ready
    artifact_version: "2"
    contract_revision: 1
    contract_digest: "sha256:locked-design-contract"
    realizes_prototype_version: "3"
    source_manifest_digest: "sha256:snapshot-manifest"
    source_bundle_digest: "sha256:delivery-source-bundle"
    sha256: "sha256:final-design-md"
    updated_by: design_specification
  presentation:
    path: presentation/design-system.pptx
    artifact_version: "3"
    artifact_revision: 1
    source_manifest_digest: "sha256:snapshot-manifest"
    source_bundle_digest: "sha256:delivery-source-bundle"
    design_document_sha256: "sha256:final-design-md"
    sha256: "sha256:design-system-pptx"
    updated_by: design_presentation
```

`design_document.artifact_version` 是文件每次有效重写的单调版本，设计前版和最终版至少相差一次递增；它不等于 prototype 版本。`contract_revision` 只在冻结契约改变时递增，`finalize` 不得改变它或 `contract_digest`。`realizes_prototype_version` 和 presentation 的 `artifact_version` 必须等于当前 prototype 版本。所有摘要和文件哈希由门禁重算，不能只信 Skill 自报值。

## 8. Design.md 内容契约

`Design.md` 使用 YAML frontmatter 和两个稳定一级部分，兼顾阅读与机器校验。`prepare` 初次写入时 `phase` 为 `proposed_contract`；用户确认且 Director seal 后的设计前版示例为：

```yaml
---
phase: approved_contract
artifact_version: "1"
contract_revision: 1
contract_digest: "sha256:locked-design-contract"
contract_source_digest: "sha256:contract-source-bundle"
platforms: [web, mobile_web]
generated_at: "2026-07-26T12:00:00Z"
---
```

### 8.1 设计契约：设计前冻结

`# 第一部分：设计契约` 在 `prepare` 时完整生成，并固定包含：

1. `目标与边界`：项目目标、实施范围、非目标、目标平台和已知技术栈事实。
2. `用户、任务与成功标准`：主要用户、核心任务和可验证结果。
3. `信息架构与路由`：页面、路由、入口、出口、导航关系和权限前提。
4. `页面规格`：每个页面的目的、内容顺序、组件职责、交互和跳转。
5. `状态规格`：正常、加载、空、错误、成功、禁用、焦点及业务特有状态。
6. `响应式与平台适配`：各目标视口或平台的布局、导航、输入和反馈变化。
7. `组件与内容约束`：组件职责、复用边界、依赖、内容长度和真实内容要求。
8. `视觉目标与品牌约束`：层级、密度、品牌表达、应探索方向和明确禁止模式；不预填尚未产生的 token 值。
9. `内容与资源需求`：需要的图片、图标、字体、动画及其用途和约束，不虚构尚不存在的文件路径。
10. `无障碍与开发验收`：语义、键盘、焦点、名称、对比度、重排、触控目标，以及每个核心流程的前置条件、步骤和预期结果。
11. `决策、假设、例外与边界`：已确认决策、规则引用、假设、例外和待人工验证项。

设计前版不得出现 `# 第二部分：实施规格`、`TBD`、`TODO`、空章节或虚构框架、API、token 值和资源路径。技术栈未知时明确写“技术栈未指定”。页面和核心任务必须与 `flows.md` 闭合。

### 8.2 实施规格：评审后补齐

`finalize` 保持第一部分规范化内容逐字节语义等价，并追加 `# 第二部分：实施规格`：

1. `已选视觉方向`：最终方向、选择依据及与第一部分约束的对应关系。
2. `设计令牌`：实际语义 token、值、用途和禁止误用说明。
3. `组件实施契约`：最终变体、属性、状态、依赖和内容适配规则。
4. `资源清单`：图片、图标、字体和动画的实际路径、用途、裁切及替代文本。
5. `页面与原型映射`：每个页面独立三级标题、`prototype_path`、关键组件和状态实现。
6. `开发验收用例`：逐字引用 `prototype/scenarios.json` 的 flow 名称，覆盖成功与错误路径。
7. `评审、例外与人工验证`：findings 处理、接受的 warning、遗留风险、平台边界和人工检查。

最终 frontmatter 改为 `phase: implementation_ready`，递增 `artifact_version`，增加 `realizes_prototype_version`、`source_manifest_digest` 和 `source_bundle_digest`；`contract_revision` 与 `contract_digest` 保持不变。

### 8.3 Design.md 机器校验

`prepare` 与 seal 检查：

- frontmatter、contract source digest、全部冻结章节和 `flows.md` 页面/任务闭合正确。
- 不含第二部分、占位内容和来源中没有的新页面、组件或业务结论。
- 未确认时文件只能是 `proposed_contract`，artifact 补丁不得合并；不得提前自称 `approved_contract`。
- seal 前后第一部分的规范化 digest 必须一致；Director 记录的用户确认同时绑定 `flows.md` 哈希和 `contract_digest`。
- `contract-lock.json` 由 `director-advance` 的 seal/确认路径在 `ux -> visual` 时生成，且生成时 tokens、prototype、snapshot 和 findings 尚未登记。

`finalize` 检查：

- 第一部分重新计算的 `contract_digest` 与确认记录、lock、tokens、prototype 和快照完全一致。
- 当前 prototype 的每个 HTML 页面都出现在页面映射中，每个成功与错误场景都有验收用例。
- 文档引用的 token 名称存在于 `design-tokens.json`，本地资源路径存在且不越出交付包。
- findings、warning 处理、人工验证项和当前 prototype 版本闭合。
- 不含 `TBD`、`TODO`、空章节、未解释假设或源文件中没有的新设计决策。

页面、flow、token、asset、decision 和 finding 标识采用集合闭合作为机器门；语义层面的新决策风险由 Director 最终检查。发现新决策时 `finalize` 必须停止并触发第 13 章回退，不能直接写入第二部分。

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

Director 的逐页复核证据单独写入 `audit/presentation/director-review.json`，记录 PPTX SHA-256、已查看页码和 findings。结构检查脚本不能创建或修改该文件，只负责验证它与最终 PPTX 和完整页码集合一致。

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

1. `requirements_research` 生成 `brief.md`，`ux_architecture` 生成 `flows.md`。
2. Director 生成并冻结 `audit/design/contract-source.json`，为 `design_specification prepare` 生成只读 context 投影。
3. `prepare` 生成 `phase: proposed_contract` 的 `Design.md` 和 provisional patch；内容闭合检查通过后仍不得合并到 context。
4. 专业模式确认门 B 同时呈现 `flows.md` 与 `Design.md`；快速模式请求该输出时使用同一确认门。Director 记录用户原文，seal 文件为 `approved_contract`，合并 artifact 补丁并生成 `audit/design/contract-lock.json`。
5. Director 才允许进入 Visual 或 Prototype。`visual_system` 与 `html_prototype` 读取 `Design.md`，各自产物绑定 `contract_digest` 和 contract lock 哈希。
6. 原型完成后运行现有浏览器检查、截图迭代、快照和双评审；快照保存设计前版 `Design.md`。
7. Director 确认当前版本 blocker 清零、warning 已处理且快照无漂移，生成并冻结 `audit/delivery/source-manifest.json`。
8. `design_specification finalize` 在新会话中补齐第二部分，重算第一部分 digest，检查与全部下游产物闭合后更新同一个 artifact。
9. `design_presentation` 在另一新会话中读取 `phase: implementation_ready` 的 `Design.md`，生成 PPTX、结构 manifest 和逐页 QA。
10. Director 独立逐页查看 PPT 渲染图，重新计算来源摘要与文件哈希并合并 presentation 补丁。
11. `acceptance.mjs` 汇总现有门禁、前置契约、最终开发文档和 PPT 三个新增维度。
12. 所有强制输出通过后，Director 才执行 `review -> delivered`。

快速模式未请求 `design_specification` 或 `design_presentation` 时省略相应步骤；请求 PPT 时不得省略 Design.md 的两次运行。

## 12. 验收门

新增三个独立维度：

- `设计前契约`：`prepare` 提案、用户确认、Director seal、contract lock、阶段顺序以及 Visual/Prototype digest 绑定均通过。
- `开发交接文档`：`finalize` 后冻结部分未漂移，页面、场景、token、资源、决策和 findings 闭合，当前原型版本、来源和文件哈希均通过。
- `设计方案演示`：存在性、章节覆盖、原生可编辑性、来源、结构和逐页 QA 均通过。

专业模式中任一强制步骤或文件缺失、过期、被篡改或 QA 失败，验收返回 fail。快速模式只对 `project.delivery_outputs` 中声明或隐式依赖的输出启用同样门禁。

`ux -> visual` 和任何快速模式的首次 `-> prototype` 转换必须 fail-closed：当本包要求 `design_specification` 时，没有有效 contract lock 不得转换。`visual_system`、`html_prototype` 的补丁若缺绑定、绑定旧契约或读取了 `implementation_ready` 之外的不适用状态，diff 门直接拒绝。最终验收同时验证 contract lock 早于下游 artifact 注册；仅在评审后补造完整 `Design.md` 不能通过。

如果 PPTX 已生成但渲染能力不可用，`设计方案演示` 返回 unverified，交付包保持 `review` 并标记待人工验证；不能进入 `delivered`。如果 adapter 连可编辑 PPTX 都无法生成，直接返回 fail，不提供格式降级。

## 13. 变更与错误处理

- `prepare` 发现 brief 与 flows 冲突时停止生成，由 Director 返回 research 或 ux 修正，不得替用户补造业务决策。
- Visual、Prototype、评审或 `finalize` 发现需要改变冻结契约时，必须调用受控回退命令；不允许直接编辑 `context.stage`、confirmation、contract lock 或 `Design.md` 后继续。
- 受控命令接收 `--from design_contract --reason <原因>`，把旧 `contract_revision`、digest、原因、受影响 artifact 路径与哈希写入 `audit/revisions/contract-<旧>-to-<新>.json`，将 tokens、prototype、results、snapshots、findings、最终 Design.md 和 presentation 登记为 stale，并把阶段退回 `ux`。旧文件保留供审计，不静默删除。
- 更新后的 `Design.md` 递增 `contract_revision` 和 `artifact_version`，重新取得用户确认并生成新 contract lock。只有重跑 Visual、Prototype、浏览器检查、快照和双评审后，stale 标记才可由新版本 artifact 替代。
- `finalize` 只发现实施信息缺失但不影响冻结契约时可以停止并要求补齐上游证据；不能用无来源文案绕过闭合检查。
- 源 manifest 在生成期间变化时丢弃输出，不能把旧输出登记到新版本。
- 仅修正第二部分措辞或 PPT 排版且没有新增设计事实时，可以在同一契约与 prototype 版本重新生成；`Design.md` 必须递增 `artifact_version`，PPT 必须递增 `artifact_revision`，并重新运行对应 QA、更新文件哈希和依赖绑定。
- 在验收前手工编辑 PPTX 会使哈希和 QA 绑定失效，必须重新检查；`delivered` 后复制出的下游版本不再代表本交付包的审计结论。
- 生成器不可用、字体缺失、图片损坏、输出无法重读或渲染时，报告具体能力和文件位置，不得静默删页或栅格化绕过。

## 14. 历史包迁移

新增契约与交付门由新的包格式版本启用。历史已处于 `delivered` 的包不因缺少 `Design.md` 或 PPT 被追溯判错，也不能声称历史设计受前置 `Design.md` 指导。

历史包若要迁移为新契约，必须显式补写 `project.delivery_outputs`，回到 ux，从现有 brief/flows 生成并确认设计前版 `Design.md`，再重跑 Visual、Prototype、浏览器检查、快照、双评审、`finalize` 和 PPT。不能根据旧原型反向补文档后沿用旧 verdict，也不能把仅供阅读的后补 handoff 标记为本规范的 `implementation_ready`。

## 15. 测试策略

### 15.1 注册表、operation 与 diff 门

- 两个 deliverable id、目录和 manifest 一一对应。
- `design_specification prepare|finalize` 各自投影视图只包含对应 reads；缺 operation、未知 operation 或交叉复用投影必须失败。
- 两个操作的合法补丁都只能更新 `artifacts.design_document`。`prepare` 补丁在确认前必须保持 provisional；可登记的 phase 只能是 seal 后首次 `approved_contract`，或同一契约的 `approved_contract -> implementation_ready`。
- 修改 `stage`、prototype、tokens、decisions 或另一个交付 artifact 必须失败。
- `visual_system` 和 `html_prototype` 缺少、伪造或使用旧 `design_contract_digest` / `contract_lock_sha256` 必须失败。

### 15.2 模式与版本

- 新专业模式包缺任一前置或最终交付物必须失败。
- 快速模式未请求时允许缺失；请求 Design.md 后缺前置确认或最终补齐必须失败，请求 PPT 后同时要求完整 Design.md 生命周期。
- `artifact_version`、`contract_revision`、contract digest、contract lock、prototype version、snapshot digest、source bundle digest、文件哈希任一错配必须失败。
- 修改契约后未使旧 tokens、prototype、results、snapshot、findings、final Design.md 或 PPT 失效必须失败。
- 生成期间源快照漂移必须拒绝登记。
- 旧包迁移提示不追溯撤销历史 delivered 结论，但后补文件不得伪造“设计前已存在”。

### 15.3 Design.md

- `prepare` 正向夹具覆盖 flows 中全部页面、流程、状态、响应式规则、组件职责、内容约束、无障碍和验收标准；seal 只改变允许的 frontmatter 字段且保持 contract digest。
- 缺任一冻结章节、加入第二部分、出现 `TBD`/`TODO`、虚构页面/token/asset 或未与 flows 闭合必须失败。
- 未确认就合并 provisional patch、提案提前标记 approved、seal 改动第一部分或没有用户原文必须失败。
- 在 tokens/prototype 已登记后补造 contract lock，或在没有确认绑定时开始 Visual/Prototype，必须失败。
- `finalize` 正向夹具覆盖当前全部页面、成功/错误场景、token、asset、decision 和 finding。
- 分别删除实施章节、页面、错误路径、token、资源、warning 处理或人工验证项时必须失败。
- 修改第一部分文字但保留旧 digest、重新计算 digest 却不递增 contract revision，或沿用旧下游产物必须失败。
- 第二部分出现越界路径、虚构组件、虚构业务结论或新设计决策必须失败。

### 15.4 回退与顺序

- 受控回退保留旧 artifact 证据、记录原因、递增 contract revision 并把所有下游登记标记 stale。
- 直接后退 stage、只替换 `Design.md`、漏标任一下游 artifact 或未重新确认必须失败。
- 新契约下重跑完整链后可以通过；任何旧 digest 的结果、截图、快照或 findings 混入必须失败。
- 快速模式请求 Design.md 时，contract lock 必须位于首次创作前；未请求时不应被新增门误伤。

### 15.5 PPTX

- 正向夹具包含可编辑文本、色板、表格、截图、notes、manifest 和全部渲染页。
- 缺叙事角色、缺来源、slide/render 数不一致必须失败。
- 内容页整页图片化、空占位符、对象数量自报不符必须失败。
- 重叠、裁切、溢出、标题异常换行和字体替代必须失败或按明确人工项返回 unverified。
- QA 绑定旧 PPTX SHA 或渲染图被替换必须失败。
- PPT 读取 `approved_contract`、旧 prototype 版本或旧 final Design.md SHA 必须失败。

## 16. 文档与完成定义

实现时同步更新：

- `skills/design-director/SKILL.md`：在 `ux -> visual` 前增加 Design.md prepare/确认/lock，在 review 与 delivered 之间增加 finalize 和 PPT 调度，并定义受控回退。
- 新增 `design-specification`、`design-presentation` Skill，更新 `visual-system` 与 `html-prototype` 的必读输入和绑定责任。
- `skills/registry.yaml`、manifest schema 与 manifest 清单：支持 deliverable 与 operation 级投影/diff 门。
- `schemas/context.schema.json`、初始化参数、确认记录和包格式版本。
- `scripts/env-check.mjs`、contract source/lock、Design.md 双阶段检查、受控回退、交付物检查与 `scripts/acceptance.mjs`。
- `docs/usage.md` 的阶段说明、命令和交付包目录树。
- 原系统设计规范中“PPT 不进入第一版”的范围声明，明确本能力从新快照版本起生效。
- 已提交的 `docs/superpowers/plans/2026-07-26-delivery-artifacts.md` 基于“评审后才生成 Design.md”的旧架构，书面规格获用户复核后必须整体重写，不得直接执行。

完成必须同时满足：

- 新的注册表、schema、diff 门、模式和迁移测试通过。
- `Design.md` 设计前契约、顺序证明、下游绑定、最终补齐和受控回退的正向与对抗测试通过。
- 可编辑 PPTX 的创建、重读、逐页渲染和对抗夹具测试通过。
- `npm run check`、`npm test`、`npm run validate:rules` 通过。
- 使用一个新的专业模式示例包实际走完 `prepare -> confirm -> visual -> prototype -> review -> finalize -> presentation`，生成两份文件并由 `acceptance.mjs` 判定通过。
