# Drawesome 工具条

源码来自 [Drawesome `4ea1970723d031fbaa448950eb46a64e229de82f`](https://github.com/benjitaylor/drawesome/tree/4ea1970723d031fbaa448950eb46a64e229de82f/packages/draw)，保留 Toolbar 所使用的组件、样式、工具数据和类型。MIT 许可保存在同目录。

CardLink 适配集中在 Toolbar、MorphBar 和 ToolMenu。工具条挂在顶边，因此设置面板可以向下打开。橡皮擦支持再次点击打开原有设置面板，尺寸范围可按当前工具指定，颜色和历史控件可以放入面板。宿主可传入面板标签及笔迹引擎专用设置。图标、颜色面板、工具状态切换、动画和滑块使用原项目组件。

`web/answer-ink-toolbar.jsx` 将原有工具参数和操作传给 Drawesome。`scripts/build-answer-ink.mjs` 编译 CSS Modules 并随答案批注脚本内联样式，正式插件和诊断探针共用该入口。

答案批注的荧光笔通过 `web/ink842/ink-surface.js` 使用原始 `engine/freehand.ts` 和 `engine/pens.ts` 的 Highlighter 预设。Canvas 适配负责用同一个笔形绘制未提交笔迹、回放和导出。

Toolbar 可接收独立的弹层容器。答案预览将设置菜单和提示挂载在工具条内、缩放节点之外，React 的移动事件监听因此只覆盖工具条及弹层。
