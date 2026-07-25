# UI/UX 规范库分层扩展设计

日期：2026-07-25
状态：已完成对话确认，待书面复核

## 1. 背景

当前依据库已有 107 条规则，覆盖 WCAG 2.2 AA 关键条款、Web、Apple HIG、
Material Design 3、微信小程序、通用设计工艺，以及电商和 SaaS B2B 两个行业包。
现有结构已经能保证规则卡 schema、来源追溯、目标平台覆盖矩阵和行业包激活，
但继续扩展时会遇到三个问题：

1. `evidence/rules/*.yaml` 除行业文件外默认按平台全部激活。直接加入 Ant Design、
   Carbon、Fluent 等规则，会让同一项目同时承担多套互相冲突的栅格、字体、间距、
   圆角和组件规则。
2. 当前 WCAG 文件只有常用关键条款，没有一份逐成功准则的完整性索引，不能证明
   WCAG 2.2 A/AA 是完整覆盖、明确不适用，还是仍有遗漏。
3. 评审读取当前仓库中的规则。规则库在快照之后升级时，旧 findings 可能因适用规则
   集变化而失效，无法证明当时到底按哪一版规则审计。

本次扩展先解决规则激活、规范完整性和版本绑定，再加入首批高价值规则包。目标不是
收集尽可能多的设计系统，而是让每条新增规范能参与生成、被审计、可追溯且不会与
其他规则无条件混用。

## 2. 目标与非目标

### 2.1 目标

- 建立“通用底线 + 目标平台 + 行业 + 单一主参考系统 + 工艺启发”的分层规则模型。
- 保持 WCAG、平台硬性要求的优先级，不允许品牌设计系统覆盖无障碍底线。
- 用机器可读索引证明 WCAG 2.2 A/AA 每个成功准则的处理状态。
- 首批加入内容设计、认知无障碍、国际化、Ant Design 和 Carbon 的高价值规则。
- 让 Visual System、HTML Prototype、Decision Record、Standards Audit 和 Acceptance
  消费同一份已激活规则集合。
- 把评审规则集合冻结进版本化快照，保证历史交付物的审计依据可复查。
- 对规则包结构、激活条件、来源域名、冲突和覆盖矩阵增加正向与对抗性测试。

### 2.2 非目标

- 不复制 Ant、Carbon 或其他系统的完整组件代码和生产实现。
- 不把任何品牌系统的固定数值设为所有项目的通用硬规则。
- 首批不加入 Fluent、Atlassian、Polaris、Fusion、Fiori、Spectrum 等后续候选包。
- 不承诺 HTML 原型能够验证 iOS、Android 或小程序的真实原生行为。
- 不以规则数量作为质量指标；无可执行结论或无可靠来源的内容不进入规则卡。
- 不把 Tailwind、Bootstrap、shadcn/ui、Dribbble、Awwwards 等实现库或灵感集合当作
  权威设计规范。

## 3. 方案比较

### 3.1 方案 A：所有规则按平台全局激活

实现最简单，新增 YAML 即可进入覆盖矩阵。但 Ant、Carbon 和 Material 的具体设计语言
会同时约束 Web 项目，产生不可解释的冲突，也会让评审工作量随规则库总量无限增长。

结论：不采用。

### 3.2 方案 B：只抽取跨系统共同原则

将各设计系统归纳为布局、字体、色彩、间距和组件等通用启发，不保留来源系统身份。
冲突较少，但会丢失企业后台、数据密集界面等成体系的组件关系，也无法回答“本项目
选择 Ant 作为主参考后，是否一致执行”。

结论：保留为 `design-craft` 的补充方式，不作为主架构。

### 3.3 方案 C：分层规则包，单一主参考系统

基础和平台规范始终按目标平台激活；行业包按 `industry` 激活；每个项目至多选择一个
主参考系统。规则包保留来源身份，但其固定数值只在被选择时进入生成和评审。

结论：采用。该方案延续当前行业包的按需激活模式，同时阻止多套设计语言无条件混用。

## 4. 分层规则模型

规则裁决顺序沿用主规范第 10 章，并把新增规则包映射到现有证据层级：

1. 法律、安全和 WCAG 硬性无障碍要求。
2. 目标平台官方规范：Web、Apple HIG、Material 3、微信小程序。
3. 当前项目中已核实的用户任务与研究证据。
4. 已确认的品牌要求。
5. 当前项目明确选定的主参考系统。
6. 已激活的行业研究与成熟可用性原则。
7. 设计工艺与趋势启发。

