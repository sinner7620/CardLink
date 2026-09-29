# v2.3.3-beta.83

基线：beta.82。设置项图标按用户提供的 SF-Symbols-7.0.4-SVG 压缩包与 iOS 设置项设计规范重做。

## 设计规范（来自参考截图的 SwiftUI 代码）

- 图标本体：29pt 圆角矩形，圆角 = 29 × 0.25 = 7.25（continuous），无边框无阴影。
- 底色：垂直渐变 `[color 66.7% → 88.9% → 100%]`（上浅下深，JS 由 hex 计算 rgba，避免 color-mix 兼容性）。
- 字形：白色 SF Symbol，subheadline 字号（实现取 15px 高、宽度按各符号 viewBox 比例自适应居中），semibold 观感。

## 逐项符号与颜色（iOS 系统色）

| 设置项 | SF Symbol | 颜色 |
| --- | --- | --- |
| 同一学习集具体脑图绑定 | link | 蓝 #007AFF |
| 绑定或更换答案脑图 | book.closed | 靛 #5856D6 |
| 设置答案匹配方式 | slider.horizontal.3 | 青 #30B0C7 |
| 刷新答案索引 | arrow.clockwise | 绿 #34C759 |
| 解除答案绑定 | scissors | 红 #FF3B30 |
| 标记所选卡片错题 | flag | 橙 #FF9500 |
| 导出错题 | square.and.arrow.up | 绿 #34C759 |
| 卡片侧边按钮 | switch.2 | 蓝 #007AFF |
| 当前版本 | info.circle | 灰 #8E8E93 |
| 插件使用说明 | questionmark.circle | 紫 #AF52DE |
| 插件窗口关闭按钮 | arrow.left.arrow.right | 靛 #5856D6 |
| 重置窗口位置与大小 | arrow.down.right.and.arrow.up.left | 青 #30B0C7 |
| 检查插件更新 | arrow.down.circle | 蓝 #007AFF |
| 导出运行日志 | note.text | 灰 #8E8E93 |
| 联通测试 | wifi | 绿 #34C759 |
| 退出调试模式 | xmark.circle | 红 #FF3B30 |

（定位当前错题原题行为保持 map-pin→check 形变按钮，不用静态图标。）

## 实现与清理

- 新增 `web/src/sf/`（17 个 SF Symbol 原始 SVG，来自官方 SF-Symbols-7.0.4 导出，fill=currentColor）与 `web/src/sf.jsx`（tile 渲染 + 渐变计算 + 逐项符号/颜色映射）。
- 删除 Phosphor 体系：`web/src/phosphor.jsx`、依赖 `@phosphor-icons/core`、settings.css 的 tone 着色与 30px 底色圈规则。
- `scripts/build-web-smoke.mjs`：SVG `?raw` 内联过滤器放宽为兼容带/不带查询串的路径。
- 大类 tone 属性随逐项配色失去意义，已移除。

## 影响文件

`web/src/sf/`（新增 17 个 SVG）、`web/src/sf.jsx`（新增）、`web/src/main.jsx`、`web/src/ui/settings.css`、`scripts/build-web-smoke.mjs`、`package.json`（-`@phosphor-icons/core`、版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.83.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 实测（截图 `output/playwright/b83-settings.png`）：14 个 tile 渲染，29px、圆角 7.25px、渐变 `rgba(0,122,255,.667)→…`、字形白色 15px，与规范逐项吻合。

## 未验证限制

- 各符号 15px 等高、宽度自适应的视觉均衡（Apple 原版对部分符号做过尺寸微调）如个别不协调，反馈后单独微调该符号尺寸。
