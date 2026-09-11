# 2026-09-06 — AI 配置页滚动修复与摘要行规范重构（v2.3.3-beta.100；beta.99 为本轮未交付的中间构建，已按版本规则撤下）

基线：beta.98。真机确认闪退修复生效后，用户反馈配置页无法下滑、配置页与总览 AI 面板不符合方案 UI 规范。

## 根因

工作台的滚动体系是"根页面固定，仅内容页滚动"：`controls.css` 的共享规则给 `.overviewPage/.reviewPage/.settingsPage/.exportPage` 提供 `overflow:auto`、`overscroll-behavior:contain`、`touch-action:pan-y`，`shell.css` 只给这四个页面提供内边距。AI 配置页的 `<section className="aiSettingsPage">` 不在任何清单里——既不能滚（原生根 UIScrollView 已禁滚，页面自身又无滚动容器），也没有页面内边距（贴边显示）。

## 修复内容

1. `web/src/ui/controls.css`：`.aiSettingsPage` 加入共享滚动规则与 `touch-action:pan-y` 清单。
2. `web/src/ui/shell.css`：`.aiSettingsPage` 加入两处 `main > section` 内边距清单（常规与窄面板媒体查询）。
3. `web/src/main.jsx` AISettingsPage 按方案 §"AI 配置页"重构为摘要行＋展开编辑：
   - 科目行：科目名 + 学习集数量 + 定期状态 + 编辑入口；展开后编辑名称、学习集勾选（限高内滚）、定期与删除。
   - AI 服务行：名称 + Provider + 模型 + 默认徽标 + 密钥状态（`已配置 ····掩码尾部`）；展开后编辑地址/模型、设为默认、密钥与测试。
   - 题目识别、发送内容：摘要行 + 展开；同一时间仅一个编辑器展开（`expandedKey` 单态）。
4. `web/src/ui/settings.css` AI 所有权块新增 `.aiSummaryRow/.aiEditor/.aiEditorField/.aiEditorActions/.aiDefaultBadge` 样式（`.aiSettingsPage .aiSummaryRow` 高特异性覆盖旧按钮着色规则）。
5. `web/src/ui/overview.css`：总览 AI 面板空态留白 18px→12px、字号 12→11，贴近"只显示一句状态"。

## 受影响文件

`web/src/main.jsx`、`web/src/ui/controls.css`、`web/src/ui/shell.css`、`web/src/ui/settings.css`、`web/src/ui/overview.css`、`tests/ai-subsystem.test.ts`、`package.json`（版本号）。

## 兼容性与数据影响

纯 UI 层修改：不改桥接命令、存储键与交互语义；配置页所有原有操作（开关、科目绑定、凭据、测试、缓存与报告管理）全部保留。

## 验证

- `pnpm check` 通过；`pnpm test` 204/204（新增共享滚动清单、摘要行＋掩码尾部断言）。
- `pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.99.mnaddon`。
- 源包与 iCloud 交付副本 SHA-256 一致（见 RELEASE_NOTES_v2.3.3-beta.99.md）。

## 未验证限制

- 真机复测：配置页滚动手感、展开编辑、学习集限高内滚、窄面板单列布局与总览空态观感。

## 补充（真机截图反馈后的第二轮修正，仍属本版本）

1. 整页窄列根因：`.aiSettingsPage` 的 `max-width:920px;margin:0 auto` 在 flex 纵向容器里使 auto 边距吸收剩余空间、整页按 fit-content 收缩；改为 `width:min(920px,100%)`。
2. 级联层压制：摘要行样式写入 `mn-ui-base` 后被 priority 层 `.settingsGroup button` 网格规则压制（层顺序优先于特异性），行内文字被压成竖排。已按仓库约定把摘要行/编辑器覆盖规则移入 settings.css 的 `mn-ui-priority` 块，并取消摘要行"›"伪元素、恢复编辑器按钮内联尺寸。
3. `.aiEditorField input{width:100%}` 误伤学习集复选框（宽 107px），收窄为 `.aiEditorField > input`；学习集标签在 priority 层显式保持横向 flex。
4. 预览桥补充 AI 命令 mock。

## 验证方式升级

本轮起该页面的验证由"静态源码断言"升级为"静态断言 + Playwright 真实浏览器渲染量测"：900px 视口加载构建产物，量测 `.aiSettingsPage` 全幅 900、`overflowY:auto`、可滚动（scrollHeight 1019 > 760）、摘要行高 53px 单行；展开编辑器布局经截图核对。
