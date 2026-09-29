# v2.3.3-beta.89：复选框取消勾选黑块修复（描边图形对）

日期：2026-09-06。基线：beta.88（正式渠道，版本号 2.3.3-beta.89）。范围：真机反馈——复选框取消勾选时框内变黑后跳回未选中图标。

## 根因

beta.78 迁移后复选框族用填充式 Phosphor 图标对（fill、绕向挖洞子路径）。引擎几何插值把对勾子路径配对到内圈子路径，绕向失配使 nonzero 填充在中途把框洞填实（黑块），落定才恢复空心框。

## 实现

复选框族整体换描边图形对（checkbox ↔ checkboxChecked，24 viewBox 圆角方框+对勾，stroke currentColor 1.8）：描边集合是 Morphicons 官方适配类型，插值干净。选中色经 currentColor 继承（accent）。`MorphIcon` 移除无使用方的 filled 分支；删除 `.morphIconFilled` CSS 与死路径数据。

## 影响文件

`web/src/main.jsx`、`web/src/ui/{controls,mistakes}.css`、`tests/web-bridge.test.ts`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.89.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。视觉变化：复选框为描边方框+对勾（与列表勾选框风格一致）。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.89.mnaddon`（SHA-256 `38B6D279997E73F519C4C359AD48400C8CC3A38D8820E67AFDEB2DE462C3DCC0`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.89.mnaddon`，副本与原包哈希一致。
- Playwright：勾选/取消两方向中途帧均为连续几何插值（无跳变路径）；截图 `output/playwright/b89-checkbox.png`。

## 未验证限制

真机观感（描边线宽 1.8、选中 accent 着色）待复验。
