# AI OCR 渲染器与学习集过滤修复

## 变更目的

修复 AI 配置页找不到题目卡片渲染组件的问题，并严格把 OCR 范围限制为“指定学习集内已有的错题”：没有错题的学习集不出现在候选中，也不能从原生接口启动 OCR。

## 已实现行为

- `html2canvas` 改为由 AI 配置页主应用直接导入并编入 `app.js`，不再读取只在 PDF 导出 WebView 中注册的 `window.html2canvas`。
- Node 渲染冒烟构建为 `html2canvas` 提供专用空实现，既保持生产包真实依赖，也避免服务端测试环境访问不存在的浏览器 DOM。
- 新增专供 OCR 使用的 `aiListMistakeStudySets`：根据错题主库按 `sourceNotebookId` 聚合，只返回错题数大于零、且当前仍存在的脑图学习集；原有科目配置仍使用 `aiListStudySets` 查看全部学习集。
- 学习集候选返回 `mistakeCount`；下拉框显示“学习集名称（N 题）”。
- `aiStartQuestionPreparation` 在创建任务前再次按学习集过滤错题；结果为空时立即拒绝，不调用 MinerU。
- 无候选学习集时显示“当前没有包含错题的学习集，无需 OCR”，开始按钮保持禁用。
- 浏览器预览数据及 AI 子系统回归测试同步更新。

## 影响文件与模块

- `web/src/main.jsx`：直接导入卡片渲染器、候选数量与空状态。
- `src/ai-subsystem.ts`：学习集错题数量聚合和启动前零错题拦截。
- `scripts/build-web-smoke.mjs`：Node 冒烟环境的渲染器 stub。
- `web/src/lib/previewBridge.js`：候选学习集错题数量。
- `web/src/ui/settings.css`：无候选学习集提示样式。
- `tests/ai-subsystem.test.ts`：渲染器打包和学习集过滤回归断言。
- `package.json`、`RELEASE_NOTES_v2.4.1b3.md`：版本与发布说明。

## 兼容与数据影响

- 版本升级为 `2.4.1b3`；`mnChannel` 仍为 `stable`，正式插件 ID 与标题不变。
- 不修改错题主库、已准备题目文本或报告的数据结构。
- 学习集过滤使用现有错题记录，不会为了判断候选而发起 OCR。

## 验证

- `pnpm check`：通过。
- 定向测试 `tests/ai-subsystem.test.ts`、`tests/bridge-schema.test.ts`、`tests/web-render-smoke.test.ts`：通过，49/49。
- `pnpm test`：通过，223/223。
- `pnpm build`：通过；保留既有 `.sfIconGlyph:svg` CSS 选择器警告，不影响产物生成。
- 生产 `web-dist/app.js` 已核对：包含 `html2canvas` 实现，且不再包含“题目卡片渲染组件未加载”错误分支。
- 构建产物：`E:\project\MN\dist\CardLink-v2.4.1b3.mnaddon`，570,473 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.1b3.mnaddon`，570,473 字节。
- 两份文件 SHA-256 一致：`7B9823EAE01BE6AD62162E7055FC4795B0955DD92F875E65578A23894F4D2269`。
- 包内 `mnaddon.json` 已核对：正式插件 ID `marginnote.extension.mn4-answer-matcher`、标题 `CardLink`、版本 `2.4.1b3`。

## 未验证限制

- 当前环境无法替代 MarginNote 4 真机和真实 MinerU 服务，真实卡片上传与识别仍需真机复验。
