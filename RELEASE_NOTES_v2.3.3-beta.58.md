# v2.3.3-beta.58

## 启动传输、日志导出与功能清理（2026-09-02）

- dashboard 启动响应只携带首批 25 道错题；页面完成首屏绘制后通过 `mistakesPage` 从同一原生快照继续分页载入，避免完整错题 JSON 触发大量 32KB 桥分块串行拉取。
- 日志导出恢复 beta.2 的既有实现：`writeTextFile()` 完成后直接调用 `saveFile()`；撤回 beta.57 新增的 50ms 延迟任务。
- 完整删除未经需求确认加入的“组卷”功能，包括页签、React 页面、领域层、桥命令、样式、预览 mock、测试和功能文档。
- 分页使用 60 秒快照有效期和传输 ID，刷新会替换旧快照，避免不同批次记录混合。
- 版本迭代为 `2.3.3-beta.58`。

验证：`pnpm check`、158/158 自动化测试、Playwright 920px/500px 可视检查和生产构建通过。MarginNote 真机的冷启动时间、数百题续传过程及系统保存面板弹出速度仍需安装后复核。

完整记录见 `docs/changes/2026-09-02-beta58-paged-startup-log-and-paper-removal.md`。
