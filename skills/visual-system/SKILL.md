---
name: visual-system
id: visual_system
description: 基于品牌、内容与情境提出 2-3 个真正不同的视觉方向，定义颜色/字体/间距/圆角/图标/层级/密度/动效/响应式令牌，用真实内容展示方向差异。对应设计规范第 7.4 章。产出 design-tokens.json。
---

# 视觉系统 Skill

## 知识库（两阶段按需加载，规范 27.7——按此构建而非临场发挥，但不通读 8 个方向）

**阶段一（方向选定前，提案用）必读：**

- `references/direction-library.md`：8 个风格方向索引（人格/适用场景/令牌起点/关键手法）与方向提案的交付格式。
- `references/color-system.md`：从品牌色展开 10 档色阶、语义令牌清单、60-30-10 用色纪律、对比度预检表、深色模式、廉价感自查。
- `references/type-and-spacing.md`：字阶比率与档位、中文排版规则、字体栈、8pt 间距、网格/密度、圆角/阴影/动效令牌。
- `references/playbooks/_intro.md` + **仅候选方向**的 `references/playbooks/<Dn>.md`：提案哪 2–3 个方向就读哪几章（首屏构成/关键手法配方/敷衍 vs 到位），确认自己提的方向做得到位——不读全部 8 章。

**阶段二（方向经确认门 C 选定后，深化令牌用）必读：**

- 选定方向的 `references/playbooks/<Dn>.md`（如阶段一未读）。
- `references/font-pairings.md` 中**选定方向的配方节**（§2 按方向搭配配方）+ §0 使用纪律——默认系统栈之上的品牌表现力升级。
- `references/layout-composition.md`：版式构成知识（首屏构成模式/留白节奏/视觉记忆点菜单）——方向预览页按此构成，不许居中堆叠糊弄。

产出的 `design-tokens.json` 必须含**原始层 + 语义层**两层；方向提案必须满足 direction-library.md 的交付格式（真正不同的方向 ≥ 2 项本质差异，同一关键页面真实内容对比渲染）。

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `brand`, `goals`, `users`, `constraints`, `artifacts.design_document`
- writes: `artifacts.tokens`, `decisions`, `stage`
- produces: `design-tokens.json`

## 职责

- 创作前读取已 seal 的 `Design.md` 与 `audit/design/contract-lock.json`，只实现其中已确认的页面、流程、状态和约束；发现契约需变化时停止并交回 Director 受控回退。
- 提出 2–3 个**真正不同**的视觉方向（专业模式），快速模式采用一个合理方向。
- 定义令牌：颜色、字体、间距、圆角、图标、层级、密度、动效、响应式断点。
- 用接近真实的内容与关键页面展示方向差异，而非占位文。
- 保持品牌语言一致，同时允许不同平台采用原生控件与行为（规范 11）。

## 硬性约束（依据库）

- 颜色配比须能满足 `wcag-1.4.3-contrast-minimum`（文本≥4.5:1/大字≥3:1）与 `wcag-1.4.11-non-text-contrast`（≥3:1）。生成令牌时预先自检对比度。
- 不单独依赖颜色传达信息（`wcag-1.4.1-use-of-color`）。
- 字号是设计建议非 WCAG 强制值：Web 正文可用 16px 起点，但须结合字体/语言/密度验证（规范 10.3）。
- 色彩联想只作低强度启发，不用"某色必然导致某心理结果"的绝对结论（规范 10.4）。

## 输出契约

- 文件 `design-tokens.json`：结构化令牌（含 color/type/space/radius/elevation/motion/breakpoints）。
- 视觉方向预览 + 选定方向说明（供确认门 C）。
- 补丁：登记 `artifacts.tokens`，除路径/版本/owner 外必须写入与当前 lock 一致的 `design_contract_digest` 和 `contract_lock_sha256`；把选定方向及其依据写入 `decisions`（引用相关 `rule_id`），`stage` 推进到 `visual`。
