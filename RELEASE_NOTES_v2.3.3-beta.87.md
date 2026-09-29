# v2.3.3-beta.87

基线：beta.86。设置页「定位当前错题原题」图标与其他设置项统一样式：改用 SF Symbols tile（mappin），移除形变动画。

## 实现

- `SettingsGroup` 移除 `icon === "locate"` 的 LocateButton 特例分支——定位行与其他设置项统一渲染为 29px 渐变 tile + 同色 mappin 字形（琥珀，随错题管理组 tone），点击行为不变（`openCurrentMistakeSource`）。
- `web/src/sf/locate.svg` 新增（SF Symbols 7.0.4 官方 mappin）。
- 待复习页与错题详情的「定位原题」仍保留 map-pin→check 形变按钮（卡片侧的动画入口，不在本次范围）。

## 影响文件

`web/src/sf/locate.svg`（新增）、`web/src/sf.jsx`、`web/src/main.jsx`、`tests/web-bridge.test.ts`（定位入口断言更新：设置行为静态 tile，待复习/详情保持形变）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。行为变化：设置页定位行点击不再有形变动画（按压反馈仍由 :active 承担），定位功能不变。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.87.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright 实测（截图 `output/playwright/b87-settings.png`）：定位行为琥珀 SF tile（mappin 字形），无形变残留、无旧按钮痕迹。

## 未验证限制

真机观感待复验。
