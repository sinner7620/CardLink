# v2.3.3-beta.85：设置图标配色统一与淡化

日期：2026-09-06。基线：beta.84（正式渠道，版本号 2.3.3-beta.85）。范围：真机反馈——板块内图标配色统一、整体变淡、符合 UI 规范。

## 实现

- tile 底色改为同色淡渐变（12%→22%），字形取同色（原为 iOS 深渐变 + 白字形）；与 UI 规范的浅底+同色字形模式（等级胶囊/选中态）一致。
- 颜色按大类统一：`SettingsGroup` tone 属性 → `SF_TONE_COLORS`（accent 蓝 / amber #ff9f0a / green #30d158 / red #ff453a，全部 `--mn-*` 同源）。
- 修复类名注入缺口：SF SVG 的 class 注入在 `<svg>` 自身，CSS 补自身选择器（此前同色字形着色不生效即此因）。

## 影响文件

`web/src/sf.jsx`、`web/src/main.jsx`、`web/src/ui/settings.css`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.85.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.85.mnaddon`（SHA-256 `8FD4C82F64B9B14978338792B62A74859AC13D8891C3DA5FDCA50EF3E5F7DD59`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.85.mnaddon`，副本与原包哈希一致。
- Playwright：三组 tone 色 rgb(14,141,253)/rgb(255,159,10)/rgb(48,209,88)，字形 fill 同色，板块内无杂色；截图 `output/playwright/b85-settings.png`。

## 未验证限制

淡底档位与同色字形观感待真机确认；调整仅需改 sf.jsx 中两个透明度常量。
