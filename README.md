# beansmile-design

`beansmile-design` 是一套运行在 Codex 或 Claude 中的设计 Agent 运行时。它从业务目标、用户任务和目标平台出发，把产品需求转化为可点击、响应式、高保真的 HTML 原型，以及包含决策依据、截图、评审结果和验收报告的可审计交付包。

它不是生产前端框架，也不直接生成生产级 Web、原生 App 或小程序代码。项目重点解决的是设计过程的一致性、可追溯性和质量验收。

## 核心能力

| 组成 | 作用 |
|---|---|
| Design Director | 维护任务状态、调度各阶段、记录用户确认并作出最终设计裁决 |
| 5 个流程 Skills | 完成需求研究、UX 架构、视觉系统、HTML 原型和决策记录 |
| 2 个只读评审 | 分别执行规范审计和视觉评审，避免创作方自行判定通过 |
| 版本化依据库 | 管理 WCAG、平台规范、设计工艺和行业规则 |
| 可执行质量门 | 校验上下文、字段权限、阶段转换、浏览器行为、快照、评审和最终交付 |

支持的目标平台包括：

- Web
- 响应式移动 Web
- iOS App
- Android App
- 微信小程序

Web 和响应式移动 Web 具备完整的浏览器自动化检查链路。原生 App 与微信小程序以 HTML 近似原型表达，其中无法由 HTML 忠实验证的系统控件、原生手势、安全区和运行时行为需要人工清单或真机验证。

## 快速开始

### 1. 环境要求

- Node.js 18 或更高版本
- npm
- Chrome，或由 Playwright 安装的 Chromium

安装依赖：

```bash
npm install
```

如果本机没有可用的 Chrome/Chromium，可安装 Playwright 对应的浏览器：

```bash
npx playwright install chromium
```

### 2. 验证运行环境

```bash
npm run check
npm test
npm run env:check
```

`env:check` 会真实启动一次浏览器，而不只是检查依赖是否存在：

- 退出码 `0`：Node、Playwright、axe-core 和浏览器自动化均可用。
- 退出码 `3`：进入降级状态，浏览器相关结论只能标为“未验证”，任务不能标记为已完成。
- 其他非零退出码：命令失败，需要先修复环境或参数问题。

### 3. 在 Claude Code 或 Codex 中启用 Skills

Skill 定义遵循 [Agent Skills 开放标准](https://agentskills.io)（SKILL.md 格式），Claude Code 和 Codex CLI 都原生支持。运行一次：

```bash
npm run setup:agents
```

该命令把 `skills/` 下的 8 个 Skill 以相对符号链接挂进 `.claude/skills/` 和 `.codex/skills/`（两个目录已被 Git 忽略，每位使用者在自己的克隆里运行一次即可）。命令幂等，新增 Skill 后重跑一次即可更新。

之后**在仓库根目录**开启会话：

| 工具 | 调用方式 |
|---|---|
| Claude Code | `/design-director`，或直接描述设计任务（按 description 自动触发） |
| Codex CLI | `$design-director`，或用 `/skills` 选择器浏览 |

注意：所有 Skill 中的脚本命令都假定当前目录是本仓库根目录，会话必须从这里启动；交付包目录则可以通过 `--package` 指向任意位置。

### 4. 初始化交付包

下面的示例会在 `outputs/demo` 创建专业模式的 Web 交付包。`outputs/` 已被 Git 忽略，可以替换为其他目录。

```bash
npm run init -- \
  --package outputs/demo \
  --name "示例项目" \
  --mode professional \
  --task-type new_design \
  --platforms web,mobile_web \
  --primary-user "需要完成核心任务的目标用户" \
  --industry general
```

可选值：

- `--mode`：`professional` 或 `quick`
- `--task-type`：`new_design` 或 `redesign`
- `--platforms`：`web`、`mobile_web`、`ios`、`android`、`mini_program`，多个值用逗号分隔
- `--industry`：已有行业规则包为 `ecommerce`、`saas_b2b`；通用产品使用 `general`

初始化后验证上下文：

```bash
npm run validate:context -- outputs/demo/context.yaml
```

### 5. 启动设计任务

主会话入口是 `design-director` Skill：在 Claude Code 中输入 `/design-director`，在 Codex 中输入 `$design-director`，由它按阶段调度其余 Skill。未启用 Skill 机制时，也可以直接让 Agent 阅读 [`skills/design-director/SKILL.md`](skills/design-director/SKILL.md)。示例任务描述：

```text
请按 design-director 的专业模式执行设计任务。
交付包目录使用 outputs/demo，目标平台为 web 和 mobile_web。
从需求澄清开始，一次只问一个需要我决定的问题，并在每个确认门等待我的答复。
```

初始化只创建交付包骨架。此时运行最终验收会因缺少阶段产物、浏览器结果、快照和双评审而失败，这是预期行为。完整流程结束后再运行：

```bash
npm run accept -- --package outputs/demo
```

## 文档导航

| 文档 | 面向读者 | 内容 |
|---|---|---|
| [使用指南](docs/usage.md) | 执行设计任务的使用者 | 完整工作流（专业/快速模式与确认门）、常用命令、交付包结构、平台验证边界 |
| [开发指南](docs/development.md) | 维护和扩展项目的开发者 | 项目结构、核心契约（单一事实源、门禁、版本绑定）、开发与扩展入口、测试与验收 |

## 延伸文档

- [设计 Agent 系统设计规范](docs/superpowers/specs/2026-07-24-design-agent-system-design.md)
- [README 内容设计规范](docs/superpowers/specs/2026-07-25-readme-design.md)
- [Design Director 使用说明](skills/design-director/SKILL.md)
- [Skill 注册表](skills/registry.yaml)
