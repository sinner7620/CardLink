# v2.3.3-beta.79

基线：beta.78。处理真机反馈：两个设置图标换为更贴切的图形。

## 实现

- 「卡片侧边按钮」图标：cursor-click（点击手势）→ **toggle-left**（开关），贴合"启用/停用"语义。
- 「刷新错题分类索引」图标：tree-structure → **arrows-counter-clockwise**（刷新），与「刷新答案索引」同款刷新语义。

清理：phosphor.jsx 移除不再使用的 tree-structure、cursor-click 导入。

## 影响文件

`web/src/phosphor.jsx`、`web/src/main.jsx`、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.79.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- 图标文件在 `@phosphor-icons/core` 中存在性核对通过；设置页渲染由 beta.77 的截图链路覆盖（仅换图标键，无布局变化）。

## 未验证限制

- 真机观感待复验。
