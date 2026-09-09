# v2.3.3-beta.85

基线：beta.84。设置项图标配色调整：**同一大类内颜色统一**，整体**变淡**并回归 UI 规范的"浅底 + 同色字形"模式。

## 调整

- 图标 tile 底色由 iOS 深渐变（66.7%→88.9%→100% + 白字形）改为**同色淡渐变 12%→22%**，字形取同色（不再白色）——与插件其余控件（等级胶囊、选中态）的浅底彩色调一致。
- 颜色按大类 tone 统一（`SettingsGroup` tone 属性 → `SF_TONE_COLORS`）：答案匹配=accent 蓝 #0e8dfd、错题管理=琥珀 #ff9f0a（level1 同源）、插件=绿 #30d158（level2 同源）、调试=红 #ff453a（level0 同源）；色值全部来自 `--mn-*` 色板。
- 修正类名注入选择器缺口：SF SVG 的 class 注入在 `<svg>` 自身，CSS 需覆盖自身与子级（此前字形着色不生效即此因）。

## 说明

- 设置页 16 个静态 tile 图标均为 SF Symbols 7.0.4 官方导出；「定位当前错题原题」行保留 map-pin→check 形变按钮（Morphicons 规范组件），非静态图标。

## 影响文件

`web/src/sf.jsx`、`web/src/main.jsx`、`web/src/ui/settings.css`、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.85.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 实测（截图 `output/playwright/b85-settings.png`）：三组 tone 色分别为 rgb(14,141,253)/rgb(255,159,10)/rgb(48,209,88)，字形 fill 与底色渐变同源；板块内无杂色。

## 未验证限制

- 淡底档位（12%→22%）与同色字形的观感待真机确认；如需更浅/更深仅调两个透明度常量。
