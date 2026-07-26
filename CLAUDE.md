# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

这是一套设计 Agent **运行时**（Node.js ≥18，ESM，无构建步骤）：`skills/` 下的 SKILL.md 是给 Agent 执行的提示层，`scripts/` 下是强制执行这些承诺的机器门禁。核心设计原则：**Skill 提示词里写的任何质量要求，都必须有对应的机器校验**——改 Skill 行为时几乎总是要同步改 scripts 和测试。

系统架构与历次增补（v1.1 生成质量层 → v1.4 覆盖证明层）的权威记录在 `docs/superpowers/specs/2026-07-24-design-agent-system-design.md`（本地工作文档，`docs/superpowers/` 已 gitignore 不入库）。该文档按版本号追加章节，不重写历史章节；新增门禁时先在这里补规范。

## 常用命令

```bash
npm test                                  # Node 内置测试套件（scripts/test/*.test.mjs）
node --test scripts/test/gates.test.mjs   # 运行单个测试文件
npm run check                             # 校验依据库、Skill manifest 与注册表一致性
npm run validate:rules                    # 校验 evidence/rules/ 规则卡
npm run env:check                         # 真实启动浏览器探测能力（退出码 3 = 降级）
npm run recall -- --out /tmp/recall.json  # 对 fixtures/blockers 跑召回/误报测试
npm run setup:agents                      # 把 skills/ 链接进 .claude/skills 与 .codex/skills（幂等）
```

提交前至少跑 `npm run check && npm test && npm run validate:rules`。交付包相关命令（init/shot/browser:check/snapshot/review:record/accept 等）见 `docs/usage.md`「常用命令」表。

**退出码语义**（浏览器相关脚本统一）：`0` 通过、`1` 有失败项、`2` 参数错误、`3` 浏览器能力不可用（结论只能记「未验证」，不能记为通过）。浏览器环境在本机已修复可用，不要往降级路径上退。

## 架构契约（跨文件才能看懂的部分)

**角色注册与 ID 约定**：`skills/registry.yaml` 是唯一注册表。内部脚本（manifest、diff gate、Director 调度、快照/评审绑定）一律用 canonical snake_case ID（如 `html_prototype`），目录和 Skill 工具名用连字符（`html-prototype`）——传错会直接失败。角色分三类：1 个 director、5 个 flow Skill、2 个只读 reviewer。

**单一事实源与补丁门禁**：每个交付包只有 `context.yaml` 一个可写状态文件。流程 Skill 不直接写它，只产出补丁；只有 Director 经 `check-diff-gate.mjs` → `apply-patch.mjs` 合并。门禁依次检查：改动路径在该 Skill 的 `writes` 白名单内（`schemas/skill-manifests.yaml`）、合并后符合 `context.schema.json`、阶段转换合法且确认门已记录、`artifact_version` 单调递增。

**版本绑定**：评审后修改 `prototype/` 或 `design-tokens.json` 必须升级 `artifact_version`，并重做截图自评、浏览器检查、快照和评审——`acceptance.mjs` 会校验所有产物绑定当前版本。首版与拟交付版走全量双评审；中间版本可用 delta 增量评审（`snapshot --delta-from` + `review:record --delta`，规范 27.5），验收「迭代评审链」维度核对链完整，delta 结论不进最终验收。

**创作与评审分离**：standards/visual 两个 reviewer 只能读 `audit/snapshots/<version>/` 的冻结快照，互相不可见，不能改原型。findings 经 `record-findings.mjs` 落盘，schema 校验之外还有语义校验（`scripts/lib/findings.mjs`）：截图 sha256 匹配、standards 评审的 `rule_coverage` 矩阵必须逐条覆盖目标平台+行业包的全部适用规则、fail 与 blocker/warning finding 双向一致。

**依据库**：`evidence/rules/*.yaml` 规则卡受 `rule-card.schema.json` 约束（稳定 ID、platforms、strength、evidence_grade、source_url、last_verified）。行业包命名 `industry-<slug>.yaml`；`context.project.industry` 的 slug 用下划线（`saas_b2b`），匹配文件名时归一为连字符。行业规则只叠加领域纪律，不得覆盖 WCAG/平台规范。

**诚实降级**：任何无法真实验证的检查（浏览器不可用、原生平台行为、未备包行业）必须显式记「未验证」，不允许静默记为通过——这是验收的「环境诚实」维度，测试里有对抗性用例守着。

## 修改指南

- **改/加 Skill**：`skills/<dir>/SKILL.md` → `registry.yaml` 登记 → flow Skill 同步 `skill-manifests.yaml` 白名单与产物 → 涉及新上下文字段再改 `context.schema.json` + 门禁逻辑 + 测试 → `npm run check && npm test`。
- **改门禁/校验语义**：共享逻辑在 `scripts/lib/`；在 `scripts/test/` 同时加正向和对抗性用例（伪造哈希、自相矛盾的矩阵、越权补丁等），不要只覆盖现有 fixture 的形状。
- 提交信息沿用 `feat:`/`docs:` 前缀 + 中文正文的既有风格。
