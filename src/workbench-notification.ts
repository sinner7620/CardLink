/** 数据提交后通知现有面板；面板未打开时由其下次显示流程读取。 */
export function notifyWorkbenchDataChanged(owner: any = self): void {
  try {
    ;(globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__?.notify(owner, "nativeDataChanged")
  } catch { /* 一种面板通知失败不影响另一种面板。 */ }
  try {
    owner?.webController?.webView?.evaluateJavaScript(
      "typeof window.__onNativeDataChanged==='function'&&window.__onNativeDataChanged()",
      () => undefined
    )
  } catch {
    // 面板未就绪时保留已提交数据，下次显示时重新读取。
  }
}
