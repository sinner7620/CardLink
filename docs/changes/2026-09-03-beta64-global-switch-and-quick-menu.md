# 2026-09-03 beta.64 — 插件全局开关、悬浮球快捷菜单与跨脑图定位修复

## 目的

按《CardLink_v2.3.3-beta.62_全局开关与悬浮球快捷设置实现方案说明》实施，并按用户确认做两点调整：

1. 快捷菜单不使用 MnUtils 原生 `select(...)` 弹窗，改为自绘原生小界面，视觉对齐插件现行 UI 规范；
2. 顺带修复"错题本定位原题跨脑图跳转后列表刷新乱跑"。

实现原则：控制入口可以新增，实际功能实现必须复用现有 API 和现有函数；不新增第二套 Observer/Timer/UI/布局。

## 一、插件全局开关

- **持久化**（`rails-native/WebAddon.js`）：NSUserDefaults，键 `marginnote.extension.mn4-answer-matcher.global-enabled.v1`；`readPluginEnabled()` 先 `objectForKey` 判存在，无历史配置默认开启（v61 升级不被误关）；`savePluginEnabled()` 只写持久化，不碰业务。
- **统一状态入口**（WebAddon.js）：`isPluginEnabled()` 仅明确 `false` 才视为关闭（防初始化期 undefined 误判）；`setPluginEnabled(enabled, refreshWeb)` 为唯一入口——存持久化 → `core.runtimeControl.start()/stop()` → `ensureMnutilsEntrance()` → `refreshAddonCommands()` → `refreshWebData()`（经 `window.__onNativeDataChanged()` 让设置页重拉 dashboard）。设置页、悬浮球快捷菜单共用。
- **Core 运行控制层**（`src/plugin.ts`）：`runtimeControl.start()` 复用可重复激活路径 `activatePluginRuntime()`（Observer 先 remove 再 add、更新检查、遥测调度、复习提醒调度、提醒 timer 启动）；`stop()` 移除 Observer、停提醒 timer、收起等级下拉/脑图选择器、隐藏答案工具条与答案窗口。`activatePluginAfterMigration()` 改为对同一实现的一次性包装。
- **生命周期门控**（WebAddon.js）：`sceneWillConnect` 先读持久化 → Core 正常初始化 → 建面板控制器 → 持久化为 OFF 时立即 `runtimeControl.stop()`；`notebookWillOpen` 关闭态只保留悬浮球入口；`applicationWillEnterForeground` 关闭态不再拉起自动业务（classMethods 包装）。
- **设置页**（`web/src/main.jsx`）：设置 → 插件 → "插件全局开关"（SvgSwitch 行，状态来自 `dashboard.matching.pluginEnabled`），描述文案区分开/关两态。
- **Bridge**（`rails-native/WebBridgeCommands.js`）：新增 `setPluginEnabled` 命令转发 `addon.setPluginEnabled`；dashboard 附加逻辑在 `panelCloseButtonSide` 旁追加 `pluginEnabled`（context.pluginEnabled 读 addon.isPluginEnabled）。

## 二、悬浮球快捷菜单（自绘原生小界面）

- 单击悬浮球由"开关主面板"改为开关「CardLink 快捷设置」菜单（`src/mnutils-entrance.ts`）。
- 菜单为原生 UIView 卡片：白底（rd-surface）、14px 圆角（与主面板一致）、rd-shadow-lift 同参阴影、#1D1D1F 主文字、#6E6E73 次要文字、`--mn-accent` 强调色、行高 44（HIG 触控目标）、行间 0.5 hairline；锚定悬浮球旁（按球所在半屏向左/向右展开，夹紧窗口内）；透明捕顶层点击任意处关闭；宿主 window 变化时旧菜单自动关闭。
- 四个菜单项全部复用现有实现：
  1. 插件全局开关（行尾显示已开启/已关闭，点击走 `setPluginEnabled`）；
  2. 重置窗口位置（走修复后的 `performEntranceReset`，与长按同一路径）；
  3. 关闭按钮位置（行尾显示左侧/右侧，走 `WebPanelController.setPanelCloseButtonSide`，持久化/布局/答案窗口联动仍由原 `setCloseButtonSide` 完成）；
  4. 打开/关闭主面板（每次打开实时读 `isVisible`，走 `showPanel()/hidePanel()`）。
