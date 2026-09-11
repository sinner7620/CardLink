# v2.3.3-beta.72：窗口自由拖动、弹层根治与工作区 UI 统一

日期：2026-09-05。基线：v2.3.3 正式版；正式项目内版本号迭代为 `2.3.3-beta.72`。自本版起所有开发收敛在正式版项目，插件保持正式渠道 ID，版本号按 beta 序列迭代。范围：用户 8 项真机/预览反馈 + 渠道/版本号解耦，全部从根源处理；不确定处未打补丁。

## 渠道与版本号解耦

- 用户约定：以后所有开发都在正式版项目内进行，正式渠道插件 ID 不变，版本号按 `2.3.3-beta.N` 迭代。
- `build.mjs`：渠道改由 `package.json` 的 `mnChannel` 决定（当前 `stable`），不再从版本号后缀 `-beta` 推断；新增构建注入常量 `__MN_CHANNEL__`。
- `src/plugin.ts`：`self.addon` key/title 与「正式版不能与 Beta 版同时启用」提醒改按 `__MN_CHANNEL__` 判断；正式渠道的 beta 版本号仍会提醒关闭旧独立 Beta。
- `src/globals.d.ts`：声明 `__MN_CHANNEL__`。
- 保持按版本号后缀判断（属正确语义，未改）：`src/updater.ts` 预发布通道更新检查、`src/telemetry.ts` 渠道标签。
- `tests/plugin-events.test.ts`：共存提醒断言随解耦更新，并新增 build.mjs 渠道来源断言。

## 逐项根因与实现

1. **待复习窄窗图标不居中**：图标与文字的 5px 间距此前由图标 `margin-right` 提供，容器查询隐藏文字后按钮内容整体偏左 2.5px。改为 `.dueReviewActions > button { gap: 5px }` 并删除两处图标 margin，文字隐藏后图标由 `justify-content: center` 精确居中。
2. **标签下拉截断/被遮挡/长灰条**：
   - 截断根因是遗留规则 `.detailHeader button { max-width: 68px }` 命中了标签菜单内的选项按钮（菜单位于 detailHeader 子树），标签只显示一个字；同规则还把等级胶囊压到 68px 与 72px 的天数胶囊不齐。三处遗留 `.detailHeader button` 规则整体删除（现状由 `ui/detail.css` 唯一所有）。
   - 遮挡/裁剪根因是菜单 `position: absolute` 挂在 `.detailPane` 内，被 `overflow: hidden` 裁掉左缘（窄面板实测菜单左缘 107px < 面板左缘 181px）。标签菜单改为 `createPortal` 挂载 `document.body` + `position: fixed`，按触发按钮右对齐并夹取到视口内。
   - “长灰条”对应 beta 期标签栏样式，现行正式版结构（detail.css 单一所有权）下未能复现；本轮删除的遗留规则即当时灰底的残留入口，如真机仍见请再反馈截图。
3. **分类/日期筛选弹层被预览区遮挡**：侧栏是统一滚动容器（`overflow-y: auto`），弹层作为其子元素必被裁剪，z-index 无法穿透。两个弹层同样改为 portal + fixed 锚定（左对齐触发按钮、下缘 5px、左右夹取 8px 边距），新增打开期间“任意滚动即关闭”，避免弹层与锚点脱节。同步删除 `@media(max-width:600px)` 的硬编码 `top: 102px` 旧定位与已失效的 `.mistakeListHeader .categoryPopover/.datePopover` z-index 覆盖。
4. **悬浮条控件不统一**：等级筛选（`.levelNarrow`）与批量改级（`.batchLevelSelect`）的边框/白底写在更高特异性的专属规则里，压过了 `.mistakeListHeader` 的去 chrome 规则。直接把两条专属规则改为免边框、透明底、胶囊圆角（保留下拉箭头作为交互提示）。筛选行与批量行控件之间新增 `.filterDivider` 淡竖线（1px × 16px，`--rd-line`，与详情状态胶囊分隔线同源），批量行由 4 等分 grid 改为 flex 等分以容纳分隔元素。
5. **预览区与顶栏空隙、分隔线不完整**：详情头部 `padding-top` 7px 归零，内容贴齐顶栏下缘；列表/预览分隔线由 `top/bottom: 10px` 内缩改为贯通全高（`top: 0; bottom: 0`）。
6. **窄窗剩余天数胶囊缺失**：详情头部是 flex 子项且 `min-height: 0`，内容超高时被压缩，纵向拼接的状态胶囊下缘被预览区（DOM 后序、`position: relative`）盖住，呈“截断”状。`.detailHeader` 增加 `flex: none`：头部按内容固定，缩放由 `detailStage`（`min-height: 0`）吸收。480px 矮窗口实测状态卡 65px 完整显示。
7. **窗口位置限制**：确认 `clampFrameToStudy` 在拖动逐帧、拖动结束、恢复会话 frame 三处限制位置。顶部 inset 修复实际由 `lockWebViewRootScroll`（`contentInsetAdjustmentBehavior = 2`、`automaticallyAdjustsScrollViewInsets = false`、强制清零 inset/offset）完成，与位置限制无关。函数改为 `clampFrameSize`（只保留尺寸下限与不超过宿主的最大值），拖动全程与恢复不再限制 x/y，窗口可自由拖动。
8. **悬停遗留问题**：统一悬停基线（a11y.css，unlayered + 零特异性 `:where`）会覆盖 cascade layer 内的专用状态底色，实测三处：active 页签悬停丢失选中底色、等级下拉悬停丢失箭头（`background` 简写清掉了 `background-image`）、搜索框无悬停反馈。修复：a11y 基线显式排除 `.active`、`[aria-pressed="true"]`、`.checked`、`.favorited`、`.confirming`、`.detailDueChip`、`[data-level]`；悬浮条悬停规则改用 `background-color` 不再清空箭头；`.topNav button:hover` 收敛为 `:not(.active):hover`；补 `.mistakeListHeader .searchRow > input:hover`。

