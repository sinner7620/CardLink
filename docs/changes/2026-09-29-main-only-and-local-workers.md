# 仅同步 main，workers 保留本地

## 目的与实现

按用户要求，GitHub 远程只保留 main，以后获授权的 Git 同步直接使用 main；workers 不再进入 Git。

- 本地正式仓库切换为 main，跟踪 origin/main，并快进吸收此前已合并的清理提交。已合并的本地文档改动暂存于专用 stash，确认主分支已包含对应内容；未将其重新覆盖回主分支。
- 删除远端其他五个已合并分支，保留 Git 历史、版本标签、Release 和原有本地分支/工作区。
- 移除 .gitignore 对 workers 的白名单，显式忽略 workers/；仅从索引移除 workers/mnrails-telemetry.js，本机原文件保留。
- 更新 AGENTS.md 与工作流，明确 main 直接同步及 workers 本地保留约定。

## 验证与限制

- 核对旧远端分支均已包含在 main 中，检查远端最终仅有 main、本地上游为 origin/main。
- 检查 workers 本地文件存在、Git 索引及远端当前文件树无 workers 路径，忽略规则生效，差异空白检查通过。
- 只调整 Git 跟踪和工作流，不修改插件逻辑、版本、安装包或 Release；不改写旧提交中的 workers 历史。
- 保留工作区原有 build.mjs、RELEASE_NOTES_v2.4.3.md 删除状态及未跟踪的本地清理记录，不纳入本次提交。未运行应用测试、构建或真机验证。
