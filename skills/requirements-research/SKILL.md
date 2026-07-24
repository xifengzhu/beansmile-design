---
name: requirements-research
id: requirements_research
description: 从业务目标、目标用户、核心任务与成功指标出发做需求研究，区分新设计与改版，识别平台惯例与领域风险，对来源分级标注。对应设计规范第 7.2 章。产出 brief.md。
---

# 需求研究 Skill

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `brand`, `constraints`
- writes: `users`, `goals`, `constraints`, `assumptions`, `stage`
- produces: `brief.md`

## 职责

- 提取业务目标、目标用户、核心任务和成功指标。
- 区分新产品设计（`project.task_type=new_design`）与改版（`redesign`）。
- 识别目标平台惯例、领域风险和必要竞品参考。
- 对每条来源标注 `verified` / `inferred` / `user_provided`（写入 `assumptions[].source`）。

## 流程

1. 读取 `context.project`（平台、模式、任务类型）与用户提供的原始需求、品牌素材。
2. 归纳业务目标、用户画像、核心用户任务、成功标准。
3. 缺少会改变设计方向的信息 → 通过 Director 暂停并一次只问一个问题；缺非关键信息 → 写入 `assumptions`（`status: tentative`），绝不伪装成用户结论（规范 15）。
4. 不把灵感网站、流行趋势或色彩联想当作用户研究证据（规范 2.2）。第一版研究证据仅限用户标注为"已核实"的任务证据（规范 10.1 说明）。

## 输出契约

- 文件 `brief.md`：业务目标 / 目标用户与需求 / 核心任务 / 成功指标 / 平台与领域约束 / 来源分级。
- 补丁：填充 `users.primary`、`users.needs`、`goals.*`、补充 `constraints`、登记 `assumptions`，并把 `stage` 推进到 `research`。
