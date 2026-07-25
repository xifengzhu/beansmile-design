# 中文字体搭配库（打开"系统栈"之上的品牌表现力）

系统字体栈（type-and-spacing.md 第 3 节）是**安全默认**，不是天花板。字体是最强的品牌人格载体之一——追求高水准时按本库升级，尤其是 display/标题层。正文层可以保守（系统栈），标题层大胆，成本最低收益最高。

## 0. 使用纪律（先读）

- **用前验证**：CDN/下载地址在写入原型前必须实际请求验证可达（`curl -sI <url>`），失效则换来源或退回系统栈——不许留死链（对齐验收"无伪造来源"精神）。
- **许可入档**：所用字体的名称、来源、许可证写入交付包（assets-guide.md 的许可记录），营销页商用尤其要核对。
- **最多 2 个字族**：展示字体（标题/display 专用）+ 界面字体（正文/控件）。第三个要写进 decisions。
- **只加载用到的字重**：中文全量 woff2 单字重 3–8MB；标题字体只加载 1–2 个字重，`font-display: swap`，系统栈永远垫底兜底。原型阶段可接受全量加载，README 注明"生产需子集化"。
- 数字优先西文字形：字体栈把西文/等宽字体放在中文前（现有规则不变）。

## 1. 可直连来源（稳定、可商用）

**Google Fonts（css2 API，直接 `<link>`）**：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;900&display=swap" rel="stylesheet">
```

| 字体 | 人格 | 用途 |
|---|---|---|
| Noto Sans SC（思源黑体） | 中性、现代、全字重 | 万能界面/正文；100–900 可变 |
| Noto Serif SC（思源宋体） | 端庄、书卷、锐利 | D3 编辑标题（900 字重的大标题极有力量） |
| ZCOOL XiaoWei（站酷小薇） | 清秀、人文宋意 | 文化/生活方式标题点缀 |
| ZCOOL QingKe HuangYou（站酷庆科黄油体） | 圆厚、俏皮 | D6 活力标题、徽章 |
| Ma Shan Zheng（马善政毛笔楷） | 手写、笔触感 | 品牌签名式点缀（≤1 处） |
| JetBrains Mono / Space Grotesk 等西文 | 技术/几何 | D1/D4/D8 的西文与数字层 |

**npm CDN（jsdelivr）**：

```html
<!-- 霞鹜文楷：温暖人文的楷体，OFL 开源 -->
<link href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@latest/style.css" rel="stylesheet">
<!-- font-family: "LXGW WenKai" -->
```

**官方下载自托管（放 prototype/assets/fonts/，许可宽松）**：

| 字体 | 来源 | 许可 | 人格 |
|---|---|---|---|
| MiSans | 小米官网（hyperos.mi.com/font） | 免费商用 | 现代干净，比 Noto 更"产品感"，D2 首选 |
| HarmonyOS Sans | 华为开发者官网 | 免费商用 | 同上，略几何 |
| 阿里巴巴普惠体 3.0 | alibabafont（阿里官网） | 免费商用 | 通用友好，电商语境熟脸 |
| 得意黑 Smiley Sans | GitHub atelier-anchor/smiley-sans | OFL | 窄斜、运动感强烈，D6 的 display 王牌 |
| 优设标题黑 | 字由/优设官方发布页 | 免费商用 | 陡峭有力的标题黑，营销大字 |

## 2. 按方向的搭配配方（展示字体 × 界面字体）

| 方向 | Display/标题 | 界面/正文 | 要点 |
|---|---|---|---|
| D1 瑞士极简 | Noto Sans SC 700（或西文 Helvetica Now 感的系统栈） | 系统栈 | 靠字号与留白，不靠花字；西文/数字可上 grotesk |
| D2 柔和生产力 | MiSans 600 | MiSans / 系统栈 | 单字族多字重，干净统一 |
| D3 编辑杂志 | **Noto Serif SC 900** | 系统栈无衬线 | 宋体大标题 + 无衬线正文是核心反差；引言可用 Serif 600 |
| D4 深色专业 | 系统栈 600 + **JetBrains Mono**（数据层） | 系统栈 | mono 是这个方向的性格来源，中文保持克制 |
| D5 温暖人文 | **LXGW WenKai 700**（标题/引言） | 系统栈或 MiSans | 楷体标题自带体温；正文别用楷（长读费劲） |
| D6 活力消费 | **得意黑** 或 站酷庆科黄油体 | MiSans / 普惠体 | 得意黑自带 8° 前倾的速度感，配超大字号 |
| D7 玻璃景深 | Noto Sans SC 200/300（细字重大字号） | 系统栈 | 轻字重 + 大字号 + 渐变文字 = 未来感；细字重必须 ≥40px 才清晰 |
| D8 新粗野 | **Space Grotesk / mono 系** + Noto Sans SC 900 | Noto Sans SC | 西文 mono 大写标签 + 中文重黑，图纸感 |

## 3. 展示字体的排版参数修正

换了展示字体后，type-and-spacing.md 的默认参数按字体性格微调：

- 宋体/楷体大标题：行高 +0.05（笔画复杂需更多空气）；字距 `+0.02em~+0.04em`；避免 <24px 使用（屏显发虚）。
- 窄斜体（得意黑）：天然紧凑，不再收字距；行高可压到 1.1；只用于 ≤12 字的短标题。
- 细字重（200/300）：仅深底浅字或 ≥40px；对比度按实测（细字重的有效对比低于色值计算）。
- 任何展示字体缺字兜底：`font-family: "<展示字体>", <系统栈>`——中文长尾字缺字时无缝回退，标题文案写完后逐字检查有没有"混入宋体的一个黑体字"。

## 4. 快速自检

- [ ] 字族 ≤2，每族加载字重 ≤2–3 个。
- [ ] CDN 链接实测可达；自托管文件真实存在于 assets/fonts/。
- [ ] 许可与来源已记录。
- [ ] 展示字体只出现在标题/display 层；正文仍是高可读无衬线。
- [ ] `font-display: swap` + 系统栈兜底；断网打开原型不白屏（字体换但布局稳）。
