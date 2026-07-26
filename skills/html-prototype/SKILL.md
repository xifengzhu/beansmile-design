---
name: html-prototype
id: html_prototype
description: 根据已确认的用户流与视觉系统生成可点击高保真响应式 HTML，覆盖核心流程、交互反馈与关键状态，使用语义 HTML、可见焦点、键盘操作与可访问名称。对应设计规范第 7.5 章。产出 prototype/index.html。
---

# HTML 原型 Skill

## 知识库（写代码前必读）

- `references/component-patterns.md`：全局基线 CSS、按钮/表单/卡片/导航/表格/状态/弹层/微交互的工艺基准（专业与业余的分界线）。
- `references/polish-checklist.md`：截图自评清单（对齐/层级/色彩/排版/状态/内容/响应式/手感）。
- `references/assets-guide.md`：图标（单一图标集+内联 SVG）、字体（标题层按搭配库升级）、图像（CSS/SVG 生成工艺配方）与许可记录。
- `../visual-system/references/playbooks/<选定方向>.md`（如 `playbooks/D3.md`）+ `playbooks/_intro.md`：**只读选定方向的分章手册**（规范 27.7，不通读 8 个方向）——首屏构成、关键手法配方、敷衍 vs 到位判别；关键手法至少落地 2 处且在首屏。
- `../visual-system/references/layout-composition.md`：首屏构成模式、留白节奏、视觉记忆点菜单（≥2 处）、构成自查清单。
- 上游令牌：只消费 `design-tokens.json` 的语义层变量；出现档位外魔法数字（px/hex）视为未完成。

## 执行竞争（专业模式强制，验收「执行竞争」维度机器判定）

同一个已确认的方向，**先出 2–3 个候选执行版本，赢家才有资格进入全量开发**。竞争的是构成层（layout-composition.md 的首屏模式 × playbook 的手法组合），不是换颜色——令牌保持一致。

1. 在 `audit/candidates/cand-1/`、`cand-2/`（可选 `cand-3/`）各放一个**关键页**（通常是首页/核心任务页）的完整 HTML：各候选取**不同的首屏构成模式**，各自落地本方向 ≥2 个关键手法。不许做一个认真的和两个陪跑的——每个候选都是你当时认为可能最好的做法。
2. 运行 `node scripts/screenshot.mjs --package <目录> --candidates`（375/1440 双视口，截图落在各候选目录）。
3. **Read 全部候选截图并排对比**，按 playbook 的"敷衍 vs 到位"与 layout-composition.md §7 构成自查逐个评语。
4. 把逐候选评语（引用 `cand-N/<截图名>` 限定路径）、`chosen: cand-N` 与选择理由写入 `audit/candidates/selection.md`。
5. 以赢家为底建 `prototype/`，再进入下方迭代循环。落选候选保留在原目录（验收要查）。

验收判定：候选 ≥2、各有 HTML+截图、selection.md ≥100 字符且以限定路径引用每个候选的截图、`chosen` 指向存在的候选。浏览器不可用时此维度记"未验证"（6.2 降级）。

## 截图-自评-迭代循环（强制，验收机器判定，不迭代过不了验收）

1. 首版完成后运行 `node scripts/screenshot.mjs --package <目录> --round 1`（375/768/1440 三视口截图到 `audit/iterations/round-1/`，同时自动写 `meta.json` 记录当轮原型指纹）。**首轮必须全量**。
2. **Read 每张截图**，对照 `references/polish-checklist.md` 逐节自评，列出命中项与修法（C/D 类"廉价感"问题必须正面检查，不许只挑硬伤）。
3. 修改后 `--round 2 --incremental` 再截再评（规范 27.3）：只重截相对上一轮有变更的页面，未变页自动记 carried 并链到实拍轮——**只 Read 本轮新截的图**，carried 页上一轮已看过。`assets/` 或 `design-tokens.json` 有改动会自动转全量（共享样式全局生效）；零变更会被拒绝（空轮不构成迭代）。**至少完成 2 轮**；直到一轮零新增命中才可交回 Director 进评审。
4. 每轮在 `audit/iterations/round-N/notes.md` 记录：命中项、修复动作，并**引用当轮实际新截的截图文件名**（carried 图不算当轮证据）。
5. **收官轮必须去掉 `--incremental` 全量重截**——验收核对首末轮全量与末轮同源。
6. 浏览器不可用时（6.2 降级）：跳过截图但仍按清单做代码级自评，并在 assumptions 记录"视觉未经渲染验证"。
7. 验收（18.2「迭代自评」维度）机器判定：轮数 ≥2；每轮非空 notes.md（≥50 字符且引用当轮新截图）+ meta.json；carried 页三方哈希链一致（当前轮/引用轮/记录）且引用轮实拍图在盘；首末轮全量；**末轮 `page_hashes` 必须与交付原型一致**——截完图再改代码而不复评一轮，或谎称"未变更"跳过重截，验收直接 fail。

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `users`, `goals`, `brand`, `constraints`, `artifacts.flows`, `artifacts.tokens`
- writes: `artifacts.prototype`, `assumptions`, `stage`
- produces: `prototype/index.html`, `prototype/scenarios.json`

