# v2.3.3-beta.93：候选长条改为候选圈

日期：2026-09-06。基线：beta.92（正式渠道，版本号 2.3.3-beta.93）。范围：真机反馈——候选长条改为 30pt 圆形候选圈。

## 实现

- 候选控件 30pt 圆形（深色半透明胶囊同体系），仅显示当前候选序号数字（1 起算）。
- 位置仍紧邻刷新按钮并跟随关闭/刷新的左右侧设置；点击行为不变（MarginNote 原生选择弹窗列出候选）。
- 清理内嵌下拉面板残留引用。

## 影响文件

`src/answer-card-view.ts`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.93.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 180/180 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.93.mnaddon`（SHA-256 `29A374F400BF870A0FC33F8E5859EC9699AA2F8218ED42362C02E886CBC35FB5`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.93.mnaddon`，副本与原包哈希一致。

## 未验证限制

真机观感与交互待复验。
