# beta.57 启动、日志、列表与答案视口修复

> 复测补记：日志延迟调起与“先画外壳、再完整传输”的方案未解决真机卡顿/白屏，已在 beta.58 分别恢复 beta.2 直接保存路径并替换为分页续传。

日期：2026-09-02  
版本：2.3.3-beta.57

## 目的

修复运行日志导出卡死缓慢、软件重启后插件长时间白屏、错题列表信息顺序不符合三行结构，以及待复习答案窗口与实际 iframe 显示区域不一致的问题。

## 已实现

### 日志导出

- 日志文本仍由既有 `runtimeLogText()` 与 `writeTextFile()` 生成，不复制日志实现。
- `exportNavigationRuntimeLog()` 写完文件后立即返回 `{ queued: true }`，通过既有 `delay()` 延后调起 `saveFile()`；系统保存面板不再阻塞 Web 桥接响应。
- Web 端日志导出使用独立轻量请求，不进入全局 `busy` 遮罩；失败仍进入原有错误提示和运行诊断通道。

### 冷启动

- React 外壳完成两个动画帧后才发出首次 dashboard 请求，保证顶栏和页面骨架先显示。
- 增加首次加载完成标记，初次 `__onPanelShow` 不再叠加第二次 dashboard 请求。
- 原生 WebPanel 用 `webReady` 区分首次加载和后续重新显示；仅后者触发刷新，沿用既有面板生命周期。

### 错题列表

- 第一行：题目标题、三档等级。
- 第二行：自动来源路径；原卡不可用提示仍追加在此行。
- 第三行：剩余天数/到期状态、收藏状态、自定义标签。
- 第三行只在字段存在时插入点号；收藏题显示星标与“已收藏”，不收藏时不保留空位。

### 待复习答案

- 新增 `reviewAnswerViewport` 作为答案显示区的唯一尺寸所有者，响应式高度为 `clamp(340px, 48vh, 520px)`。
- iframe 强制与视口保持 100% 宽高；移除原有互相覆盖的 420px/520px iframe 高度规则。
- 答案缩放继续复用现有 `wireReviewAnswerFrame` 与共享 pinch-zoom 管线，仅缩放 iframe 内内容，不带动外层窗口变化。

## 影响文件

- `src/note-navigation.ts`
- `web/src/main.jsx`
- `web/src/ui/mistakes.css`
- `web/src/ui/review.css`
- `web/src/lib/previewBridge.js`
- `rails-native/WebPanelController.js`
- `tests/web-bridge.test.ts`
- `package.json`
- `README.md`、`docs/README.md`、`交接文档.md`
- `RELEASE_NOTES_v2.3.3-beta.57.md`

## 兼容性与数据影响

- 不修改错题记录、复习历史、答案绑定、共享存储格式或桥接命令名。
- 日志导出返回语义由“系统保存已调用”收口为“保存任务已排队”；用户操作入口和生成文件名不变。
- 版本由 beta.56 迭代为 beta.57。

## 验证

- `pnpm check` 通过。
- `pnpm test` 通过，162/162。
- Playwright 验证 920px 与 500px 列表/待复习页面；三行信息顺序正确，收藏状态无空位。
- Playwright 计算样式验证：920px 下答案视口与 iframe 均为 `806 × 432px`；500px 下均为 `418 × 432px`。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.57.mnaddon`。

## 未验证限制

- 浏览器预览无法复现 MarginNote 的系统文件保存器阻塞行为和应用级冷启动；相关调用顺序已有自动化约束，仍需在真机安装 beta.57 后复核实际耗时。
