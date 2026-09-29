# v2.3.3-beta.77：设置图标语义重选与着色底圈

日期：2026-09-06。基线：beta.76（正式渠道，版本号 2.3.3-beta.77）。范围：真机反馈——beta.76 的设置图标不够贴切、风格不符、重复过多，要求恢复"底色圈 + 上色"。

## 根因与实现

- beta.76 为了"统一"把图标全部压成 ink 单色，且多个设置项复用同一个键（tree-structure 出现 3 次、download-simple 出现 3 次），语义与视觉双重复。
- 本版为每个设置项选专属 Phosphor light 图标（见发布说明逐项映射），`SettingsGroup` 增加 `tone` 属性（accent/amber/green/red），图标置于 30px 圆角底色圈（同色 12-16% 透明底），颜色全部取自 `--mn-*` 色板，不引入新色值。
- 定位行保持原 map-pin→check 形变按钮，不叠加静态图标。

## 影响文件

`web/src/phosphor.jsx`、`web/src/main.jsx`、`web/src/ui/settings.css`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.77.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.77.mnaddon`（SHA-256 `1A184FC7BAE961F88C966C50132619CD56DC37CC715640F5107FE52F2627CC77`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.77.mnaddon`，副本与原包哈希一致。
- Playwright 截图核对：tone 类、图标数、底色圈尺寸与着色（见发布说明）。

## 未验证限制

- 图标语义是否"贴切"属主观判断，以真机观感为准；不满意的项可逐个再换。
