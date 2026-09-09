# v2.3.3-beta.80：设置页布局平衡与密度优化

日期：2026-09-06。基线：beta.79（正式渠道，版本号 2.3.3-beta.80）。范围：用户确认的设置页布局优化组合（列平衡 + 去大标题 + 说明卡压缩 + 行密度）。

## 根因与实现

- 宽面板两列 `1.05fr : 0.95fr` 下右列只有一张说明卡（346px），左列三组约 940px，右列下方约 600px 空白。将「插件」组与调试类移至右列说明卡下方：左 568px / 右 741px，基本平衡。
- 设置页独有的 sectionIntro 大标题（"设置与管理"）与顶栏页签重复、且其他页无此结构——移除，死 CSS 清理。
- 说明卡三档卡片 min-height 72px 且描述与天数编辑器同行挤压换行——改两行布局（描述行 + 编辑器独立右对齐行），去 min-height。
- 设置行 min-height 52 → 46px。
- ≤800px 单列断点下说明卡原 DOM 顺序夹在错题管理与插件之间——断点内 `display: contents` 拆容器 + flex 纵排 + 说明卡 order 9 置底；窄面板视觉顺序 = 答案匹配 → 错题管理 → 插件 → 说明（坐标实测确认）。

## 影响文件

`web/src/main.jsx`、`web/src/ui/settings.css`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.80.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.80.mnaddon`（SHA-256 `AF99D2B059F14E384F0F19787C929F552E76A37FAD1B21B5E3A9B5F069926823`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.80.mnaddon`，副本与原包哈希一致。
- Playwright：1180px 列高 568/741；720px 视觉顺序按坐标验证；截图 `output/playwright/b80-settings-wide.png`、`b80-settings-narrow.png`。

## 未验证限制

真机观感（两列 173px 高度差、说明卡两行布局）待复验。
