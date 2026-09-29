# beta.68 直接修复项与验证

日期：2026-09-04。工作树：E:\project\MN-rails-beta，beta分支。版本2.3.3-beta.68。

## 已实施

1. 折叠筛选栏：删除额外3px底外边距，复用侧栏8px间隙。740px浏览器宽度测得控件到顶栏8px、控件到列表8px。
2. 原生菜单/开关：card-toolbar-state.ts成为普通JS状态入口，移除JSExtension上的is/setPluginEnabled自定义方法；WebBridge直接向服务传入context.addon，避免在PanelController回调上下文隐藏错误对象的工具栏。菜单直接调用同一服务。透明外部关闭区改为UIButton，移除UITapGestureRecognizer路径；点击选择器回调均接受sender。没有重写面板显示/关闭/复位逻辑。
3. 启动：首批仍25条，不在非调试模式为日志重复序列化完整响应；原生小响应复用已序列化文本；waitForPaint有50ms后备，避免隐藏WebView暂停rAF后阻断续传。启动提示在React外壳提交后的effect才移除，不在render调用返回时提前通知。开关结果就地更新，不触发完整dashboard重复读取。全库汇总与长列表DOM仍存在，不能宣称千题规模已解决。
4. 等级胶囊：由26px放大至32px，字号13px，跨标题/标签两行垂直居中。标题和标签占同一左列，标签不能延伸到胶囊下方。窄屏标签可在左列换行。
5. 题目/答案固定浅色：删除card-html的深色媒体样式，color-scheme只允许light，原生与iframe一致。
6. 手写比例：独立笔迹取消canvas强制width:100%和最小160px放大，按笔迹包围盒显示，仅在容器不够宽时缩小；DPR只提高位图像素密度，不改变CSS尺寸。原生图像叠加坐标与笔迹解码算法保持原实现。缺失解码核心时逐画布报错，不在整个文档顶层抛ReferenceError。
7. 统一预览：src/card-preview.ts的mountCardPreview同时用于原生HTML内与Web端CardPreview。重复接入只返回已有控制器；单指原生滚动，双指缩放60%—300%，touch/gesture互斥计算。缩放只作用于card，不叠加body scale。内容加载/尺寸变化更新内部滚动范围；移除常驻will-change。组件卸载清理事件和观察器。

## 清理与兼容

- 删除main.jsx中的wirePreviewFrame、applyReviewFrameScale、fitReviewFrame、wireReviewAnswerFrame与answerFrameRef；删除card-html手写内联缩放控制代码，改为共享函数序列化。
- 删除WebAddon失去用途的refreshWebData以及宿主boolean方法；删除未再使用的UITapGestureRecognizer本地声明。
- 原题首次高度缓存式展示保留，未擅自改独立浮层/虚拟列表，也未拆mistakeDetail接口。
- 复用现有Card内容renderer、Morphicons、三档色板、侧边按钮、窗口操作函数和存储键。无错题/复习/标签数据迁移或删除。没有新增!important。
- 删除已无调用方的`frame-pinch-zoom.js`转发文件及过时模块说明，改为CardPreview模块文档；控制器和手势实现各只有一份。
- 为验证生成过的临时迁移脚本已移除；未清理用户原有工作树改动。

## 验证

- TypeScript检查通过；173项自动化测试通过。
- 新测试覆盖：控制器幂等、单指不拦截、双指缩放与清理、原生构建的序列化脚本可独立执行、固定浅色、DPR1/2/3短笔迹均显示48px、Bridge所属addon传递、菜单创建/关闭/开关不访问宿主boolean方法。
- Playwright：740px及460px布局，胶囊32px位于两行中心；标签右边592px、胶囊左边598px（740px时），不重叠。
- 模拟系统深色下实际renderer生成卡片背景仍rgb(255,255,255)；控制器140%→100%复原。
- 待复习同时打开原题与答案，两个文档共用同一实现；答案110%时外层高度仍340px，body不带transform，只有card缩放。
- 设置开关false→true往返通过；修改不再引起整页数据重新读取。
- 开发热更新的createRoot警告、未注入PKDrawing构建宏的源码测试页错误已辨别；原生打包脚本另外通过独立执行测试。
- 最终pnpm check、173项测试、pnpm build、git diff --check通过；归档版本及统一预览/侧边按钮服务入口检查通过。

## 交付

- 安装包已复制至E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.68.mnaddon，486087字节。
- 原包与同步副本SHA-256一致：D347816DE37357C9A450BDBB23EDF2BAEC5BC4C7F6AF2F804B7975069B79CB02。
- 本轮复制的中间beta.68包由最终构建覆盖（覆盖前已核对中间包哈希，未覆盖用户更改的文件）；beta.67同步包未改动。

## 未验证与待审批

- 无真机/.ips：不能宣称悬浮球闪退已经完全消除；点击回调与桥接对象链路修复需真机确认。
- 冷启动实机耗时、千题DOM/滚动、复杂图片手写与原卡精确对比尚未取得真机数据，不填造性能数值。
- 文档架构方案见docs/2026-09-04-beta67-investigation-review.md，ReviewCard隔离/固定原题视窗/虚拟化/按需bridge等均待用户审批。

## 涉及模块

src/card-preview.ts、pinch-zoom.ts、card-html.ts、pkdrawing-renderer.ts、card-toolbar-state.ts、floating-toolbar.ts、plugin.ts、rails-core.ts、mnutils-entrance.ts、globals.d.ts；rails-native/WebAddon.js、WebPanelController.js、WebBridgeCommands.js；web/src/CardPreview.jsx、main.jsx、lib/previewBridge.js、ui/detail.css、ui/mistakes.css；tests/card-preview.test.ts及既有回归测试；package.json、README.md和本记录/发行说明。
