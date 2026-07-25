// 移动视口页边距渲染检查（规范 25 / v1.6）。
// 动机：CSS 声明层的间距档位检查（grep 值是否在 space 档）抓不到"简写覆盖容器水平 padding"
// 这类渲染级失效——值 `72px 0` 里的 72 与 0 都是合法档位，但渲染结果是正文贴视口边。
// 因此在真实渲染的移动视口上量文本承载元素的几何盒：距视口左/右边缘 < 阈值即判贴边阻断。
//
// 分层：collectEdgeInsetTargetsInPage 在页面上下文采集（DOM 级过滤：有直接文本节点、
// 可见、非 clip-path 隐藏工艺、非 1px 隐藏元素、非视口上方/水平视口外）；
// edgeOffenders 为纯函数判定（可单测），阈值逻辑只在这里。

export const EDGE_INSET_MIN_PX = 8; // UA 默认 body margin 为基线；严格小于才判贴边
export const EDGE_INSET_VIEWPORT = { width: 375, height: 812 }; // 移动检查视口

// 页面上下文采集函数（传给 page.evaluate，必须自包含、不引用模块作用域）。
// 返回 { vw, items: [{ el, text, left, right }] }，left/right 为 getBoundingClientRect 原始值。
export function collectEdgeInsetTargetsInPage() {
  const vw = document.documentElement.clientWidth;
  const items = [];
  const visible = (e) => {
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  };
  for (const el of document.querySelectorAll("body *")) {
    // 只看直接承载文本节点的元素（与对比度采样同一口径），容器本身贴边但文本有内衬时不误报
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.clipPath && s.clipPath !== "none") continue; // sr-only 裁切隐藏工艺
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue; // 1px 视觉隐藏元素
    if (r.right <= 0 || r.left >= vw) continue; // 完全在水平视口外（off-canvas）
    if (r.bottom <= 0) continue; // 视口上方的收纳元素（如默认态 skip-link）；视口下方是真实内容，必须检查
    if (items.length >= 400) break;
    items.push({
      el: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/)[0] : ""),
      text: (el.textContent || "").trim().slice(0, 24),
      left: r.left,
      right: r.right,
    });
  }
  return { vw, items };
}

// 纯判定：items 中距视口左或右边缘 < minPx 的即贴边元素。
export function edgeOffenders(items, viewportWidth, minPx = EDGE_INSET_MIN_PX) {
  const out = [];
  for (const it of items ?? []) {
    const leftInset = it.left;
    const rightInset = viewportWidth - it.right;
    if (leftInset < minPx || rightInset < minPx) {
      out.push({ el: it.el, text: it.text, leftInset: Math.round(leftInset), rightInset: Math.round(rightInset) });
    }
  }
  return out;
}
