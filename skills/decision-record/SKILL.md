---
name: decision-record
id: decision_record
description: 将设计问题映射到适用规则，解析规则强度/平台/版本/冲突/例外，为关键决策写简短依据并保留完整来源，本地规则疑似过期时只查对应官方来源。对应设计规范第 7.6 章。产出 decisions.md。
---

# 依据记录 Skill

## 白名单（由 Director 做字段级 diff 门禁强制）

- reads: `project`, `goals`, `users`, `brand`, `constraints`, `decisions`, `exceptions`, `assumptions`
- writes: `decisions`, `exceptions`, `stage`
- produces: `decisions.md`

## 职责

- 将设计问题映射到依据库中适用的规则卡（`evidence/rules/*.yaml`），而不是堆砌无关引用。
- 解析规则的 `strength`、`platforms`、`source_version`、`conflicts_with` 与 `exceptions`。
- 为关键决策写简短说明，保留完整来源信息（`source_url` + `last_verified`）。
- 发现本地规则可能过期时，只查询对应官方来源核实，更新 `last_verified`；不得伪造来源、版本或核实日期（规范 10.2）。

## 裁决合成（规范 10.1 / 10.2）

- 来源分层优先级：法律安全硬性无障碍 > 平台官方规范 > 已激活的项目研究证据 > 品牌一致性 > 成熟可用性原则 > 趋势灵感。
- `strength` × `evidence_grade` 合成：`required` 一律遵守（仅更高优先层豁免）；`recommended` 默认遵守，被已激活的项目证据（A/B）冲突时可覆盖并记录；`heuristic` 可被任何更高证据或明确品牌/项目要求覆盖。
- 任何覆盖写入 `exceptions`（`rule_id` + `reason` + `risk` + `scope`）并在 `decisions` 记明 `is_override: true`、`decided_by`、`risk`。

## 输出契约

- 文件 `decisions.md`：每条关键决策含 摘要 · 引用的 `rule_id`（须能在依据库解析）· 证据等级 · 理由 · 决定人 · 覆盖与风险。
- **引用书写约定**：在 `decisions.md` 正文中引用规则一律写成 `[rule:<id>]`（如 `[rule:wcag-1.4.3-contrast-minimum]`、`[rule:craft-proximity-grouping]`）——验收脚本以此标记做权威追溯扫描。
- 补丁：同步 `context.decisions` 与 `context.exceptions`（`rule_ids` 数组），与 `decisions.md` 一一对应。

## 验收对齐（规范 18.2）

`decisions.md` 引用的每个 `rule_id` 必须能在依据库解析，且规则卡含 `source_url` 与 `last_verified`；抽查来源不得伪造或悬空（`acceptance.mjs --check-urls` 会在线核实引用来源可达）。
