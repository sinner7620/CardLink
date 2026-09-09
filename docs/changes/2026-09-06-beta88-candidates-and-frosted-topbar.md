# v2.3.3-beta.88：候选下拉点击修复、长条侧边联动、顶栏毛玻璃复原

日期：2026-09-06。基线：beta.87（正式渠道，版本号 2.3.3-beta.88）。范围：真机反馈三项。

## 逐项根因与实现

1. **候选下拉行点击无反应**：JSB 控件回调的 sender 是新的代理实例，与存储的行按钮按引用比对必然落空；行创建时未写 tag，tag 回退也无值。修复：候选行创建时 `row.tag = index`（try/catch），点击按 tag 定位行序，indexOf 保留为回退。
2. **候选长条未跟随侧边设置**：位置硬编码 x=106（左布局假设）。`layoutAnswerCardWindowControls` 按 side 计算：右侧布局时长条贴在刷新按钮左侧，下拉面板同步；左侧不变。
3. **顶栏毛玻璃复原**：beta.84 文档流布局使内容不再从顶栏下经过，blur 无从体现。恢复 absolute 覆盖式顶栏（`backdrop-filter: blur(22px) saturate(1.8)` + 半透明底），section 恢复 `padding-top`，内容从毛玻璃下滚过。白条不复发：absolute 不依赖 fixed 层重锚定，且根 UIScrollView 永久禁滚 + 顶边安全区约束，无 offset 扰动源。

## 影响文件

`src/answer-card-view.ts`、`web/src/ui/shell.css`、`tests/plugin-events.test.ts`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.88.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.88.mnaddon`（SHA-256 `A150407FF9F80442B0C3FFB4D734C532849A12F83DCDDA502FCF4F265CDF3583`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.88.mnaddon`，副本与原包哈希一致。
- Playwright：topBar absolute + blur(22px) saturate(1.8) + 半透明底；section 与顶栏重叠、滚动后顶栏 y=0；截图 `output/playwright/b88-frosted.png`。

## 未验证限制（必须真机）

候选行点击切换（JSB 回调传参与 tag 行为）、右侧布局下长条位置、真机毛玻璃渲染。
