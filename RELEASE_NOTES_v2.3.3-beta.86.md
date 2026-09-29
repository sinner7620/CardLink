# v2.3.3-beta.86

基线：beta.85。处理真机反馈：答案窗口的候选切换控件（卡片内 HTML 下拉）不可用——**废弃该补丁**，改为原生候选长条 + 下拉，集成进关闭/刷新按钮同一体系。

## 实现

- **原生候选长条**：答案窗口内新增深色半透明胶囊按钮（与关闭 ×/刷新 ↻ 完全同款体系），紧邻刷新按钮右侧（x=106，宽 96–210 随窗口收敛，高 30），标题显示「候选 i/N · 当前答案名」。仅多候选（≥2）时显示，单候选自动隐藏。
- **原生下拉面板**：点击长条展开/收起候选列表（surface 底、圆角 9、同款投影，行高 34，当前候选高亮蓝底，标准答案带 ★）。选择后原位重渲染答案（窗口位置保持）、更新长条标题、收起下拉。
- **手势边界**：候选行点击 → `onAnswerCandidateTap:`（sender 身份 + tag 双重回退定位行序）；拖窗开始即收起下拉；关闭/刷新窗口时收起。
- **补丁移除**：卡片 HTML 内的候选切换条（`candidateBarHtml` 注入与 `mnaddon://` 自导航——真机不可靠的根源）整体删除，`answerCardHtml` 恢复二元签名；`switchAnswerCandidate` 桥命令与路由移除。

## 影响文件

`src/answer-card-view.ts`（长条/下拉创建、布局、同步）、`src/plugin.ts`（showAnswer 接原生控件；onToggleAnswerCandidates/onAnswerCandidateTap 选择器；移除桥版 switchAnswerCandidate）、`src/matcher.ts`（回退签名）、`src/rails-core.ts`（移除路由）、`tests/bridge-schema.test.ts`、`tests/plugin-events.test.ts`（新增候选控件接线断言）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键不变；正式渠道 ID 原地覆盖升级。行为变化：多候选答案不再弹原生选择框，也不再用卡片内下拉——窗口顶部长条直接切换。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过（新增候选控件接线断言）；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.86.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- 桌面无 MarginNote 宿主：控件显示、下拉展开、候选切换需真机验证。

## 未验证限制（必须真机）

- 长条显示位置与宽度（刷新按钮右侧、拖动热区内——按钮置于拖动区上层，拖动需从长条以外区域起始）。
- 下拉展开/收起、候选切换重渲染、`sender` 传参在 JSB 的实际行为（已做 tag + 身份双重回退）。
