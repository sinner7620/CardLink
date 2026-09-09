# v2.3.3-beta.76：悬停补齐、设置页重构、学习历史图表与答案窗口候选切换

日期：2026-09-05。基线：beta.75（正式渠道，版本号 2.3.3-beta.76）。范围：13 项悬停缺失控件、设置页 UI 重构、总览学习历史图表、刷新转圈通知、悬浮条间距、分隔线消失、卡片侧边按钮颜色、答案窗口多候选交互。

## 关键根因

- **悬停缺失**：这些控件要么自带状态底色/边框（零特异性 a11y 基线被压制），要么是透明 select/label 等基线覆盖不到的形态。逐控件在所有权模块内补专属悬停规则；等级/天数胶囊用亮度反馈。
- **分隔线消失**：分隔线与详情预览 iframe 同为 z-auto，iframe 靠 DOM 后序绘制在其之上；分隔线提升 `z-index: 2`（仍在侧栏 z3 之下）。
- **多候选弹窗打断**：chooseMatch 在路径分并列时弹原生 select；改为默认取 rankAnswers+pathMatchScore 排序后的第一候选，全部候选经答案窗口顶部下拉切换（卡片 HTML 内 select → mnaddon:// 桥 → switchAnswerCandidate 原位重渲染）。

## 设置页重构

- 大类内分隔线式列表（去逐项卡片），行悬停灰底，右箭头弱化。
- 图标全部换 Phosphor light（官方包 `?raw` 内联 SVG，currentColor），去三色图标底统一 ink。
- 新增「插件使用说明」入口：`openPluginGuide` 桥命令 → `MN.app.openURL`；`PLUGIN_GUIDE_URL` 常量待填。

## 构建链适配

- `scripts/build-web-smoke.mjs`：为 `?raw` SVG 增加 onResolve（node_modules 绝对路径 + file 命名空间）与 onLoad 文本内联，绕过 `packages: "external"`。
- `tests/bridge-schema.test.ts`：`switchAnswerCandidate` 加入仅原生命令白名单（由答案卡片 HTML 发起，不经面板 web 端）。

## 影响文件

见 RELEASE_NOTES_v2.3.3-beta.76.md「影响文件」。

## 兼容性与数据影响

数据结构与存储键不变；正式渠道 ID 原地覆盖升级；多候选答案不再弹原生选择框（行为变化，已在发布说明标注）；`@phosphor-icons/core` 仅构建期使用。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.76.mnaddon`（SHA-256 `2C79C014784CFDE409950AE8B571126C12D9293793C181A7E764E6E55658CF0A`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.76.mnaddon`，副本与原包哈希一致。
- Playwright：设置页分隔线列表/图标/行悬停/说明入口；学习历史 14 条块与点击读出；悬浮条间距 4px；分隔线 z2；dock 与待复习全部目标控件悬停生效（截图 `output/playwright/b76-settings.png`、`b76-overview.png`）。

## 未验证限制（真机）

- Phosphor light 图标观感与答案窗口候选下拉（需多候选绑定）、刷新转圈出现时机、`PLUGIN_GUIDE_URL` 待配置。
