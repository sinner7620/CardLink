// P1-7：原生-共享 UI 常量单一来源。
// JSB.require 共享全局作用域：本模块挂载的 __MNAM_UI_CONSTANTS__ 可被
// WebPanelController / rails-core（AnswerMatcherCore）读取。
// web 侧经桥接命令 uiConstants 获取，写入 CSS 变量 --mn-topbar-height。
var __MNAM_UI_CONSTANTS__ = {
  /** 顶栏高度：原生拖拽热区与 web .topBar 高度共用此值 */
  TITLE_HEIGHT: 48,
  /** 顶栏右侧（或左侧）88pt 关闭/刷新胶囊及安全留白 */
  CONTROL_CLUSTER_WIDTH: 94,
  /** 面板最小尺寸 */
  MIN_WIDTH: 460,
  MIN_HEIGHT: 360
};
