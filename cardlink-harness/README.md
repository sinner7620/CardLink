# CardLink Agent Harness — H1

错题只读分析 Agent 服务（单 Agent / 双角色 / 只读工具 / 持久化会话 / 可追溯证据）。
设计规范：[docs/design/cardlink-harness-h1.md](../../docs/design/cardlink-harness-h1.md)（v1.3，AGENTS.md 强制引用）。

## 运行

```bash
# 前置：Node >= 22（使用内置 node:sqlite）；本目录用 npm 独立安装（脱离插件 pnpm 工作区）
npm install
npm run check          # tsc --noEmit
npm test               # H1-T01–T22（61 个断言组）
cp .env.example .env   # 配置模型网关 / 令牌 / 数据库路径（.env 不入库）
npm run serve          # http://127.0.0.1:7310（仅回环；web/dist 构建后自动托管 UI）
npm run h1 -- import data/smoke-snapshot.json   # CLI 导入快照
npm run h1 -- stats --stats-time "2026-11-12T22:00:00+08:00" --timezone Asia/Shanghai
npm run test:live      # 活体模型冒烟（H1_LIVE_MODEL=1）
```

## 结构（规范 §15）

- `src/domain/` 纯 TS 契约（RecordId、AgentMessage 三类、ToolCall/ToolResult、Decision、Context<T>、ModelSetting、MistakeRecord 投影、ToolEnvelope）——冻结接口，改动需规范修订。
- `src/application/` AgentService 运行循环、双角色、PolicyGuard、ToolExecutor、EvidenceValidator、StatisticsEngine、SyncService、ports/。
- `src/adapters/` cardlink（快照导入）、sqlite（node:sqlite，WAL+外键+迁移）、model（OpenAI 兼容 + Fake）、http、cli。
- `src/tools/` 五个只读工具（白名单硬编码于 ToolRegistry）。
- `web/` 前端（React + Tailwind v4 + shadcn/ui 复制式组件，§3.1），构建产物 `web/dist` 由服务托管。
- `tests/` 领域/契约/应用/集成四层，Fixture 100 条确定性记录与独立人工基准。

## 阶段状态（§17）

| 阶段 | 状态 |
| --- | --- |
| P1 领域与持久化 | ✅ 完成（Fake/SQLite 契约测试一致） |
| P2 确定性工具 | ✅ 完成（导入幂等/缺失标记/recordId 修复/统计口径与人工基准一致） |
| P3 Agent 闭环 | ✅ FakeModel 全覆盖 + OpenAI 兼容适配器协议级测试；活体冒烟待上游额度（429） |
| P4 UI 与联调 | ✅ HTTP+CLI+UI 可用；**真机侧导出/桥接未开始**（P0 真实数据待用户提供） |

## 安全边界（必须遵守）

- 只读：对 CardLink/MarginNote 无任何写路径；`CardLinkBridge` 显式未启用（调用即抛错）。
- 模型仅见五个白名单工具 Schema；无 SQL/Shell。
- `PolicyGuard` 先于 Reviewer 且批准后复核；Reviewer 失败关闭（按拒绝处理）。
- 服务仅绑定回环地址；除健康检查与静态资源外要求 Bearer 令牌；固定允许来源。
- 模型密钥只在服务端环境变量/.env（gitignored），不进仓库、日志与前端。
- 真实设备数据（导出/备份文件）必须由用户提供，不得经 MN Bridge 获取。
