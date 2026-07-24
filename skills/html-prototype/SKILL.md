---
name: html-prototype
id: html_prototype
description: 根据已确认的用户流与视觉系统生成可点击高保真响应式 HTML，覆盖核心流程、交互反馈与关键状态，使用语义 HTML、可见焦点、键盘操作与可访问名称。对应设计规范第 7.5 章。产出 prototype/index.html。
---

# HTML 原型 Skill

## 知识库（写代码前必读）

- `references/component-patterns.md`：全局基线 CSS、按钮/表单/卡片/导航/表格/状态/弹层/微交互的工艺基准（专业与业余的分界线）。
- `references/polish-checklist.md`：截图自评清单（对齐/层级/色彩/排版/状态/内容/响应式/手感）。
- `references/assets-guide.md`：图标（单一图标集+内联 SVG）、字体（系统栈默认）、图像（CSS/SVG 生成优先）与许可记录。
- 上游令牌：只消费 `design-tokens.json` 的语义层变量；出现档位外魔法数字（px/hex）视为未完成。

## 截图-自评-迭代循环（强制，不迭代不得进评审）

1. 首版完成后运行 `node scripts/screenshot.mjs --package <目录> --round 1`（375/768/1440 三视口截图到 `audit/iterations/round-1/`）。
2. **Read 每张截图**，对照 `references/polish-checklist.md` 逐节自评，列出命中项与修法（C/D 类"廉价感"问题必须正面检查，不许只挑硬伤）。
3. 修改后 `--round 2` 再截再评。**至少完成 2 轮**；直到一轮零新增命中才可交回 Director 进评审。
4. 每轮在 `audit/iterations/round-N/notes.md` 记录：命中项、修复动作（供 Director 与评审核查迭代确实发生）。
5. 浏览器不可用时（6.2 降级）：跳过截图但仍按清单做代码级自评，并在 assumptions 记录"视觉未经渲染验证"。

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `users`, `goals`, `brand`, `constraints`, `artifacts.flows`, `artifacts.tokens`
- writes: `artifacts.prototype`, `assumptions`, `stage`
- produces: `prototype/index.html`

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
- 核心流程不得依赖未说明的私有服务，须可按 README 本地打开。

## 输出契约

- 文件 `prototype/index.html`（及必要的 `prototype/assets/`、分平台页面）。
- 补丁：登记 `artifacts.prototype`（`path` + 单调递增 `artifact_version`），临时假设写入 `assumptions`，`stage` 推进到 `prototype`。
