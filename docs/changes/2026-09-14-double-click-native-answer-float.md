# 双击“查找答案”按钮在原生浮窗定位答案

## 目的

让用户双击题目卡片旁的“查找答案”按钮后，直接在 MarginNote 原生“卡片源”浮窗定位已绑定的答案卡片；当已绑定答案脑图但刷新索引后仍无匹配答案时，可确认生成一张待填写的答案卡片。

## 已实现行为

- “查找答案”按钮安装双击手势，不再监听脑图视图或脑图卡片双击。
- 单击“查找答案”延迟到双击判定结束后执行，继续打开原有 CardLink 答案窗口；双击会取消待执行单击并改走原生浮窗，避免两个答案窗口同时出现。
- 双击命中的最佳答案优先调用运行时 `focusNoteInFloatMindMapById(noteId)`。调用前检查方法是否存在；接口缺失或抛错时回退到 CardLink 自带答案窗口，不切换主脑图。
- 无匹配结果时沿用用户确认后才刷新索引的既有约束。刷新后仍未找到才询问是否生成答案卡片，避免旧索引导致误建。
- 生成操作使用 MarginNote 的 `cloneNotesToTopic` 将当前题目卡片复制到绑定答案学习集，保留题目节点内容与标题；随后刷新数据库、答案索引并定位新卡片。
- 若答案脑图中存在唯一且层级标题完全对应的父分支，生成卡片直接挂到该分支；不会复制新的分支。若同名同层级分支不唯一，则不猜测，卡片挂到已绑定答案根节点（无具体根绑定时保持为答案学习集根卡片）。
- 同一题目的并发生成请求使用运行时键去重，避免重复双击造成两次复制。

## 影响文件

- `src/plugin.ts`：双击识别、缺失答案确认、答案卡片生成与分支复用。
- `src/note-navigation.ts`：原生浮窗运行时 API 的功能探测与安全调用。
- `src/answer-card-creation.ts`：可测试的同层级唯一分支选择规则。
- `tests/answer-card-creation.test.ts`、`tests/plugin-events.test.ts`：分支复用及原生桥接结构测试。
- `package.json`：将新增行为测试纳入完整测试命令。

## 兼容性与数据影响

- `focusNoteInFloatMindMapById` 未进入公开 npm 类型定义，因此仅通过运行时功能探测调用；缺失时保留现有自绘答案窗口。
- 只有用户在“刷新后仍未匹配”的确认框中选择“生成答案卡片”才会写入答案脑图。
- 已有唯一同分支会被复用，不生成重复分支。插件本轮不会自动创建缺失的章节分支。

## 验证

- `pnpm check`：通过。
- `pnpm test`：通过，268 项测试全部通过。
- `pnpm exec tsx --experimental-test-module-mocks --test tests/answer-card-creation.test.ts tests/plugin-events.test.ts`：通过，25 项相关测试全部通过。
- `pnpm build`：通过，生成 `dist/CardLink-v2.4.2.mnaddon`；Vite 同时报告既有 `.sfIconGlyph:svg` 选择器警告，本次未修改该样式。
- `git diff --check`（本任务文件）：通过。

## 未验证限制

- 尚未在 MarginNote 真机验证原生浮窗已打开/未打开两种状态下的宿主行为；运行时没有公开的浮窗焦点读取接口，因此自动化只能确认能力探测与调用分支，不能确认视觉定位已经落地。
- `cloneNotesToTopic`、跨学习集写入和 `addChild` 的真实设备数据落地仍需 MarginNote 设备验收。

## 预发布交付

- 按仓库版本规则将用户请求的 `2.4.2b1` 规范化为 `2.4.2-b1`；保持 `mnChannel: "stable"`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。
- 对最终代码输入执行 `pnpm check`、`pnpm test`、`pnpm build`：全部通过，完整测试 268/268。
- 安装包：`E:\project\MN\dist\CardLink-v2.4.2-b1.mnaddon`，583,822 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b1.mnaddon`。
- 两份文件 SHA-256 一致：`ef57782af923ec27d586089a73fd16d1759fcfbe6479a4f468b72db42e12de7e`。
- 构建报告既有 `.sfIconGlyph:svg` CSS 选择器警告；本任务未修改该样式，产物正常生成。

## 触发位置纠正与 b2 交付

- 用户澄清双击目标是侧边“查找答案”按钮，而不是脑图卡片；已完整移除脑图视图双击识别，并将双击手势挂到答案按钮。
- 单击按钮仍打开 CardLink 答案窗口；双击按钮取消待执行单击并优先定位到 MarginNote 原生卡片源浮窗。
- v2.4.2-b1 已经交付，因此未做同版本替换；修正版递增为 v2.4.2-b2。
- 对 b2 最终输入执行 `pnpm check`、`pnpm test`、`pnpm build`：全部通过，完整测试 269/269。
- 安装包：`E:\project\MN\dist\CardLink-v2.4.2-b2.mnaddon`，583,657 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b2.mnaddon`。
- 两份文件 SHA-256 一致：`4b9019ab0fe4e479d88cd995e94424b3b0397701a571b2aed5cdf2cc93151a69`。