`required` 规则仍只能被更高优先层豁免。Ant、Carbon 等非平台级设计系统的规则只允许
使用 `recommended` 或 `heuristic`，不能声明为全局 `required`。若主参考系统与品牌或
已核实项目证据冲突，按现有机制写入 `exceptions` 和 `decisions.md`。

## 5. 规则包注册表

新增 `evidence/rule-packs.yaml`，并用新的 `rule-pack.schema.json` 校验。规则卡 schema
保持不变；激活逻辑属于规则包，而不是重复写入每张规则卡。

注册表结构：

```yaml
packs:
  - id: system-ant-design
    kind: reference_system
    files: [system-ant-design.yaml]
    activation:
      type: reference_system
      values: [ant_design]
    allowed_source_hosts: [ant.design]
    dimensions:
      layout: covered
      typography: covered
      color: covered
      spacing: covered
      components: covered
      interaction: covered
      content: covered
      accessibility: covered
```

`kind` 允许：

- `foundation`：基础规范，按规则卡平台字段过滤后始终激活。
- `platform`：目标平台官方规则，仍由 `platforms` 过滤。
- `industry`：与 `context.project.industry` 精确匹配时激活。
- `reference_system`：与 `context.project.reference_system` 精确匹配时激活。
- `craft`：通用工艺启发，按平台字段激活。

机器门必须保证：

- `evidence/rules/` 中每个 YAML 文件恰好属于一个规则包。
- 规则包 ID、文件和激活值唯一；不存在的文件、重复归属和空包均失败。
- `allowed_source_hosts` 非空，包内每张卡的 `source_url` host 必须在白名单内。
- `reference_system` 包不得含 `strength: required`。
- 主参考系统包必须逐项声明布局、字体、色彩、间距、组件、交互、内容和无障碍八个
  维度为 `covered` 或 `not_applicable`；后者必须附理由。
- `conflicts_with` 仍须解析到存在的规则；两个已激活规则互相冲突且没有已记录例外时，
  验收失败。

## 6. 项目上下文与激活

`context.project` 新增必填字段：

```yaml
project:
  reference_system: none | ant_design | carbon
```

第一批只开放 `none`、`ant_design` 和 `carbon`。新系统只有在对应规则包、来源、测试和
文档全部齐备后才扩充枚举。每个项目只能选择一个主参考系统；跨系统比较发生在视觉
方向阶段，最终交付不能同时激活两个系统。

`init-project.mjs` 新增 `--reference-system`，默认 `none`。现有 context 需要补写
`reference_system: none` 后才能通过新版 schema；本项目已有门禁升级后拒绝旧产物的
惯例，因此不保留静默兼容分支。

激活顺序由共享函数 `applicableRules(project, rules, packs)` 统一计算：

1. 先按规则包的 `activation` 判断包是否激活。
2. 再按规则卡 `platforms` 与 `project.platforms` 求交集。
3. 返回规则 ID、来源文件、规则包 ID 和规则卡规范化哈希。

`record-findings.mjs`、`acceptance.mjs` 和测试不得各自重新实现筛选逻辑。未激活的
参考系统规则不进入覆盖矩阵，也不得在专业模式的 `decisions.md` 中冒充当前设计依据。

## 7. 首批规则内容

### 7.1 WCAG 2.2 A/AA 完整性

保留现有稳定规则 ID，在 `wcag-2.2-aa.yaml` 中补充缺失的 A/AA 成功准则。新增
`evidence/coverage/wcag-2.2-aa.yaml`，逐条列出 W3C 官方 Quick Reference 中 A/AA
成功准则，并记录：

```yaml
- criterion: "2.5.1"
  status: covered | outside_runtime
  rule_ids: [wcag-2.5.1-pointer-gestures]
  rationale: string
```

`covered` 至少绑定一个存在的规则 ID；`outside_runtime` 必须解释为何超出 HTML 原型
设计与验证范围。覆盖索引不得出现 `pending`，否则 `npm run check` 失败。没有视频、
音频或特定交互的项目仍需在 standards `rule_coverage` 中用 `not_applicable` 写明证据，
不能因为常见项目不使用该功能而从依据库删除对应准则。

### 7.2 WAI-ARIA APG 组件模式

新增 `web-aria-patterns.yaml`，首批覆盖 tabs、combobox、menu/menu button、tooltip、
accordion、tree/treegrid、grid、carousel 和 disclosure。已有 dialog、landmark、table 等
规则保留原 ID，不迁移文件，避免破坏历史引用。

