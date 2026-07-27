---
name: design-specification
description: 在 UX 完成后、视觉设计前生成并校验 proposed Design.md 设计契约，或在双评审后把同一文件补齐为 implementation-ready 开发交接。用于 design_specification prepare/finalize；不负责确认、seal、阶段推进或修改设计产物。
---

# Design Specification

为开发维护唯一的根目录 `Design.md`。同一 Skill 分两次独立调用：`prepare` 冻结设计前契约，`finalize` 在评审后追加实施事实。

## 调用边界

- 每个 operation 必须使用全新会话；不继承 Director 或另一个 operation 的对话历史。
- 必须显式收到 `operation=prepare|finalize`。缺失或未知 operation 时停止。
- 只读取 Director 提供的 operation 投影、冻结 source manifest 及其列出的包内文件。
- 只写根目录 `Design.md`，只返回 `artifacts.design_document` 补丁。
- 不直接修改 `context.yaml`、`stage`、confirmations、contract lock、source manifest、`brief.md`、`flows.md`、`decisions.md`、tokens、prototype、snapshot、findings 或 presentation。
- 不代表用户确认，不执行 seal，不把 provisional patch 合并进 context。
- 命中任一停止条件时返回 `blocked` 原因和所需 Director 动作，且不返回任何 context/artifact 补丁。若请求把合法 operation 与会改变来源、审批状态或锁的越权动作绑在一起，整个 operation 中止；不得先执行越权动作再继续生成。

开始前完整读取 [references/contract.md](references/contract.md)。

## Prepare

仅在 `stage: ux` 且 Director 已冻结并验证 `audit/design/contract-source.json` 时运行。

1. 核对 `operation=prepare` 投影只包含 manifest 允许的字段；缺 `artifacts.brief`、`artifacts.flows` 或 source manifest 时停止。
2. 只依据冻结输入生成完整的 `# 第一部分：设计契约`。不得出现第二部分、占位内容、虚构 token、技术栈、API 或资源路径。
3. frontmatter 使用 `phase: proposed_contract`、下一合法 `artifact_version`、当前 `contract_revision`、重新计算的 contract/source digest。
4. 运行 `node scripts/check-design-document.mjs --package <dir> --phase proposed_contract`。非零退出时不得返回补丁。
5. 返回 provisional `artifacts.design_document` 补丁供 Director seal；明确标注尚未获得用户确认、不可直接应用。

## Finalize

仅在双评审完成且 Director 已冻结并验证 `audit/delivery/source-manifest.json` 后运行。

1. 要求现有 `Design.md` 为 `approved_contract`，contract lock 有效，并与 tokens、prototype 和冻结快照绑定同一 contract digest。
2. 保留第一部分的结构化语义和 `contract_digest` 不变；如实施事实要求改变页面、流程、状态或已确认约束，停止并要求 Director 走受控回退。
3. 在同一文件追加完整 `# 第二部分：实施规格`，只记录冻结来源中已经实现并评审的事实。
4. frontmatter 改为 `phase: implementation_ready`，`artifact_version` 恰好递增 1，并登记当前 prototype/source 摘要；`contract_revision` 不变。
5. 运行 `node scripts/check-design-document.mjs --package <dir> --phase implementation_ready`。非零退出或第一部分 digest 改变时不得返回补丁。
6. 只返回更新后的 `artifacts.design_document` 补丁。

## 返回纪律

成功时返回文件路径、operation、校验命令及退出码、重新计算的摘要和唯一允许的 artifact 补丁。阻塞时只返回结构化原因和 Director handoff，不返回补丁。不得用文字自报的“已检查”替代命令结果。
