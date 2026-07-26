# site/ · GitHub Pages 发布目录

本目录是项目介绍 landing page 的**部署副本**，由 `.github/workflows/deploy-pages.yml` 发布到 GitHub Pages。

- 事实源：`outputs/design-agent-landing/`（本地交付包，已 gitignore）——该页面由本仓库的设计 Agent 系统自产自审（快速模式，v4 通过 `acceptance.mjs` 全部 19 项验收，评审链与截图证据在交付包 `audit/` 内）。
- **不要手改 `site/index.html`**：修订应回到交付包按流程升版（截图自评 → browser-check → 快照 → 双评审 → 验收）后重新拷贝到此处。