APG 模式规则以原生 HTML 优先为前提。只有业务确实需要复合控件时才适用；普通导航、
列表或输入框不得为了命中规则而升级成复杂 ARIA widget。

### 7.3 内容、认知无障碍与国际化

新增 `foundation-content-i18n.yaml`，官方来源限定为 W3C COGA、W3C Internationalization、
GOV.UK Design System、USWDS 和 Microsoft Inclusive Design。首批至少覆盖：

- 动作标签具体且结果可预期。
- 说明在操作前出现，错误信息指出问题和恢复方法。
- 页面、步骤和帮助入口保持一致。
- 减少短期记忆负担和不必要的重复输入。
- 日期、时间、数字、货币和地址按 locale 表达。
- 中文断行、中西文混排、长文本扩展和无空格语言不破版。
- RTL 镜像、阅读顺序和方向性图标正确处理。
- 不依赖专业术语、颜色或位置描述才能理解任务。

这些规则是基础包，但按具体内容使用 `not_applicable`，不要求每个原型伪造多语言页面。

### 7.4 Ant Design 主参考包

新增 `system-ant-design.yaml`，只在 `reference_system=ant_design` 时激活。官方来源限定
`ant.design`，首批覆盖：

- 24 栅格、页面框架、对齐、间距和响应式布局原则。
- 中文与西文字体层级、正文可读性、数字和数据场景排版。
- 主色生成、功能色、语义色、中性色和对比关系。
- 信息层级、操作优先级、导航、表单、反馈和异常状态。
- 数据表、筛选、批量操作和高密度企业后台模式。
- 令牌内部一致性，而不是无条件复制 Ant 默认蓝或默认圆角。

具体数值只有在 Ant 被选为主参考且不与品牌/WCAG冲突时才是 `recommended`；否则只
保留为 `heuristic` 起点。

### 7.5 Carbon 主参考包

新增 `system-carbon.yaml`，只在 `reference_system=carbon` 时激活。官方来源限定为
`carbondesignsystem.com`；新增其他来源域名前必须在注册表中逐项登记并完成在线核实。
首批覆盖：

- 2x Grid、断点、页面壳层和数据密集布局。
- Type Set、文本角色、行长和层级关系。
- 语义色、主题、层级、边框与状态色。
- Spacing、组件密度、层次和一致的交互状态。
- 数据表、数据可视化、图例、色彩冗余编码和数值可读性。
- 企业应用中的批量操作、渐进披露、空态、加载和错误恢复。

Carbon 的具体 token 同样只在该包激活时作为推荐值，不覆盖品牌和无障碍规则。

## 8. 生成与评审闭环

### 8.1 需求与视觉阶段

- Design Director 在 intake 记录 `reference_system`；无明确需要时使用 `none`。
- Requirements Research 核实该系统是否适合目标用户、平台和行业，并在 `brief.md`
  说明适用范围；不能仅因为用户提到某品牌就推断为完整采用。
- Visual System 在生成视觉方向前读取激活规则，方向方案必须说明哪些 token 来自主
  参考系统、哪些由品牌覆盖。
- HTML Prototype 只消费选定系统的规则，不加载其他系统规则作为隐式要求。

### 8.2 决策记录

专业模式选择非 `none` 主参考系统时，`decisions.md` 至少有一条 `[rule:<id>]` 引用该
系统包，并说明选择理由。规则包已激活但零引用，验收失败。引用未激活系统的规则也
失败，除非该条仅出现在显式比较记录且不进入 `context.decisions[].rule_ids`。

### 8.3 冻结规则快照

`snapshot.mjs` 在 `audit/snapshots/<artifact_version>/rules/` 写入：

- 激活规则卡的只读副本。
- `rules-manifest.json`：规则包 ID、规则 ID、来源文件、规范化 sha256、生成时间。
- `review-scope.yaml`：目标平台、行业、主参考系统和激活规则 ID。

Standards Audit 只读取冻结快照中的原型和规则，不读取仓库当前规则。`record-findings`
和 acceptance 必须以 `rules-manifest.json` 的规则集合校验 `rule_coverage`。规则库升级
不会追溯改变旧快照的适用规则集；原型修改或主动升级规则集都必须创建新
`artifact_version` 并重新评审。

### 8.4 验收

最终验收新增三项：