## 首击菜单关闭边界修正与 b3 交付

- 补充处理 MarginNote 在第一次轻点后关闭原生卡片菜单的边界：双击判定窗口内暂不隐藏“查找答案”按钮，使第二击仍能命中同一按钮。
- b2 已写入交付目录，因此按版本规则将包含该修正的最终验收包递增为 v2.4.2-b3，不覆盖历史包。
- 对 b3 最终代码输入执行 `pnpm check`、`pnpm test`、`pnpm build`：全部通过，完整测试 269/269。
- 安装包：`E:\project\MN\dist\CardLink-v2.4.2-b3.mnaddon`，583,677 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b3.mnaddon`。
- 两份文件 SHA-256 一致：`6fbe9649390f2e6f32aafd441bd88093b1f3da0549f09b73eaffe0c1b2a91bc3`。
- 已核验包内版本为 `2.4.2-b3`、渠道和插件身份正确，存在按钮单双击入口与原生浮窗接口，且旧脑图卡片双击入口不存在。
- 构建报告既有 `.sfIconGlyph:svg` CSS 选择器警告；本任务未修改该样式，产物正常生成。

## 单击延迟、浮窗位置与缺失答案弹窗修正

- 用户真机反馈单击答案窗口变慢。确认单双击判定引入了 360ms 固定等待；本轮关闭双击识别器对触摸开始/结束事件的额外延迟，并将判定窗缩短为 300ms。为避免双击时先弹出单击窗口，短暂判定等待不能完全取消。
- 原生浮窗聚焦前尝试从 AddonLib 缓存或当前 StudyController 视图树识别浮动 MindMapView，保存其顶层容器 frame，并在聚焦完成后恢复；同一答案已在可见浮窗中时跳过重复调用。
- 视图识别与位置恢复均采用可选探测；无法安全识别时不写宿主布局，仅继续调用原生定位接口。
- 修正 `popup` 参数：`canCancel: true` 已自动提供取消按钮，操作按钮数组不再重复包含“取消”；相应操作索引由 1 修正为 0。
- 首层无匹配弹窗现在显示“取消 / 刷新索引后重试”；刷新后仍无匹配时显示“取消 / 生成答案卡片”。
- 涉及文件：`src/floating-toolbar.ts`、`src/note-navigation.ts`、`src/plugin.ts`、`src/globals.d.ts`、`tests/plugin-events.test.ts`。
- 相关验证：`pnpm check` 通过；答案生成与插件事件相关测试 26/26 通过。
- 原生浮窗位置恢复、同答案去重以及实际按钮触感仍需 MarginNote 4 真机验收。

## b4 预发布交付

- 因 b3 已交付，本轮修正版按仓库规则递增为 v2.4.2-b4；保持 `mnChannel: "stable"`、正式插件 ID `marginnote.extension.mn4-answer-matcher` 和标题 `CardLink`。
- 对最终代码输入执行 `pnpm check`、`pnpm test`、`pnpm build`：全部通过，完整测试 269/269。
- 安装包：`E:\project\MN\dist\CardLink-v2.4.2-b4.mnaddon`，584,298 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b4.mnaddon`。
- 两份文件 SHA-256 一致：`8b0d64fb8407b2ffbda408d93be369bd185ad33855a95da1cd4487aad0c8d974`。
- 已核验包内版本、正式插件身份，以及触摸延迟关闭、300ms 判定、浮窗位置追踪、原生浮窗聚焦、两个操作按钮和修正后按钮索引均进入产物。
- 构建报告既有 `.sfIconGlyph:svg` CSS 选择器警告；本任务未修改该样式，产物正常生成。

## 第一层弹窗直接创建与 b5

- 最终按真机截图复核发现，b4 虽修复重复取消，但创建入口仍位于刷新后的第二层弹窗，不完全满足“首次未找到窗口即提供创建”的要求。
- 第一层弹窗改为由系统提供唯一“取消”，并列出“刷新索引后重试”和“生成答案卡片”两个操作。
- 用户选择生成后先刷新索引；刷新后若出现匹配则直接展示，仍无匹配才执行已确认的创建，避免旧索引造成重复卡片，也不再弹第二次创建确认。
- b4 已写入交付目录，因此最终修正版递增为 v2.4.2-b5，不覆盖历史包。
- 对 b5 最终代码输入执行 `pnpm check`、`pnpm test`、`pnpm build`：全部通过，完整测试 269/269。
- 安装包：`E:\project\MN\dist\CardLink-v2.4.2-b5.mnaddon`，584,331 bytes。
- 交付副本：`E:\iCloudDrive\同步文件夹\CardLink-v2.4.2-b5.mnaddon`。
- 两份文件 SHA-256 一致：`27609c80d7d03c3d19f842d16371549c331b7cf0e4521366e6b9914b87b0fef3`。
- 已核验包内版本、正式插件身份、触摸延迟优化、浮窗位置追踪、原生聚焦、第一层刷新/生成入口及按钮索引均进入产物。
- 构建报告既有 `.sfIconGlyph:svg` CSS 选择器警告；本任务未修改该样式，产物正常生成。
