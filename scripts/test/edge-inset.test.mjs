// 移动视口页边距渲染检查（规范 25 / v1.6）：纯判定函数 + 采集函数契约。
// 事故背景：`.wrap.case-body` 上 `padding: 72px 0` 简写覆盖容器水平 padding，
// 正文贴视口边——声明层的间距档位检查（72/0 均为合法档位值）对此必然漏检。
import test from "node:test";
import assert from "node:assert/strict";
import { edgeOffenders, collectEdgeInsetTargetsInPage, EDGE_INSET_MIN_PX, EDGE_INSET_VIEWPORT } from "../lib/edge-inset.mjs";

const VW = 375;

test("贴左边（left=0）判贴边——真实事故形态", () => {
  const out = edgeOffenders([{ el: "h2.case-section", text: "方案", left: 0, right: 375 }], VW);
  assert.equal(out.length, 1);
  assert.equal(out[0].leftInset, 0);
  assert.equal(out[0].rightInset, 0);
});

test("贴右边（right=vw）也判贴边，即使左侧有正常边距", () => {
  const out = edgeOffenders([{ el: "p", text: "右贴边", left: 16, right: 375 }], VW);
  assert.equal(out.length, 1);
});

test("恰好等于阈值不判（UA 默认 body margin 8px 是合法基线，防 fixtures 误报）", () => {
  const out = edgeOffenders([{ el: "p", text: "默认边距", left: EDGE_INSET_MIN_PX, right: VW - EDGE_INSET_MIN_PX }], VW);
  assert.equal(out.length, 0);
});

test("正常页边距（16px）不判", () => {
  const out = edgeOffenders([{ el: "p", text: "正常", left: 16, right: VW - 16 }], VW);
  assert.equal(out.length, 0);
});

test("阈值以内 1px 也要抓（7px < 8px）", () => {
  const out = edgeOffenders([{ el: "p", text: "差一点", left: 7, right: VW - 16 }], VW);
  assert.equal(out.length, 1);
  assert.equal(out[0].leftInset, 7);
});

test("多元素混合：只报贴边的，保序", () => {
  const out = edgeOffenders(
    [
      { el: "h1", text: "标题", left: 16, right: VW - 16 },
      { el: "h2", text: "方案", left: 0, right: VW },
      { el: "p", text: "正文", left: 0, right: VW },
    ],
    VW,
  );
  assert.deepEqual(out.map((o) => o.el), ["h2", "p"]);
});

test("对抗：部分越出左视口（left 为负）仍判贴边，不因越界被吞", () => {
  const out = edgeOffenders([{ el: "div.marquee", text: "越界", left: -20, right: 200 }], VW);
  assert.equal(out.length, 1);
  assert.equal(out[0].leftInset, -20);
});

test("对抗：空/缺失 items 不抛错、不误报", () => {
  assert.equal(edgeOffenders([], VW).length, 0);
  assert.equal(edgeOffenders(undefined, VW).length, 0);
});

test("小数矩形值取整输出，便于 findings 引用", () => {
  const out = edgeOffenders([{ el: "p", text: "小数", left: 3.4, right: 371.8 }], VW);
  assert.equal(out[0].leftInset, 3);
  assert.equal(out[0].rightInset, 3);
});

test("采集函数契约：自包含（可序列化进页面上下文，不引用模块作用域）", () => {
  const src = collectEdgeInsetTargetsInPage.toString();
  // page.evaluate 序列化后在页面上下文重建，任何模块级引用都会 ReferenceError
  for (const banned of ["edgeOffenders", "EDGE_INSET_MIN_PX", "require(", "import "]) {
    assert.ok(!src.includes(banned), `采集函数不得引用模块作用域: ${banned}`);
  }
});

test("检查视口为移动档（宽 ≤ 480）", () => {
  assert.ok(EDGE_INSET_VIEWPORT.width <= 480 && EDGE_INSET_VIEWPORT.width >= 320);
});
