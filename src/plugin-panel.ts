/** 插件面板（经典 WebView 面板）的显示入口。
 *  多个原生流程需要先把面板带到前台再让面板内交互，
 *  这里复用同一段 MN Utils 面板 API，避免各处重复实现。 */
export function showPluginPanel(owner: any = self): boolean {
  try {
    const panel = (globalThis as any).__MNAM_WEB_PANEL_GLOBAL__
    const controller = owner?.webController
    if (!panel?.showPanel || !controller) return false
    if (!panel.isVisible?.(controller)) panel.showPanel(controller)
    return true
  } catch {
    return false
  }
}
