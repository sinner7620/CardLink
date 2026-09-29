# 错题答案定位与做题队列冻结

## 目的

错题详情的定位操作需要跟随题目/答案预览目标；做题中切换焦点不应缩减启动时选择的队列。

## 实现

- 错题详情题目页保留原 `openSource` 定位；答案页把当前候选的 `answerNoteId` 发送到 `openMistakeAnswer`，原生桥复用查找答案卡片已使用的 `focusNoteInFloatMindMap`。两个视图分别维护定位图标状态；缺少答案或浮窗接口不可用时返回明确提示。
- 快捷区在做题启动成功后冻结当时的题目树与所选 ID；做题中重新打开快捷区只读取该快照，不按焦点模式当前可见节点过滤队列。结束做题或学习集关闭时清理快照。

## 影响与兼容

- `web/src/main.jsx`、`src/rails-core.ts`、`src/mnutils-entrance.ts`；说明同步至错题本与工具栏文档。错题数据、绑定和设置格式不变。

## 验证与限制

- `pnpm check` 通过；现有相关测试 70 项通过（`web-bridge`、`web-render-smoke`、`plugin-events`、`same-map-practice`）；`pnpm build` 通过。浏览器预览确认题目页为“定位原题”，答案页为“定位答案”，且答案候选选择入口保留。`git diff --check` 通过；安装包内 `mnaddon.json` 确认版本 2.4.4-b23、稳定通道插件 ID 与标题。
- 安装包已复制到 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.4-b23.mnaddon`。
- MarginNote iPad 尚未连接，答案浮窗定位及焦点切换后的原生队列点击需设备复测。
