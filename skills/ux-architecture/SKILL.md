---
name: ux-architecture
id: ux_architecture
description: 生成关键任务流、页面地图与信息架构，定义导航、页面责任、入口出口与异常路径，列出每个核心界面的内容、动作与状态，优先采用平台熟悉模式。对应设计规范第 7.3 章。产出 flows.md。
---

# UX 架构 Skill

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `users`, `goals`, `constraints`, `decisions`
- writes: `artifacts.flows`, `stage`
- produces: `flows.md`

## 职责

- 生成关键任务流、页面地图和信息架构。
- 定义导航、页面责任、入口、出口和异常路径。
- 列出每个核心界面的内容、动作和状态（正常/空/加载/错误/成功/禁用/焦点）。
- 优先采用用户熟悉的平台模式；任何非常规交互必须说明收益（规范 3.2）。

## 流程

1. 读取需求上下文与已有决策。
2. 按核心用户任务拆解端到端流程，标出决策点与异常分支。
3. 为每个核心界面列出：内容清单、可用动作、必须覆盖的状态集。
4. 导航与控件遵循目标平台习惯；偏离平台惯例的交互写明理由与收益，交 `decision-record` 记录。

## 输出契约

- 文件 `flows.md`：任务流图/步骤 · 页面地图 · 每页内容-动作-状态矩阵 · 导航与异常路径。
- 补丁：登记 `artifacts.flows`（`path: flows.md` + `artifact_version`），把 `stage` 推进到 `ux`。
