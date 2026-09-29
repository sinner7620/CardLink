# v2.3.3-beta.87：设置页定位图标统一为 SF tile

日期：2026-09-06。基线：beta.86（正式渠道，版本号 2.3.3-beta.87）。范围：真机反馈——设置页「定位当前错题原题」图标与其他项统一样式，去形变动画。

## 实现

- `SettingsGroup` 删除 `icon === "locate"` 的 LocateButton 特例分支：定位行与其他设置项统一渲染为 29px 同色淡渐变 tile + mappin 字形（琥珀，随错题管理组 tone）。
- 新增 `web/src/sf/locate.svg`（SF Symbols 7.0.4 官方 mappin）。
- 待复习列表与错题详情的「定位原题」入口仍为 map-pin→check 形变按钮（卡片侧动画入口不在本条范围）。

## 影响文件

`web/src/sf/locate.svg`（新增）、`web/src/sf.jsx`、`web/src/main.jsx`、`tests/web-bridge.test.ts`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.87.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。定位功能与点击行为不变，仅移除形变动画（按压反馈由 :active 承担）。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.87.mnaddon`（SHA-256 `2E8F75A45A1B459E5A248E789A89B4200D1B650E5440F9BD5E3B1F22D0CC4D6B`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.87.mnaddon`，副本与原包哈希一致。
- Playwright 实测：定位行为琥珀 tile + mappin 字形，无 preview-target-icon 形变残留；截图 `output/playwright/b87-settings.png`。

## 未验证限制

真机观感待复验。
