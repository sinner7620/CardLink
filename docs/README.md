# CardLink 代码文档

> 开发规则以 [AGENTS.md](../AGENTS.md) 和 [验证与交付流程](workflow.md) 为准。产品版本读取 [package.json](../package.json)。模块与页面说明多数起始于 2.3.3-beta.71，未全量复核，不代表当前代码逐文件一致。

## 文档地图

| 目录 | 内容 |
|---|---|
| [modules/](modules/) | **模块参考**：职责、关键导出、边界和验收，按 src · web · native 三层组织；按相关契约变化维护 |
| [pages/](pages/) | **功能页文档**：面板主页与全部功能页的结构、数据流、边界、验收 |
| [design/](design/) | **设计规范**：Apple 设计准则对照、设计令牌速查、交互与动效规范 |
| [changes/](changes/) | **逐轮变更记录**：每次修改的目的、实现、影响、验证与未验证项 |
| [acceptance.md](acceptance.md) | **验收标准**（按功能页，含统一前置） |
| [boundaries.md](boundaries.md) | **边界与设计决策**（明确不做 / deferred / 数据·口径·隐私·平台边界） |
| [workflow.md](workflow.md) | **开发流程**：验证范围、版本与交付、历史文档和工作区整理 |

## 功能页（主页与页面）

| 页面 | 入口 | 文档 |
|---|---|---|
| **面板主页**（错题本，默认页签） | main.jsx `MistakeBrowser` + `MistakeDetail` | [pages/browse.md](pages/browse.md) |
| 面板壳与导航 | main.jsx `App` | [pages/panel-home.md](pages/panel-home.md) |
| 总览 | `MistakeOverview` | [pages/overview.md](pages/overview.md) |
| 待复习 | `DueReviewList` | [pages/review.md](pages/review.md) |
| 设置 | 设置页签 | [pages/settings.md](pages/settings.md) |
| 导出 | `MistakeExport` | [pages/export.md](pages/export.md) |
| 答题卡（浮层） | `showAnswerCard` | [pages/answer-card.md](pages/answer-card.md) |
| 悬浮工具栏（浮层） | `showAnswerToolbar` | [pages/toolbar.md](pages/toolbar.md) |

## 模块索引

### src/（插件核心，TypeScript）
- [src/answer-card-layout](modules/src/answer-card-layout.md)
- [src/answer-card-view](modules/src/answer-card-view.md)
- [src/answer-lookup](modules/src/answer-lookup.md)
- [src/base64](modules/src/base64.md)
- [src/binding](modules/src/binding.md)
- [src/card-html](modules/src/card-html.md)
- [src/card-markdown](modules/src/card-markdown.md)
- [src/domain](modules/src/domain.md)
- [src/error-messages](modules/src/error-messages.md)
- [src/floating-toolbar](modules/src/floating-toolbar.md)
- [src/globals.d](modules/src/globals.d.md)
- [src/index-store](modules/src/index-store.md)
- [src/level-picker](modules/src/level-picker.md)
- [src/main](modules/src/main.md)
- [src/markdown](modules/src/markdown.md)
- [src/matcher](modules/src/matcher.md)
- [src/mindmap-candidate](modules/src/mindmap-candidate.md)
- [src/mindmap-scope](modules/src/mindmap-scope.md)
- [src/mistake-domain](modules/src/mistake-domain.md)
- [src/mistake-export](modules/src/mistake-export.md)
- [src/mistake-manager](modules/src/mistake-manager.md)
- [src/mistake-review-settings](modules/src/mistake-review-settings.md)
- [src/mistake-store](modules/src/mistake-store.md)
- [src/mistake-tags](modules/src/mistake-tags.md)
- [src/note-link](modules/src/note-link.md)
- [src/note-navigation](modules/src/note-navigation.md)
- [src/note-tree](modules/src/note-tree.md)
- [src/notebook-picker](modules/src/notebook-picker.md)
- [src/ordered-pairing-domain](modules/src/ordered-pairing-domain.md)
- [src/ordered-pairing](modules/src/ordered-pairing.md)
- [src/pkdrawing-core-webview](modules/src/pkdrawing-core-webview.md)
- [src/pkdrawing-core](modules/src/pkdrawing-core.md)
- [src/pkdrawing-renderer](modules/src/pkdrawing-renderer.md)
- [src/pkdrawing-svg](modules/src/pkdrawing-svg.md)
- [src/plugin](modules/src/plugin.md)
- [src/rails-core](modules/src/rails-core.md)
- [src/regex-matching](modules/src/regex-matching.md)
- [src/safe-note](modules/src/safe-note.md)
- [src/scope-key](modules/src/scope-key.md)
- [src/session-state](modules/src/session-state.md)
- [src/settings](modules/src/settings.md)
- [src/source-insights](modules/src/source-insights.md)
- [src/store](modules/src/store.md)
- [src/telemetry](modules/src/telemetry.md)
- [src/ui-tokens](modules/src/ui-tokens.md)
- [src/updater](modules/src/updater.md)
- [src/version](modules/src/version.md)