## 影响文件

- `package.json`：版本 `2.3.3` → `2.3.3-beta.72`；新增 `mnChannel: "stable"`。
- `build.mjs`：渠道与版本号解耦（`mnChannel` + `__MN_CHANNEL__` 注入）。
- `src/plugin.ts`：addon key/title 与共存提醒改用 `__MN_CHANNEL__`；`src/globals.d.ts` 声明。
- `rails-native/WebPanelController.js`：clampFrameToStudy → clampFrameSize，拖动/恢复仅限尺寸。
- `web/src/main.jsx`：`useAnchoredPopover` / `useScrollDismiss` / portal 弹层（分类、日期、标签菜单）；筛选行与批量行 `.filterDivider`。
- `web/src/ui/mistakes.css`：删除遗留 `.detailHeader button` 组与失效弹层锚定/媒体规则；`.levelNarrow`、`.batchLevelSelect` 去 chrome；`.filterDivider`；分隔线贯通；详情头部 `flex: none` 关联规则。
- `web/src/ui/detail.css`：头部 padding-top 归零、`flex: none`。
- `web/src/ui/controls.css`：待复习按钮 gap 化；`.datePopover` fixed。
- `web/src/ui/shell.css`：active 页签悬停排除。
- `web/src/a11y.css`：悬停基线排除专用状态控件。
- `tests/web-bridge.test.ts`：分隔线断言随行为更新（`top: 0; bottom: 0`）。
- `RELEASE_NOTES_v2.3.3-beta.72.md` 新增；`RELEASE_NOTES_v2.3.3.md` 保持正式版内容并指向 beta.72。
- `AGENTS.md`：新增“强制版本迭代与交付”约定（每轮修改迭代版本号、写对应 RELEASE_NOTES、构建后拷贝安装包到同步文件夹并记录 SHA-256）。

## 兼容性与数据影响

- 错题、复习历史、答案绑定、窗口 frame 存储键与数据结构不变。
- 弹层 DOM 挂载点从面板子树移到 `document.body`：选择器 `.detailTagPicker .detailCategoryMenu`、`.mistakeListHeader .categoryPopover` 等“容器前缀 + 弹层”的定制规则随之退役（已删除）；按类名（`.detailCategoryMenu` 等）定制的样式不受影响。
- 面板允许拖出宿主可视区域：位置完全由用户掌控；重置窗口位置（设置页/刷新按钮）仍回到默认 16,16 起点。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.72.mnaddon`（489521 字节，SHA-256 `22C0064D0DA019BCD7368DD5AB7D99C4314BC68C37F6EC4F50EF88433B463DD6`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.72.mnaddon`（覆盖此前的 beta 渠道误发版，副本与原包哈希一致）。
- 包内 `mnaddon.json`：正式插件 ID `marginnote.extension.mn4-answer-matcher`、正式标题「跨脑图卡片匹配」、版本 `2.3.3-beta.72`；可从 v2.3.3 原地覆盖升级。
- 同步文件夹中早前的 `mn4-answer-matcher-v2.3.3-beta.72-list-toolbar-fix.mnaddon` 为历史过渡包，未覆盖、未删除。
- 此前误用本轮内容重建过 `dist/mn4-answer-matcher-v2.3.3.mnaddon`（正式渠道号装 beta 内容），已删除该失配产物；正式 v2.3.3 发布物以 GitHub Releases 为准。
- Playwright（系统 Chrome，Vite 预览桥）逐项复验：宽 980 / 窄 620 / 极窄 430 / 矮 480 四档窗口。
  - 待复习窄卡三按钮隐藏文字后 `iconCenter == btnCenter`（gap 5px）。
  - 430px 下标签菜单完整显示于视口内（原左缘被裁 74px），标签全文可见；分类/日期弹层覆盖预览区且不被裁剪。
  - 批量栏与筛选行控件无边框底色、淡竖线分隔；等级/天数胶囊等宽 72px；矮窗口状态卡 65px 完整。
  - 悬停：active 页签、选中列表项、到期芯片悬停不再丢失状态底色；等级下拉悬停保留箭头；搜索框悬停有边框反馈。
- 未真机验证项：UIWebView 实机的窗口自由拖动手感、portal 弹层在旧 WebView 的表现需真机复验。

## 未验证限制

- 「长灰条」未能在现行代码 430–980px 各档窗口复现（对应旧 beta 的灰底页面风格），按残留样式入口清理处理；若真机复现请提供当前版本截图。
- 真机顶部 inset（面板拖到屏幕顶部后无空白）依赖 `lockWebViewRootScroll`，需在 MarginNote 内复验。
