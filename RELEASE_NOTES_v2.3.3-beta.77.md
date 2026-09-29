# v2.3.3-beta.77

基线：beta.76。处理真机反馈：设置页图标不够贴切、风格不符、重复过多，并要求恢复"底色圈 + 上色"的图标风格。

## 实现

- **逐项专属语义图标**（消除重复，全部 Phosphor light）：
  - 答案匹配：绑定关系=link-simple-horizontal、绑定/更换答案脑图=notebook（原与上一项共用）、匹配方式=sliders-horizontal（原 tree-structure）、刷新索引=arrows-counter-clockwise、解除绑定=link-simple-horizontal-break
  - 错题管理：标记错题=flag（原 list-checks）、定位=map-pin 形变按钮（不变）、刷新分类索引=tree-structure（原与匹配方式共用）、导出=download-simple
  - 插件：卡片侧边按钮=cursor-click、版本=info、使用说明=book-open、关闭按钮位置=arrows-left-right（原 tree-structure）、重置窗口=frame-corners、检查更新=arrow-clockwise（原与导出共用 download-simple）
  - 调试：导出日志=file-text（原与导出共用）、联通测试=wifi-high、退出=x
- **底色圈 + 上色**：图标改为 30px 圆角底色圈（9px 圆角、同色 12-16% 透明底），图标按大类取 `--mn-*` 色板色——答案匹配=accent 蓝、错题管理=琥珀（level1）、插件=绿（level2）、调试=红（level0），`SettingsGroup` 增加 tone 属性承载。

## 影响文件

`web/src/phosphor.jsx`（图标映射重写）、`web/src/main.jsx`（SettingsGroup tone + 逐项图标键）、`web/src/ui/settings.css`（底色圈与 tone 着色）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.77.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 截图（`output/playwright/b77-settings.png`）：四组 tone 类正确、图标 14 项全部渲染、底色圈 30px、accent 组着色 `rgb(14,141,253)` / 底 `rgba(14,141,253,.12)`；各图标无重复。
- 真机待复验：light 细线图标在小尺寸下的观感、四组色彩是否协调。