### web/src（面板前端）
- [web/a11y](modules/web/a11y.md)
- [web/card-preview](modules/web/card-preview.md)
- [web/review-detail-cache](modules/web/review-detail-cache.md)
- [web/icons](modules/web/icons.md)
- [web/lib](modules/web/lib)
- [web/main](modules/web/main.md)
- [web/morphicons-vendor](modules/web/morphicons-vendor.md)
- [web/ui-styles](modules/web/ui-styles.md)
- [web/preview-favorites](modules/web/preview-favorites.md)
- [web/tokens](modules/web/tokens.md)

### rails-native/（原生层）
- [native/WebAddon](modules/native/WebAddon.md)
- [native/WebBridgeCommands](modules/native/WebBridgeCommands.md)
- [native/WebPanelController](modules/native/WebPanelController.md)
- [native/main](modules/native/main.md)
- [native/ui-constants](modules/native/ui-constants.md)

## 关键链路速查

- 查答案：工具栏 → findCurrentAnswer → resolveAnswerLookupContext → findAnswersForQuestion → showAnswerCard
- 标记错题：工具栏 → markSelectedQuestions → markQuestionAsMistake(s) → commitSourceTagTasks → mistake-store
- 复习/改级：面板/工具栏 → reviewMistakeById → reviewMistake（domain 纯函数）→ 标签写入 → store
- 标签恢复：设置「刷新错题分类索引」→ repairAndOrganizeMistakes → recoverMistakesFromTags（只增不删）
- 导出：导出页 → exportMistakes/previewMistakeExport → 任务式 PDF（pdfTaskStatus 轮询）/ MD 打包
- 更新：检查更新 → GitHub→Gitee 回退 → 体积校验 → 系统保存面板

## 维护约定

- 任务记录、验证和交付按 [AGENTS.md](../AGENTS.md) 与 [workflow.md](workflow.md) 执行，不在本索引重复定义门槛。
- 改主题：只改 web/src/ui/tokens.css（+ 原生侧 src/ui-tokens.ts）
- 面板样式按 `web/src/ui/` 页面所有权维护；禁止恢复全局覆盖层
- 新增桥接命令：rails-core bridge 分发 + WebBridgeCommands（如涉及面板）+ tests/bridge-schema.test.ts 白名单
- 架构、接口或用户行为改变时更新相关说明；无需为每个新增代码文件建立同名文档。

## 历史资料

`docs/2026-*.md` 调查报告、`handover-detail-ui.md`、根目录旧交接/重构材料，以及 `changes/` 和 `RELEASE_NOTES_v*.md` 都按各自日期与版本解读。它们不是当前缺陷清单，也不授权自动继续整改。本轮未审查业务代码，旧结论是否仍成立需在相关任务中核对。
