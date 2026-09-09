# beta.58 分页启动、日志回归与组卷清理

日期：2026-09-02  
版本：2.3.3-beta.58

## 目的

处理三个真机反馈：删除未经需求确认加入的“组卷”；查清并修复日志导出相较 beta.2 的延迟；解决启动时完整错题数据全量传输导致的长时间白屏。

## 原因核查

### 组卷来源

- Git 提交历史中不存在已发布的 `MistakePaperBuilder` 记录；该功能来自 2026-09-02 的 beta.56 本地开发改动，并未源自最初交接范围。
- 活跃实现曾横跨 `src/mistake-paper*.ts`、`rails-core` 桥命令、React 页签、独立 CSS、预览 mock 和测试，现已连同文档入口一起删除。

### 日志导出

- `v2.3.3-beta.2` 的实现是 `writeTextFile(path, ...)` 后直接 `saveFile(path, "public.plain-text")` 并返回 `{ saved: true }`。
- beta.57 把保存器改为 `delay(0.05).then(saveFile)` 并提前返回 `{ queued: true }`。这不是 beta.2 的范例，而且真机复测未改善弹出速度，因此 beta.58 精确恢复旧调用顺序。
- Web 端继续使用独立 `MNBridge.send("exportRuntimeLog")`，不套用页面全局 busy 状态，避免保存期间遮住全部 UI。

### 启动白屏与全量传输

- beta.57 虽把首次 dashboard 推迟到外壳绘制后，却仍在一个响应内返回全部错题记录。
- 原生桥对超过 48,000 字符的响应切成 32,000 字符分块；Web 端必须逐块、串行发起 `__pullResponseChunk`，全部拼接并解析后才能拿到数据。错题数及每题历史字段增长后，这条全量链路会明显占用 UIWebView/JSB 主线程。
- beta.58 在原生端只计算一次完整工作台快照，启动响应只返回前 25 道及完整汇总；Web 端立即提交 React 并等待一次绘制，然后循环请求后续页面并逐页合并。

## 实现

- `beginMistakeWorkbenchTransfer()` 创建带传输 ID 的只读快照并返回第一页。
- `continueMistakeWorkbenchTransfer()` 仅从该快照切片，不重复读取存储、计算分类或排序。
- 快照 60 秒失效；新 dashboard 替换旧快照，旧请求不会污染新页面。
- 顶栏错题总数读取 `totalCount`；续传期间右下角显示“正在载入错题 x/总数”。
- 浏览器预览桥同步实现分页协议。
- 移除全部组卷源码、样式、桥协议、预览数据、测试与 beta.56 活跃发布说明。

## 影响文件

- `src/mistake-manager.ts`
- `src/rails-core.ts`
- `src/note-navigation.ts`
- `web/src/main.jsx`
- `web/src/ui/shell.css`
- `web/src/lib/previewBridge.js`
- `tests/bridge-schema.test.ts`
- `tests/mistake-performance.test.ts`
- `tests/web-bridge.test.ts`
- `tests/web-render-smoke.test.ts`
- `package.json`
- `README.md`、`docs/README.md`、`交接文档.md`

删除：`src/mistake-paper-domain.ts`、`src/mistake-paper.ts`、`web/src/ui/paper.css`、`tests/mistake-paper.test.ts`、原组卷变更文档。

## 兼容性与数据影响

- 不修改错题记录、复习历史、答案绑定、共享存储格式或导出日志内容。
- `mistakes` 命令保留但改为返回分页首批，避免旧入口再次触发全量响应。
- 新增内部桥命令 `mistakesPage`；只读，不写用户数据。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过，158/158。
- Playwright（Microsoft Edge 通道）验证 920×900 与 500×900：面板正常首屏渲染，顶栏无“组卷”页签，窄窗布局未引入横向溢出。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.58.mnaddon`。

## 真机复核

- 浏览器预览无法复现 MarginNote 的 UIWebView/JSB 分块耗时和系统文件保存器；安装 beta.58 后需重点记录首次打开到出现前 25 道的时间、全部题目续传完成时间，以及点击日志导出到保存面板弹出的时间。
