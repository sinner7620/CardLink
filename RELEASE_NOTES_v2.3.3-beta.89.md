# v2.3.3-beta.89

基线：beta.88。修复真机反馈：复选框取消勾选时"框内变黑然后跳回未选中图标"。

## 根因

beta.78 引擎迁移后，复选框族使用**填充式 Phosphor 图标对**（256 viewBox、fill、带绕向挖洞子路径：外圈+内圈构成空心框，对勾是第三个实心子路径）。Morphicons 引擎做几何插值时把"对勾"子路径配对到"内圈"子路径，两者绕向失配，中途 nonzero 填充把框的洞填实——表现为取消勾选时框内先变黑、落定才跳回空心框。

## 实现

- 复选框族（列表勾选框、批量多选入口、全选/全不选、总览脑图多选）整体换回**描边图形对**（24 viewBox、圆角方框 ↔ 方框+对勾）：描边集合正是 Morphicons 官方适配的图标类型，子路径配对与插值干净，无填充绕向问题。选中着色经 currentColor 继承（选中为 accent）不变。
- `MorphIcon` 移除已无使用方的 `filled` 分支（256 viewBox / fill 变体）；删除 `.morphIconFilled` CSS（controls/mistakes）与死路径数据 phosphorSquare/phosphorCheckSquare。

## 影响文件

`web/src/main.jsx`、`web/src/ui/{controls,mistakes}.css`、`tests/web-bridge.test.ts`（断言随描边对更新）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。视觉变化：复选框由填充式 Phosphor 方框改为描边方框+对勾（与列表勾选框一贯风格一致）。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.89.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright：勾选/取消两个方向的中途帧均为连续几何插值（rest `M5 4h14…` → mid `M5 4L5.97 4…` → done），无突变跳变路径；截图 `output/playwright/b89-checkbox.png`。

## 未验证限制

- 真机观感：描边复选框的线宽与勾选态 accent 着色待复验；如嫌线太细可将 strokeWidth 从 1.8 上调。
