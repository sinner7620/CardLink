# v2.3.3-beta.83：设置项图标重做为 SF Symbols iOS 设置风格

日期：2026-09-06。基线：beta.82（正式渠道，版本号 2.3.3-beta.83）。范围：按用户提供的 SF-Symbols-7.0.4-SVG 压缩包与参考截图的 SwiftUI 规范，重做设置页全部图标。

## 规范（参考截图 SwiftUI 代码）

29pt 圆角矩形（圆角 29×0.25=7.25 continuous）、无边框无阴影、底色为垂直渐变 [color 66.7% → 88.9% → 100%]、白色 subheadline 字号 SF Symbol 字形。实现按 hex 在 JS 计算 rgba 渐变（不依赖 color-mix），字形 15px 高、宽度按符号 viewBox 比例自适应居中。

逐项符号与 iOS 系统色：绑定=link/蓝、绑定或更换脑图=book.closed/靛、匹配方式=slider.horizontal.3/青、刷新答案索引=arrow.clockwise/绿、解除绑定=scissors/红、标记错题=flag/橙、导出错题=square.and.arrow.up/绿、卡片侧边按钮=switch.2/蓝、当前版本=info.circle/灰、使用说明=questionmark.circle/紫、关闭按钮位置=arrow.left.arrow.right/靛、重置窗口=arrow.down.right.and.arrow.up.left/青、检查更新=arrow.down.circle/蓝、导出日志=note.text/灰、联通测试=wifi/绿、退出调试=xmark.circle/红。定位行保持 map-pin→check 形变按钮。

## 实现与清理

- `web/src/sf/`：17 个官方导出 SVG（fill=currentColor）。
- `web/src/sf.jsx`：tile 组件（渐变背景 + 白色字形）+ 逐项符号/颜色映射。
- 移除 Phosphor 体系：`phosphor.jsx`、依赖 `@phosphor-icons/core`、settings.css 的 tone 着色规则；大类 tone 属性移除（颜色随图标）。
- `scripts/build-web-smoke.mjs`：SVG `?raw` 内联过滤器放宽（兼容带/不带查询串）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.83.mnaddon`（SHA-256 `5C7089E050C5CEE4CB3AD75C3985863B2FA9FCC0CBE332AF64889FE2E6C42D2C`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.83.mnaddon`，副本与原包哈希一致。
- Playwright 实测：14 个 tile 29px / 圆角 7.25px / 渐变背景 / 白色 15px 字形全部符合规范；截图 `output/playwright/b83-settings.png`。

## 未验证限制

个别符号在 15px 等高下的视觉均衡（Apple 原版有按符号微调尺寸）如不协调，反馈后逐项微调。