- `规则包激活`：context、注册表、激活规则和快照 manifest 一致。
- `主参考系统依据`：选定系统包至少一条规则实际参与设计决策。
- `规范版本绑定`：findings 的覆盖集合与冻结规则 manifest 完全一致，无缺失、额外
  或哈希漂移。

## 9. 失败与降级处理

- context 引用未知主参考系统：schema 失败，不自动回退。
- 注册表引用缺失文件、空包、重复文件或非法来源 host：`npm run check` 失败。
- 选定规则包存在但无法加载：任务失败，不标记为 `none`。
- 官方来源暂时不可访问：离线校验仍检查 URL 结构和 `last_verified`；在线来源检查记
  `unverified`，不得伪造新的核实日期。
- 激活规则互相声明冲突：必须在 `decisions`/`exceptions` 记录裁决，否则验收失败。
- 浏览器无法验证的原生行为：继续使用 `intent_only` 和 native checklist，不因新增
  规则包改变现有诚实降级边界。
- 规则快照缺失或哈希不一致：当前版本 findings 无效，必须重新 snapshot 和双评审。

## 10. 测试设计

### 10.1 规则包与 schema

- 正向：所有规则文件恰好归属一个包，激活条件和来源 host 合法。
- 反例：重复归属、幽灵文件、空包、未知激活值、空来源白名单。
- 反例：Ant/Carbon 包出现 `required`、来源指向博客或其他非白名单 host。
- 反例：主参考包八维覆盖缺项，或 `not_applicable` 没有理由。

### 10.2 激活矩阵

- `none` 不激活 Ant/Carbon；`ant_design` 只激活 Ant；`carbon` 只激活 Carbon。
- 平台、行业与主参考系统同时过滤正确，行业下划线归一逻辑保持兼容。
- 未激活规则不要求进入 coverage；已激活规则缺一条即失败。
- 引用未激活系统规则、激活系统零决策引用均失败。

### 10.3 WCAG 完整性

- 官方 A/AA 准则索引每项都有唯一记录。
- `covered` 的 `rule_ids` 全部存在；`outside_runtime` 理由非空；`pending` 被拒绝。
- 新规则维持全库 ID 唯一和冲突引用可解析。

### 10.4 快照绑定

- 快照包含激活规则副本、manifest 和 review scope，哈希可复算。
- 快照后修改仓库规则不会改变旧快照的适用集。
- 篡改快照规则、额外 coverage、遗漏 coverage 和跨版本 findings 全部被拒绝。
- 修改原型或升级规则集后必须提升 `artifact_version`。

### 10.5 完整验证

提交前运行：

```bash
npm run check
npm test
npm run validate:rules
```

规则来源在线抽查单独运行，网络不可用必须报告为未验证，不能用静态校验冒充可达性。

## 11. 实施顺序

1. 增加规则包 schema、注册表、共享激活函数和 context 字段。
2. 把现有 8 个规则文件登记到规则包注册表，保证现有选择行为不变。
3. 增加规则快照 manifest 与评审绑定，消除规则库升级造成的历史漂移。
4. 建立 WCAG 2.2 A/AA 完整性索引并补齐缺失规则。
5. 增加 WAI-ARIA APG 与内容/认知/国际化基础规则。
6. 增加 Ant Design 和 Carbon 两个可选主参考包。
7. 同步 Director、Research、Visual、Prototype、Decision、Standards Skill 文案。
8. 更新 README 和主设计规范，以新门禁版本记录此次扩展。
9. 跑完整测试和至少一个 `reference_system=ant_design`、一个 `carbon`、一个 `none`
   的交付包激活冒烟验证。

## 12. 完成标准

- 规则包注册表、schema、激活逻辑和对抗性测试全部通过。
- 现有 107 条规则全部被明确归包，稳定 ID 不变。
- WCAG 2.2 A/AA 完整性索引无 `pending`，每项可追溯到规则或明确范围边界。
- Ant 与 Carbon 规则只在各自被选中时进入生成、快照、评审和验收。
- 内容、认知和国际化规则成为 Web/移动 Web 基础适用集。
- 规则快照和 findings 绑定当前 `artifact_version`，规则库后续升级不污染历史结论。
- 规则包选中但未参与决策、来源不可信、覆盖缺失和冲突未裁决均会被机器门拒绝。
- `npm run check`、`npm test`、`npm run validate:rules` 全部通过。
- 文档明确声明：规则覆盖和自动检查提高设计下限，但不单独证明视觉水准或真实原生
  平台合规。
