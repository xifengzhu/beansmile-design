---
name: design-presentation
description: 从 implementation-ready Design.md、已评审原型和冻结交付来源生成完整、原生可编辑、可渲染审计的设计方案 PPTX。用于最终设计提案演示；不用于未评审方案、PDF 转 PPT、逐页图片封装或阶段推进。
---

# Design Presentation

生成固定路径 `presentation/design-system.pptx`，并提供可由仓库脚本重算的结构与渲染证据。

## 调用边界

- 每次调用使用全新会话；不得继承 `design_specification finalize` 或 Director 的完整历史。
- 只读取 manifest 允许的 context 投影、最终 `Design.md`、冻结 delivery source 及其中列出的文件。
- 只写 PPTX、`audit/presentation/manifest.json`、`audit/presentation/qa.json` 和渲染证据；只返回 `artifacts.presentation` 补丁。
- 不修改 `Design.md`、context、stage、confirmations、tokens、prototype、snapshot、findings 或任何评审结论。
- 不创建或修改 `audit/presentation/director-review.json`；该证据只能由 Director 在独立复核中产生。
- 阻塞或验证非零退出时不返回补丁，只返回结构化原因和 Director handoff。

开始前完整读取 [references/contract.md](references/contract.md) 和当前运行时对应的 adapter 指引；Codex 使用 [references/codex-adapter.md](references/codex-adapter.md)。

## 前置验证

1. 要求 `artifacts.design_document.phase: implementation_ready`，其 `realizes_prototype_version` 等于当前 prototype 版本，文件 SHA、contract digest、lock 和 delivery source 均有效。
2. 运行 `node scripts/check-design-document.mjs --package <dir> --phase implementation_ready`；非零退出时停止。
3. 交付来源、Design.md、prototype、tokens、snapshot 或 findings 在生成期间发生漂移时，丢弃本次输出并停止。

## 生成

1. 依据 reference contract 建立逐页 source-to-slide 映射；不得新增 Design.md 或冻结来源中没有的结论、指标、反馈或审批状态。
2. 用 presentation adapter 从空白演示创建原生 `.pptx`。标题、正文、色块、表格、基础图形和简单关系必须是可编辑对象；截图和复杂图像才可栅格化。
3. 使用“稳定报告外壳 + 项目视觉”模型，强调色、字体样本和页面视觉来自当前项目 token 与原型，不复制参考项目品牌。
4. 只生成规定的 PPTX、manifest、QA 与逐页渲染证据。不得额外创建 PDF 或自定义输出目录。

## 禁止降级

- 生产交付不得使用 PptxGenJS、python-pptx、PDF 包装、逐页 PNG/JPEG 封装或整页截图冒充可编辑内容。
- PptxGenJS 仅允许仓库测试夹具或环境 probe 使用，不得用于本 Skill 的交付文件。
- adapter 无法创建、重读或渲染可编辑 PPTX 时返回 `blocked` 或 `unverified`；不得自报通过，也不得提供低质量替代物。

## 验证与返回

1. 运行 `node scripts/check-presentation.mjs --package <dir>`，让仓库检查器重读 OOXML 对象、来源、渲染哈希、溢出/裁切/重叠和字体证据。
2. 退出码 `0` 才可返回补丁；退出码 `3` 表示未验证，不是通过；其他非零退出为失败。
3. 成功补丁仅登记 `artifacts.presentation`，绑定当前 prototype version、递增的 presentation revision、delivery source digest、最终 Design.md SHA 和 PPTX SHA。
4. 返回验证命令、退出码、输出路径、重算摘要及唯一允许的 artifact 补丁，交由 Director 独立逐页复核和合并。