- 动作后原位刷新行内状态标签（不关闭菜单），与设置页状态经 dashboard 双向同步（E/F 验收项）。
- 新增实例选择器在 `src/main.ts` 与 `src/rails-core.ts` 双处注册（仓库既有约定）。

## 三、长按复位缺陷修复（v61 bug）

`performEntranceReset` 此前面板不存在/不可见时直接 return，答案窗口复位永远执行不到。改为面板与答案窗口分别判断、互不阻断：面板有已加载视图（`controller.webView` 存在，未展示过的面板不会被意外实例化）即独立 `resetFrame()`；答案窗口存在且显示即独立 `resetAnswerCardPosition()`。主面板隐藏时长按悬浮球仍可复位答案窗口（验收 G）。

## 四、错题本跨脑图定位后列表刷新乱跑

跨学习集跳转不改变错题数据，跳转后触发的整页刷新属于多余刷新，且分页快照重启会让列表缩回首页、滚动位置丢失。修复：

- `src/note-navigation.ts` `locateJumpCrossStudySet` 记录 `self.mn4LocateJumpStartedAtMs` 时间戳；
- `WebPanelController.showPanel` 调 `__onPanelShow` 前经 `addon.shouldSuppressPanelReload()` 消费该标记（6 秒窗口，消费即清除），携带 `skipReload=true`；
- `web/src/main.jsx` `__onPanelShow(options)` 收到 skipReload 时跳过这一次自动 `load()`（`touchLocateOnShow` 与迁移弹窗计数照常执行）；
- 双保险：`load()` 记录 `.mistakeList` 旧 scrollTop，分页续传完成后两帧恢复，任何整页刷新不再丢失列表停留位置。

## 受影响文件

- `src/plugin.ts`（runtimeControl、activatePluginRuntime、onPanelCloseButtonSideChanged 增加数据变更通知、快捷菜单 handler 再导出）
- `src/mnutils-entrance.ts`（快捷菜单、单击接线、复位缺陷修复）
- `src/note-navigation.ts`（跨学习集跳转时间戳）
- `src/globals.d.ts`（UITapGestureRecognizer 声明）
- `src/main.ts`、`src/rails-core.ts`（新选择器双处注册、runtimeControl/notifyWorkbenchDataChanged 进 Core 全局）
- `rails-native/WebAddon.js`、`rails-native/WebPanelController.js`、`rails-native/WebBridgeCommands.js`
- `web/src/main.jsx`（设置页开关行、__onPanelShow 门控、列表滚动保持）
- `tests/plugin-events.test.ts`（断言随新行为更新 + 新增 v64 断言组）、`tests/web-bridge.test.ts`（__onPanelShow 断言随签名更新）
- `package.json`（`2.3.3-beta.64`）、`README.md`、`RELEASE_NOTES_v2.3.3-beta.64.md`、`交接文档.md`

## 明确排除（与方案一致）

动态改 mnaddon.json 禁用自身、运行时卸载 JSExtension、猜测 PluginManager 私有 API、快捷菜单自存窗口坐标/自行布局。

## 验证

- `pnpm check` 通过；`pnpm test` 159/159（新增 v64 断言组）；`pnpm build` 产物 `dist/mn4-answer-matcher-v2.3.3-beta.64.mnaddon` 并已拷贝到 `E:\iCloudDrive\同步文件夹\`。
- 安装包内容抽验：core 含 5 个快捷菜单选择器与 runtimeControl；WebAddon 含全局开关持久化与 shouldSuppressPanelReload；WebBridgeCommands 含 setPluginEnabled 命令与 pluginEnabled 附加；mnaddon.json 版本 beta.64。
- 修复前源码备份：`E:\project\MN-rails-beta-backup-2026-09-03-before-quickmenu.tar.gz`（658K，249 文件）。

## 未验证限制（需真机按方案第 20 节验收）

- A–K 全部验收项均需真机复核；尤其 C（重启持久化）、G（主面板隐藏时长按复位答案窗口）、K（拖动/吸附/长按/单击不回归）。
- 自绘菜单的真机观感（圆角、阴影、行高、字体）以真机为准；预览环境无法渲染原生 UIView。
- 跨学习集跳转若伴随宿主重建 WebView（冷启动式面板恢复），首次 dashboard 属必要加载，不在跳过范围内；此时列表滚动位置由 load() 的滚动保持逻辑兜底。
