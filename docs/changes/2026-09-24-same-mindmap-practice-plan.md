# 同脑图答案匹配与快捷功能区方案

## 目的

阅读 CardMask v0.1.0 源码，规划 CardLink 全局悬浮球快捷功能区及同脑图题目/答案匹配与刷题适配。

## 本次结果

- 新增 [整体方案](../plans/same-mindmap-practice.md)，说明三项快捷入口、颜色配置、直接子卡匹配、遮罩生命周期、实施顺序和验收。
- 本轮只形成方案；未改动插件行为、接口、存储数据、产品版本或安装包。

## 影响文件与兼容性

- 仅新增本记录及 `docs/plans/same-mindmap-practice.md`。
- 方案明确旧跨脑图绑定需保留；本轮没有迁移或数据影响。

## 验证与限制

- 对照 `src/mnutils-entrance.ts`、`src/floating-toolbar.ts`、`src/binding.ts`、`src/answer-lookup.ts`、`src/plugin.ts` 及 CardMask v0.1.0 `main.js` 阅读相关实现。
- 已核对方案与源码约束、相对链接目标；`git diff --check` 通过。新文件另做行尾空格检查。
- 未运行应用测试或构建；未进行 MarginNote 真机验证。Canvas 层级、手写遮挡与性能属于后续实现的真机验收范围。
