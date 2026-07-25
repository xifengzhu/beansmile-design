# 素材供给指南（图标 / 字体 / 图像，符合规范 15、16 的治理要求）

原则：原型必须离线可开（规范 13），素材优先用**内联、可再生、许可清晰**的来源；所有外部资产在 README 记录来源与许可（规范 16）。

## 1. 图标

**策略：单一图标集 + 内联 SVG。** 混用图标集（描边粗细/圆角风格不一致）是完成度硬伤。

| 图标集 | 许可 | 风格 | 适配方向 |
|---|---|---|---|
| Lucide（lucide.dev） | ISC | 2px 描边、圆头、24 网格 | D1/D2/D4 默认首选 |
| Tabler Icons（tabler.io/icons） | MIT | 2px 描边、略圆润、覆盖面大 | D2/D5 |
| Phosphor（phosphoricons.com） | MIT | 多字重（thin–fill） | D5/D6（duotone/fill 有表现力） |
| Remix Icon（remixicon.com） | Apache-2.0 | 线/面双套 | 中后台、小程序习惯 |

用法规范：
- 直接把 SVG 内联进 HTML（离线可用、可染色），统一 `fill="none" stroke="currentColor" stroke-width="2"`（线性集）；颜色跟随文字 `currentColor`。
- 尺寸只用 16 / 20 / 24；按钮内 16–20，空态装饰 48–64。
- 装饰性图标 `aria-hidden="true"`；独立图标按钮配 `aria-label`。
- 不要从多个集里各拿几个"更像"的图标——宁可用同集里次优的那个。

## 2. 字体

正文/界面层默认**系统字体栈**（type-and-spacing.md §3）——零加载成本、渲染最佳、无许可问题。**标题/display 层鼓励按 `visual-system/references/font-pairings.md` 升级**：字体是最强的品牌人格载体，标题字体是成本最低、收益最高的表现力投资。

规则：
- 搭配、来源、许可、按方向的配方一律以 font-pairings.md 为准（Google Fonts 可直连的 Noto/站酷系、jsdelivr 的霞鹜文楷、官方下载自托管的 MiSans/得意黑等）。
- 中文展示字体只加载 1–2 个字重、只用于标题层；正文仍走系统栈。CDN 链接写入前 `curl -sI` 验证可达。
- 任何 webfont 必须 `font-display: swap` + 系统栈兜底——离线打开原型时回退系统字体但布局稳定、内容完整（不违反"本地可开"）。自托管到 `prototype/assets/fonts/` 的离线保真度更高，优先。
- README 记录字体名、来源、许可证，并注明"生产环境需子集化"。

## 3. 图像与示意图

优先级从高到低：

1. **CSS/SVG 生成**：渐变、几何图形、网点/网格纹理、抽象 blob——离线、可染品牌色、任意分辨率。营销头图、空态插画、卡片封面优先用这条路。具体技法见下方"§3b 生成图像的工艺配方"。
2. **数据可视化**：用内联 SVG 手绘简单图表（折线/柱状/环形），数值与 brief 的真实业务量级一致；不引第三方图表库（原型不需要）。
3. **头像**：首字母 + 品牌色阶背景（`hsl` 按用户名 hash 取色相），不用真人照片（隐私 + 许可双避）。
4. **产品截图/照片位**：用带正确宽高比的灰阶占位（bg-subtle + 图标 + 标注文字说明这里是什么），**不得**抓取无关网图冒充成品（规范 15"素材缺失"条款）。
5. 用户提供的品牌素材：按 brief 使用，记录在 README；未经确认不外传（规范 16）。

硬性规则：
- 每张图有 `width/height` 或 `aspect-ratio`（防布局跳动）+ 有意义的 `alt`（装饰图 `alt=""`）。
- 不引用外站热链图片（离线打不开 = 结构稳定验收 fail 风险）。

## 3b. 生成图像的工艺配方（"没有真图"不等于"看起来没设计"）

**Mesh 渐变头图**（一行 CSS 出氛围底，比单向渐变高级一档）：

```css
.hero-bg {
  background:
    radial-gradient(at 20% 30%, hsl(var(--brand-h) 70% 60% / .35) 0, transparent 50%),
    radial-gradient(at 80% 20%, hsl(calc(var(--brand-h) + 40) 60% 65% / .3) 0, transparent 50%),
    radial-gradient(at 60% 80%, hsl(calc(var(--brand-h) - 30) 50% 55% / .25) 0, transparent 55%),
    var(--bg-page);
}
```

**噪点质感**（去掉渐变的"塑料感"，覆一层 SVG 噪点）：

```css
.grain::after { content:""; position:absolute; inset:0; opacity:.06; pointer-events:none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
```

**图案背景**（区块底纹，密度低于内容）：网点 `radial-gradient(circle, var(--border-default) 1px, transparent 1px); background-size: 20px 20px;`；网格线 `linear-gradient` 双向 1px；条纹 `repeating-linear-gradient(45deg, ...)`（D8 适用）。透明度控制在内容对比不受影响的程度。

**空态/装饰插画（内联 SVG，统一风格三件套）**：同一描边粗细（与图标集一致，通常 2px）、同一圆角语言、只用令牌色（品牌 200–400 档 + 灰阶）。构图公式：一个主形状（圆/blob 垫底）+ 一个具象元素（文件/放大镜/信封，从图标集放大改造）+ 2–3 个漂浮小元素（点/加号/短线）错落。

**设备样机**：产品截图裹一层 CSS 窗框——`border-radius: 12px; border: 1px solid var(--border-default); box-shadow: var(--shadow-lg);` 顶部加 32px 标题栏（三个 10px 圆点）即浏览器窗；手机样机用 `border-radius: 36px + 8px 内边距深色框`。截图本体可以就是原型自己的另一页面（iframe 或缩放截图）。

纪律：全站生成图像共享同一套色相与几何语言——头图 mesh、空态插画、图案底纹用的是同一批令牌色，才是"一个品牌"。

## 4. 许可记录模板（写进交付包 README）

```markdown
## 素材来源与许可
| 资产 | 来源 | 许可 | 备注 |
|---|---|---|---|
| 图标 | Lucide v0.4xx | ISC | 内联 SVG，共 N 枚 |
| 标题字体 | Inter (Google Fonts) | SIL OFL 1.1 | 仅 600/700 字重 |
| 插画/头图 | 本原型内联 SVG 生成 | — | 可自由修改 |
```
