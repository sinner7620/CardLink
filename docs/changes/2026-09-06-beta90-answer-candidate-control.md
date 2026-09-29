# beta.90 查找答案候选控件修复

## 变更目的

修复查找答案窗口候选条未与相邻按钮垂直居中、点击无法展开、候选数量包含重复或已经能精确判定的答案等问题。

## 已实现行为

1. 候选条高度 30pt，其 `y` 由窗口工具按钮中心线 26pt 反算为 11pt，与关闭/刷新按钮严格同轴。
2. 将 `onToggleAnswerCandidates` 与 `onAnswerCandidateTap` 同时注册到 Rails Core 和旧入口插件类；候选条及下拉面板置于透明拖拽层之上；每个候选行获得明确的 30pt 可点击 frame。
3. 查找窗口显示前按 `noteId`（缺失时回退节点 `id`）去重。
4. 候选条只表达真实歧义：结果不足两个时隐藏；祖先路径有唯一最高分时隐藏；最高分并列但只有一个“标准答案”时隐藏；其他并列结果才显示去重后的候选数。

## 影响文件或模块

- `src/answer-card-view.ts`：中心线、下拉行布局、触摸层级。
- `src/domain.ts`：候选去重与高置信收敛规则。
- `src/plugin.ts`：查找结果去重、候选显示决策、展开时层级保障。
- `src/rails-core.ts`、`src/main.ts`：候选事件注册。
- `tests/domain.test.ts`、`tests/plugin-events.test.ts`：行为与集成回归。
- `package.json`：版本迭代为 `2.3.3-beta.90`。
- `RELEASE_NOTES_v2.3.3-beta.90.md`：本轮发布说明。

## 兼容性与数据影响

无存储键、绑定格式、索引格式或桥接协议变化。候选数口径从“匹配节点数”调整为“去重后的真实答案卡数”；高置信结果不再显示候选条。

## 验证

- `pnpm check`：通过。
- `pnpm test`：180/180 通过。
- `pnpm build`：通过。构建过程中仍出现既有 `.sfIconGlyph:svg` CSS 选择器警告，本轮未改动该设置页样式，且不阻断产物生成。
- 构建产物：`E:\project\MN\dist\mn4-answer-matcher-v2.3.3-beta.90.mnaddon`，499093 字节。
- 交付副本：`E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.90.mnaddon`。
- 两者 SHA-256：`1F68FF437CE1A0032AA9BB4FB4A335B4040162FB66834385E4E0AB861631DB5C`，一致。

## 未验证限制

MarginNote 原生窗口只能在 iPad 宿主内验证；本轮尚未真机点击候选条、切换候选和横竖屏复验。
