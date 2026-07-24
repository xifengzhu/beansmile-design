# 字体与间距体系（生成时必须遵循的构建方法）

本文件是 visual-system 的核心知识载荷。生成 `design-tokens.json` 时按此构建，而不是临场发挥。

## 1. 字阶（type scale）

从正文字号出发按固定比率生成，禁止逐个页面拍脑袋定字号。

| 比率 | 适用 | 特征 |
|---|---|---|
| 1.2（Minor Third） | 数据密集后台、工具类 | 层级平缓，信息密度高 |
| 1.25（Major Third） | 默认起点：SaaS、通用产品 | 层级清晰且克制 |
| 1.333（Perfect Fourth） | 营销页、内容编辑类 | 标题跳跃感强，戏剧性 |

以 16px 正文、1.25 比率为例的完整档位（四舍五入到偶数，方便对齐 8pt 网格）：

```
caption 12px / 1.5   ·  body-sm 14px / 1.6  ·  body 16px / 1.7
h4 20px / 1.4        ·  h3 25px / 1.35      ·  h2 31px / 1.25  ·  h1 39px / 1.15  ·  display 49px / 1.1
```

规则：
- **档位总数 ≤ 7**（display 可选）。页面上任何文本都必须落在档位上。
- 字号越大行高越小（display 1.1 → caption 1.5+）。
- 中文正文行高取 **1.6–1.8**（高于西文的 1.5），因为汉字方块结构无升降部，行距不足会明显发闷。
- 移动端 body 不小于 16px（同时避免 iOS 输入框自动缩放），caption 不小于 12px。

## 2. 中文排版特有规则（大多数西方指南不会告诉你）

- **禁用 faux 样式**：中文没有斜体传统，强调用字重、颜色或底色，不用 `font-style: italic`；不要给中文加 `text-decoration: underline` 做强调（与链接混淆且丑）。
- **字重档位**：中文字体通常只有 300/400/500/600（700 以上多为伪加粗）。标题用 500/600，正文 400，禁用 faux-bold（无对应字重时浏览器涂粗，边缘发糊）。
- **中西文混排**：中英文之间、中文与数字之间留隙（手写空格或依赖字体特性）；数字和单位用西文字体渲染更精致——字体栈把西文字体放在中文字体**前面**即可自动实现。
- **字距**：中文正文不加 letter-spacing；大标题（≥31px）可加 `0.02em` 提升端庄感（与西文大标题收紧相反）。西文/数字大标题收紧 `-0.01em ~ -0.02em`。
- **行长**：中文每行 **20–35 个汉字**（西文 45–75 字符）。正文容器 `max-width` 按此推：16px × 35 ≈ 560–640px。
- **标点**：成段文本开启 `text-align: justify` 时必须配 `text-justify: inter-ideograph` 意识（浏览器支持有限，宁可左对齐）；避免标题行尾孤立标点。

## 3. 字体栈（直接可用）

```css
/* 界面默认：西文在前，数字/拉丁字母自动用更精致的西文字形 */
--font-sans: -apple-system, "SF Pro Text", "Helvetica Neue", "PingFang SC",
             "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Microsoft YaHei", sans-serif;
/* 数据/代码 */
--font-mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
/* 编辑/杂志方向可选衬线 */
--font-serif: "Songti SC", "Noto Serif SC", Georgia, serif;
```

- 表格、金额、倒计时等数字必须 `font-variant-numeric: tabular-nums`，否则数字宽度不一跳动。
- 一个产品**最多 2 个字族**（界面 + 可选的展示/衬线）。第三个必须写入 decisions 说明理由。

## 4. 间距体系（8pt 网格）

唯一合法间距档：`4, 8, 12, 16, 24, 32, 48, 64, 96`（px）。任何 margin/padding/gap 都从这里取。

分配原则（亲密性法则——相关的更近）：
- 标签 ↔ 输入框：4–8
- 段落内元素（标题↔正文）：8–12
- 卡片内边距：16（紧凑）/ 24（默认）/ 32（宽松）
- 相邻卡片/表单组之间：16–24
- 页面区块（section）之间：48–64，必须 **≥ 区块内部间距的 2 倍**——否则区块边界消失，页面变成一锅粥。这是评审最常见的 warning 来源。
- 页面边距：移动 16–24，桌面 32–48。

## 5. 布局网格与密度

- 桌面：12 列，gutter 24，内容区 max-width 1200–1280（数据密集后台可放宽到 1440）。
- 正文阅读类内容区收窄到 640–720。
- 移动：4 列或单列，边距 16。
- 密度双档：默认（行高 48–56 的列表/表格行）与紧凑（36–40）。同一视图只用一档。
- 触控目标 ≥ 44×44（iOS）/ 48×48（Android）/ 桌面指针 ≥ 24×24（对应 `wcag-2.5.8`）。

## 6. 圆角、阴影、动效令牌

```
radius:  sm 4 · md 8 · lg 12 · xl 16 · full 9999   （同一产品取相邻 2–3 档，不许 5 档全用）
shadow（分层配方，永远不用单层大黑影）:
  sm: 0 1px 2px rgb(0 0 0 / .05)
  md: 0 1px 3px rgb(0 0 0 / .06), 0 4px 12px rgb(0 0 0 / .08)
  lg: 0 2px 4px rgb(0 0 0 / .06), 0 12px 32px rgb(0 0 0 / .12)
  阴影可染品牌色调（把纯黑换成品牌色深部，如 rgb(30 41 82 / .08)），画面立刻高级。
motion: fast 120ms · base 200ms · slow 300ms，缓动 ease-out（进入）/ ease-in（退出）；
  hover 反馈用 fast，面板/弹层用 base。必须尊重 prefers-reduced-motion（web-reduced-motion）。
```

## 7. design-tokens.json 完整性要求

令牌文件必须含两层：**原始层**（palette、字阶、间距档）与**语义层**（见 color-system.md 的语义令牌清单）。原型 CSS 只允许消费语义层变量；出现魔法数字（不在档位上的 px/hex）即视为未完成。