## 核心任务场景（prototype/scenarios.json，验收机器执行）

原型不只是"能看"，要"能被证明可用"。按 flows.md 的核心任务写可执行场景，browser-check 会用 Playwright 逐步执行并断言：

- 至少 1 个 `kind: success`（核心任务成功路径：填写 → 提交 → 断言成功态出现）和 1 个 `kind: error`（错误路径：漏填/错填 → 断言错误提示出现，wcag-3.3.1）。
- 每个场景 `{ id, name, kind, flow, page, steps }`；`flow` 必须逐字引用 flows.md 中的核心任务名（≥4 个实义字符，规范 24.3/27.11）——场景证明的是 IA 文档里真实存在的任务，不许自造场景自证可用。
- step 动作：`fill{selector,value}` / `click{selector}` / `press{key}` / `expect_visible{selector}` / `expect_hidden{selector}` / `expect_text{selector,text}`。每个场景至少一步 `expect_*` 断言（跑完不验证等于没跑）+ 至少一步交互（fill/click/press，零交互只是加载检查）。
- 断言目标禁止 `body`/`html`/`*`/`:root` 与裸标签选择器（`main`/`section`…在静态页恒真）——必须带 `#id`/`.class`/`[attr]` 定位到具体组件（规范 27.11）。优先 id / aria 属性，别依赖易变的 class 链。
- **断言必须由交互建立**（规范 27.11）：browser-check 会先在初始状态求值全部 `expect_*`，若不做任何交互就全部成立，该场景判废——成功/错误信号必须是交互的结果（初始 hidden，提交后出现）。
- **交互期不许抛错**（规范 27.11）：场景执行中的 JS 异常、console error、资源加载失败都会被捕获——既让该场景失败，也计入控制台错误阻断信号。
- 场景失败 = browser-check 阻断信号 = 验收 fail。写场景时自己先跑一遍 `node scripts/browser-check.mjs`。

## 职责

- 生成可真实点击完成核心任务的高保真 HTML，套用 `design-tokens.json`。
- 覆盖核心流程、交互反馈与关键状态：正常/空/加载/错误/成功/禁用/焦点。
- 支持目标视口与必要的响应式重排；使用稳定尺寸约束，避免动态内容造成跳动、遮挡或溢出。
- 使用语义 HTML、可见焦点、键盘操作、可访问名称。

## 硬性约束（依据库，写代码时逐条落实）

- `web-native-html-first` 原生元素优先；`web-landmark-regions` 地标划分，单页一个 main。
- `web-form-label-association` 表单标签编程关联；`wcag-3.3.1/3.3.2/3.3.3` 错误标识/标签说明/纠错建议。
- `wcag-2.1.1/2.1.2/2.4.3/2.4.7` 键盘可达、无陷阱、焦点顺序、焦点可见；`web-modal-focus-management` 模态焦点管理。
- `wcag-2.5.8-target-size-minimum` 触控目标≥24×24；`wcag-1.4.10-reflow` 320px 无横向滚动。
- `web-viewport-meta-scalable` 不禁用缩放；`web-page-lang-title` html lang + 描述性 title。
- `web-reduced-motion` 尊重 prefers-reduced-motion。
- 使用接近真实长度的内容 + 极端内容（长标题、大字号、空数据）。

## 组织（规范 13）

- 单平台单流程：仅 `prototype/index.html`。
- 多平台/多流程：`prototype/index.html` 作总入口索引 `prototype/<platform>/<flow>.html`。
- **多页共享样式必须抽取**（规范 27.2）：≥2 页时把共享 CSS 抽到 `prototype/assets/styles.css` 并由每页 `<link>` 引入；同一份 ≥2KB 样式块内联进 ≥2 页会被验收「共享样式」维度判 fail。页面私有小段样式（<2KB）可保留内联。写完跑 `node scripts/lint-prototype.mjs --package <目录>` 自检（候选目录豁免——候选阶段单文件自包含合法）。
- 核心流程不得依赖未说明的私有服务，须可按 README 本地打开。

## 输出契约

- 文件 `prototype/index.html`（及必要的 `prototype/assets/`、分平台页面）。
- 补丁：登记 `artifacts.prototype`（`path` + 单调递增 `artifact_version`），临时假设写入 `assumptions`，`stage` 推进到 `prototype`。
