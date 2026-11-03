# CardPreview — 题目与答案的共享预览入口

## 插件内预览与独立答案窗口

web/src/CardPreview.jsx 管理 iframe 装载、大小控件同步和事件清理。src/card-preview.ts 使用原版 @panzoom/panzoom 4.6.2 处理双指缩放和单指平移，使用 panzoom 9.4.3 的原版 kinetic 模块处理拖动惯性，无本地库源码补丁。缩放使用库的 CSS transform，不使用浏览器页面缩放、CSS zoom 或文档 scrollTo。页面固定尺寸并关闭原生滚动，适配器负责长内容边界与短内容居中。普通滚轮平移，Ctrl/Command+滚轮缩放。

src/card-preview-webview.ts 将库和适配器打包为独立运行时，经典卡片与场景 preview-runtime.js 共用；在 iframe 自己的环境创建库实例。同一文档只创建一个控制器，场景先注册入口，内容填入后再挂载。手势与数字大小控件共享 60%—300% 比例，整数百分比回传不重复缩放。使用库 step=0.75、pinchAndPan=false；双指缩放同步绘制以保持焦点，普通平移沿用库的动画帧，避免重复绘制。惯性使用 amplitude=0.342、minVelocity=5，减少动态效果时停用惯性；新输入、布局变化及销毁会取消惯性。

独立答案窗口固定使用 UIWebView.scalesPageToFit 和系统 scrollView，移除卡片预览适配脚本，保留媒体、评论与笔迹脚本；不再提供插件缩放选项。旧 custom 设置及旧命令参数兼容保留，但不会启用插件手势。原生外层窗口按钮与窗口几何不随正文缩放。

## 手写与内容

按需显示的脑图绑定手写继续使用显示/隐藏按钮。旧 doubleTap 设置值按“按需显示”解释，无需迁移；始终显示仍保持展开。输入适配器仅转交已开始的指针，pen 接触取消旧触点并独占当前手势，忽略混合类型、悬停和未跟踪的结束事件；blur、隐藏和取消时清理。链接、按钮、表单与 summary 不作为拖动起点。Pencil 隔离依赖宿主 Pointer Events 的类型信息，仍需真机验证。

摘录图片、PaintNote 和 LinkNote 的配对 paint/drawing 使用同一叠加容器；画布按底图原始尺寸绘制，随图片等比缩放。无底图数据独立展示，不推测无关联媒体的叠加关系。DPR 只影响位图清晰度。脑图绑定手写作为独立区域，不推测整张卡片的脑图坐标。

评论折叠保持原有存储协议。嵌入预览内点击继续转发 cardlink-preview-click，自动隐藏列表据此收起，不吞掉原点击。导出仍为静态排版。

## 原生窗口移动

答案窗口、复习条和入口使用 UIKit UIPanGestureRecognizer 的 translationInView/setTranslationInView。位置及最小尺寸约束属于窗口布局；插件不计算触点差、速度、惯性和松手吸附。移动展开入口的父视图即可移动全部子控件，不逐帧重建复习条。

## 验证边界

复习的「插件内批注」另用 `src/plugin-ink-window.ts` 和 `web/plugin-ink.js` 建立作答窗口，不将手写引擎注入普通答案预览。`web/ink842/` 移植 842 网站每日测试的工具栏、Pointer/Touch 路由、几何擦除与画布/重放适配，直接使用 `web/vendor/goodnotes-ink/` 固定源码中的引擎。历史轮廓渲染保留 perfect-freehand。CSS 作为文本与 html2canvas 一起内联构建，运行时无需 CDN。新旧批注记录按生成器标识区分，保存、折叠和历史编辑契约见 [复习页说明](../../pages/review.md#插件内批注)。

测试覆盖独立答案原生文档、库打包、嵌入预览比例回传、范围与边界、笔输入隔离、媒体和评论保留、手写按钮及清理。浏览器触摸检查区分库的内容变换与文档滚动。桌面自动化不能替代 MarginNote 真机捏合、Pencil 行为以及 iframe 与宿主的交互验收。
