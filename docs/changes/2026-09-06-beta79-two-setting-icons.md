# v2.3.3-beta.79：两个设置图标换为贴切图形

日期：2026-09-06。基线：beta.78（正式渠道，版本号 2.3.3-beta.79）。范围：真机反馈两项图标调整。

## 实现

- 「卡片侧边按钮」：cursor-click → toggle-left（开关图形，贴合启用/停用语义）。
- 「刷新错题分类索引」：tree-structure → arrows-counter-clockwise（刷新图形，与「刷新答案索引」同款）。
- 清理 phosphor.jsx 中不再使用的 tree-structure、cursor-click 导入。

## 影响文件

`web/src/phosphor.jsx`、`web/src/main.jsx`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.79.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.79.mnaddon`（SHA-256 `B62D168EF445828CB4A6E77F41915D4006A7D2E47AEA5A9505E0258DDC424F72`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.79.mnaddon`，副本与原包哈希一致。

## 未验证限制

真机观感待复验。
