# beta.67 真机反馈修复记录

日期：2026-09-03。基线：beta.66。工作分支：beta，目录 MN-rails-beta。

## 范围与验收边界

本次处理用户最新 14 项反馈，保留现有卡片内容、三档色板、Morphicons 引擎和窗口关闭/刷新入口。没有重写另一套窗口逻辑。浏览器与模拟原生接口测试不能证明 MarginNote/iPad 原生闪退、冷启动和系统保存面板的实际耗时已解决；下述原生项目须真机复测。

## 逐项处理

| 反馈 | 实现及依据 | 验证状态 |
| --- | --- | --- |
| 1 悬浮球点击闪退 | 单击只操作现有快捷菜单，不再给宿主 JSExtension.window 赋值、不在点击路径创建面板；菜单/面板移除原生 layer.shadowColor 等阴影赋值；刷新命令使用宿主 UIWindow，不把入口 UIView 当 UIWindow 传入 | 移除高风险原生调用；缺少崩溃报告，不能认定唯一根因，待真机 |
| 2 日志导出缓慢 | 对照 beta.2 恢复 writeTextFile → saveFile 直接调用，去掉 250ms 人为延迟及额外 HUD 桥往返；优先临时目录；导出及耗时记录不再遍历原生选中视图；旧日志载入限制行数和每行长度 | 同步调用顺序、错误释放与重试测试通过；系统文件面板耗时待真机 |
| 3 冷启动白屏 | 同一个 UIWebView 在场景连接时提前隐藏装载；脚本加载、首次 dashboard 请求不再等待隐藏 WebView 可能暂停的双 rAF；原生载入文字随 boot.appRendered 移除 | 不触发 rAF 仍加载 app.js 的执行测试通过；冷启动首屏耗时待真机 |
| 4 悬浮条透明度 | 外层背景 alpha 0.18，去除背景模糊；按钮默认透明，活动按钮保留原强调底色 | CSS及浏览器确认；底层内容可透出 |
| 5 图标与单答案计数 | 定位图标统一 18px 并居中；清除 controls.css 中旧 12px 覆盖；单答案不显示数量 | 浏览器尺寸核对 |
| 6 多答案候选 | 闭合显示 1 起始的数字；透明原生 select 保留完整标题/路径选项，切换沿用 answerIndex | 浏览器选择第二项后显示 2，iframe 内容为解法二 |
| 7 单行悬浮条 | 按实际容器宽度和控件数量计算紧凑模式；宽度不足隐藏题目/答案文字，保持图标单行；不使用 flex 换行补丁 | 460px 页面内、246px 预览区域、7 个控件不越界 |
| 8 拖动即时转向 | pointermove 与 pointerup 共用 nearestDockEdge；移动中的 liveEdge 驱动横竖排列 | 松手前观察到 vertical；四边计算测试通过 |
| 9 折叠展开动画 | 同一个 detailDock 持续挂载，动画改变宽高、位置、透明度；移除 DockToggle 延时后替换 DOM 的实现 | 折叠 230→104.625→40px；展开中间宽度181.875px；减少动态效果偏好下禁用动画 |
| 10 标签与 Morphicons | 标签和标题共用 10px 内边距，行间距2px；官方 Lucide Plus/ChevronDown 数据交给既有 createMorph；补无障碍名称 | x 坐标相同，点击观察 path 从 Plus 变 ChevronDown |
| 11 等级对齐 | 标题与等级/天数胶囊共用26px行高 | 浏览器 top及height均相同 |
| 12 全局开关 | 原页面发送当前值而非反值，导致点击无效；改为取反，持久化 cardToolbarEnabled。只控制卡片查找答案/标记错题侧边按钮，不停止观察器、提醒、面板和答案窗口。设置图标复用普通 SettingsGroup 图标 | 浏览器 off=false/on=true；保存及隐藏行为测试通过 |
| 13 选卡导致面板位置变化 | 面板坐标和父视图统一为场景 UIWindow；布局回调仅在真实宿主宽高改变时重算，不随 study.view 临时布局变化重写 frame/滚动 | 模拟宿主尺寸及选卡回调测试通过；原生多窗口/切学习集待真机 |
| 14 折叠筛选栏间距 | filtersClosed 去掉空网格行、行间隙和底内边距，底外边距3px | 窄屏浏览器核对 |

