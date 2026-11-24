# ADR-0001：零依赖 SQLite（node:sqlite）与 npm 隔离安装

- 状态：已接受（2026-11-12）
- 背景：H1 需要本地持久化（会话事件、审计、只读投影）。插件根目录使用 pnpm 工作区（pnpm-workspace.yaml），`pnpm install` 在子目录会落到根工作区；better-sqlite3 等原生依赖引入构建链。
- 决策：
  1. 使用 Node >= 22 内置 `node:sqlite`（DatabaseSync），Harness 运行时依赖为零，类型检查/测试仅 devDependencies（typescript/tsx/@types）。
  2. Harness 在 `cardlink-harness/` 用 **npm** 独立安装（脱离插件 pnpm 工作区），不修改根 pnpm 配置与锁文件；`web/` 前端同样 npm 安装。
  3. 仓库 .gitignore 白名单已加入 `!/cardlink-harness/`；node_modules/dist/.env 由全局规则忽略。
- 后果：Node 版本需 >= 22.5（实验性 SQLite 警告可忽略）；若未来升级 Node 主版本需回归 `tests/contract` 与 `tests/application/statistics`。
