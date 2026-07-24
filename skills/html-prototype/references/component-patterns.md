# 组件工艺范式（写原型 CSS/HTML 时的质量基准）

这些是"专业与业余的分界线"级别的工艺细节。全部消费 design-tokens.json 的语义变量。

## 0. 全局基线（每个原型开头必有）

```css
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: var(--font-sans); font-size: 16px; line-height: 1.7;
  color: var(--text-primary); background: var(--bg-page);
  -webkit-font-smoothing: antialiased; margin: 0;
}
:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: 2px; }
:focus:not(:focus-visible) { outline: none; }   /* 鼠标点击不出框，键盘出框 */
::selection { background: var(--accent-subtle); }
img { max-width: 100%; display: block; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

## 1. 按钮

- 高度档：sm 32 / md 40 / lg 48（移动端主按钮用 48）。水平 padding ≈ 高度 × 0.5–0.6。
- 字重 500–600，字号比正文小一档或同档（md 按钮 14–15px）。
- 图标+文字：图标 16–20px，gap 8，图标与文字光学垂直居中（flex + align-items:center）。
- 四态齐全且**可感知**：hover（背景 +1 档深或 8% 黑叠加）、active（+2 档 & scale(.98) 可选）、focus-visible（ring）、disabled（opacity .5 + cursor:not-allowed，禁止只变灰文字）。
- loading 态：文字换 spinner 时**锁定按钮宽度**（min-width 或固定），防止跳动。
- 主/次/幽灵/危险四种以内；一屏一个实心主按钮（见 color-system.md 用色纪律）。
- 用 `<button>`，不用 div+onclick（web-native-html-first、键盘可达）。

```css
.btn { display:inline-flex; align-items:center; justify-content:center; gap:8px;
  height:40px; padding:0 20px; border-radius:var(--radius-md); font-weight:500; font-size:15px;
  border:1px solid transparent; cursor:pointer; transition:background .12s ease-out, border-color .12s ease-out; }
.btn-primary { background:var(--accent); color:var(--text-on-accent); }
.btn-primary:hover { background:var(--accent-hover); }
.btn-secondary { background:var(--bg-surface); border-color:var(--border-strong); color:var(--text-primary); }
.btn-secondary:hover { background:var(--bg-subtle); }
```

## 2. 表单

- 标签在输入框**上方**（不是占位符里），4–8px 间距，14px / 500 / text-primary；辅助说明 13px text-tertiary 放标签下或框下。
- 输入框：高 40–44，padding 0 12，边框 border-strong，radius md；focus 时 `border-color: var(--border-focus)` + `box-shadow: 0 0 0 3px var(--accent-subtle)`（双线索）。
- 占位符 text-tertiary，且**不承载必要信息**（提交后就看不见了）。
- 错误态三件套（wcag-3.3.1/3.3.2）：红边框 + 图标/文字错误信息（框下 13px danger-text）+ `aria-invalid="true"` / `aria-describedby` 指向错误文本。错误信息说"怎么改"而不是"错了"。
- 必填用文字"（必填）"或 `*`+图例说明；相关字段分组 `<fieldset>`。
- 提交按钮永远不置灰等待校验——点击后就地校验并把焦点移到第一个错误字段。

## 3. 卡片与列表

- 卡片 = bg-surface + border-default 1px + radius lg + padding 24（信息卡）/ 16（列表卡）+ shadow-sm。
- 卡片内层级：标题（body 大 1 档 / 600）→ 元信息（13px text-tertiary）→ 正文/数据。标题与元信息间 4，块与块间 12–16。
- 可点击整卡：外层用 `<a>` 包裹或卡内主链接 + `::after` 铺满，hover 时 shadow sm→md + border 变深；**不要**位移（列表滚动时抖）。
- 列表行高一致（48–56），分隔用 border-default 1px 或 8px 间隙二选一，全列表统一。

## 4. 导航

- 顶栏：高 56–64，左 logo/产品名，右用户区；当前页链接加粗或下边框 2px accent，不是只换颜色（wcag-1.4.1）。
- 侧栏：宽 240–280；项高 36–40，radius md，选中态 `accent-subtle` 底 + accent 文字 + 500；分组标题 12px 大写/加字距 text-tertiary，组间 24。
- 面包屑：13–14px，分隔符 text-tertiary，当前页 text-primary 不可点。
- 移动端：底部 tab（高 56 + safe-area）或抽屉；抽屉要 focus trap 与 Esc 关闭（web-modal-focus-management）。

## 5. 表格与数据

- 表头：13px / 500 / text-secondary / 底边框 border-strong；不用重底色。
- 行高 48（默认）/ 36（紧凑）；数字列右对齐 + tabular-nums；文本列左对齐；操作列固定最右。
- hover 行 `bg-subtle`；斑马纹与行边框二选一。
- 长表格：表头 `position: sticky; top: 0; background: var(--bg-surface)`。
- 单元格内容溢出：`text-overflow: ellipsis` + title 属性，禁止撑破布局。

## 6. 空 / 加载 / 错误状态（原型必须真实展示，不是注释里说说）

- 空态：居中，插图或大图标（48–64px text-tertiary）+ 一句话标题（为什么空）+ 引导动作按钮。垂直居中于内容区而非页面。
- 加载：骨架屏（`bg-subtle` 圆角块 + 微光动画）优先于 spinner；骨架形状必须近似真实内容布局，**尺寸与真实内容一致**防止加载完跳动。
- 错误：说人话 + 给出路（重试按钮/联系方式）；表单级错误汇总在顶部 `role="alert"`。

```css
.skeleton { background: var(--bg-subtle); border-radius: var(--radius-sm); position: relative; overflow: hidden; }
.skeleton::after { content:""; position:absolute; inset:0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / .5), transparent);
  animation: shimmer 1.6s infinite; }
@keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
```

## 7. 弹层

- 模态：max-width 480（确认类）/ 640（表单类），radius xl，padding 24–32，遮罩 `rgb(0 0 0 / .5)`；标题 h2 + 右上关闭钮（44×44 热区）；打开时焦点进入、Tab 循环、Esc 关闭、关闭后焦点还原（web-modal-focus-management）。
- Toast：右上或顶部居中，宽 ≤ 380，图标 + 单行文本 + 可选动作；成功 3s 自动消失，错误需手动关闭；`role="status"`。
- 下拉菜单：与触发器 4–8px 间距，shadow-lg，项高 36，键盘可上下选择。

## 8. 微交互与手感

- transition 只写具体属性（background、border-color、box-shadow、transform、opacity），**永远不写 `transition: all`**。
- hover 反馈 120ms ease-out；进入动画 200ms（fade + 8px 上移）；退出更快（150ms）。
- 页面首屏可做一次性入场（stagger 30–50ms/项，总时长 ≤ 400ms），列表滚动中禁止再触发。
- 数字变化用 tabular-nums 原地变，不做滚动老虎机（除非营销页）。

## 9. 语义与可达性骨架（逐条对应依据库）

- 地标：`header/nav/main/footer` 各一，页面唯一 h1（web-landmark-regions）。
- 标题层级不跳级；视觉大小用 class 调，语义用正确的 hn。
- 图标按钮必有 `aria-label`；装饰图标 `aria-hidden="true"`。
- `<html lang="zh-CN">` + 描述性 `<title>`（web-page-lang-title）；viewport 不禁缩放（web-viewport-meta-scalable）。
- 触控目标 ≥24×24，移动端主要操作 ≥44×44（wcag-2.5.8）。