## 代码延续与清理

- 窗口仍复用 WebPanelController 的 show/hide/reset，长按仅复位实际可见窗口；预加载不能使隐藏窗口被当成已打开。
- 删除已失去调用方的 runtimeControl 导出、旧全局 enabled 存储读写/生命周期门控，以及入口自维护的全局状态回退。
- 从 mistakes.css 删除重复详情标题/容器规则，详情布局由 detail.css 单独拥有；定位小图标覆盖退役。没有新增 !important。
- 旧存储键不再读取，不删除用户旧存储。新 cardToolbarEnabled 未配置默认开启。不改变错题、收藏、标签、复习或答案数据。
- mn-detail-bar 停靠存储键继续沿用；候选选择和收藏继续使用原处理函数。
- 预览桥补上同名开关命令与返回状态，第二答案提供可区分内容，避免测试“只改数字未换内容”。

## 涉及模块

原生：src/mnutils-entrance.ts、plugin.ts、settings.ts、floating-toolbar.ts、note-navigation.ts、rails-core.ts、rails-native/WebAddon.js、WebPanelController.js。

Web：web/boot.js、web/src/main.jsx、detail-dock.js、detail-dock-geometry.ts、lib/previewBridge.js、ui/detail.css、ui/mistakes.css、ui/controls.css。

测试与版本：tests/plugin-events.test.ts、web-bridge.test.ts、domain.test.ts、package.json、README.md及本记录/发行说明。

## 已执行验证

- pnpm check：通过。
- pnpm test：167/167 通过；包括隐藏页面脚本启动、日志直接调用及重试、开关作用范围、宿主尺寸稳定性、四边停靠。
- Playwright CLI：460×620窄屏、单行尺寸、标题/标签/胶囊对齐、多答案内容切换、开关往返、拖动中转向、折叠/展开中间帧、Plus→ChevronDown。
- 截图：output/playwright/beta67-narrow.png（窄屏竖向）、beta67-narrow-horizontal.png（窄屏横向）、beta67-wide.png（宽屏）；测试输出：test-results/beta67-tests.txt。
- 开发期热更新出现 createRoot 重复挂载警告；重新导航后未复现此警告。favicon 404 与插件功能无关，不作为原生验收依据。

## 真机验收清单（未完成）

- 脑图内、退出学习集后分别单击悬浮球，打开/关闭快捷菜单和主面板；如仍闪退提供系统崩溃报告与对应运行日志。
- 强制退出后冷启动，记录点击到载入提示、到内容出现的时间；检查 UIWebView 预载期间宿主行为。
- 开启调试模式后导出日志，分别测文件生成和系统保存面板出现时间；本版保证代码不人为延迟，不承诺系统面板零耗时。
- iPad分屏/旋转/切学习集/选卡不漂移；仅真实宿主尺寸变化时重新限位。
- 旧 WebView 下触摸拖动、select 候选、半透明效果与折叠动画；关闭窗口后长按不得打开它。

## 构建交付

版本：2.3.3-beta.67。pnpm build 通过；检查归档 mnaddon.json 版本及 web-dist/boot.js 均正确。

- 原包：dist/mn4-answer-matcher-v2.3.3-beta.67.mnaddon。
- 已复制：E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.67.mnaddon（485759字节）。
- 原包/副本 SHA-256 一致：F26EDC287E3E3E779D3997B4A544D475AFF59547194B2DB55A758FCD281B8195。
- 最终复跑 pnpm check 与 pnpm test：167项全部通过；git diff --check 通过（仅现有 LF/CRLF 提示）。
