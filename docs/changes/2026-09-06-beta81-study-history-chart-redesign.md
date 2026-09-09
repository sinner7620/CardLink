# v2.3.3-beta.81：学习历史图表重做为参考样式

日期：2026-09-06。基线：beta.80（正式渠道，版本号 2.3.3-beta.81）。范围：用户参考图样式重做总览学习历史图。

## 实现

参考样式三要素：①横轴日期、每列一根"新增（下）/复习（上）"圆头胶囊条堆叠自基线，列后竖网格线；②「最近一周 / 按月查看（30 天）」页签切换，图例右侧；③点击列选中该日——条顶显示当日总数、底部"当日新增/当日复习"大数字读数，默认选中今日，今日标签 accent 高亮。

非选中列半透明（今日 .78、其余 .5）模拟参考图"今日更饱和"的层次。颜色仍取色板：复习=accent 蓝、新增=level2 绿。

数据源与 beta.76 首版一致（history.at / createdAt），无数据结构变化。

## 影响文件

`web/src/main.jsx`、`web/src/ui/overview.css`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.81.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.81.mnaddon`（SHA-256 `A83ADAEF798432D49666632C784E9B732817DE0BB790DB1064D7232A39258191`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.81.mnaddon`，副本与原包哈希一致。
- Playwright：周视图 7 列、月视图 30 列、点击今日列计数与读数联动；截图 `output/playwright/b81-chart-week.png`、`b81-chart-month.png`。

## 未验证限制

真机观感（胶囊尺寸、透明度层次、月视图窄面板标签密度）待复验。
