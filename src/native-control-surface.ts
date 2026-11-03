interface ControlSurfaceState {
  html(): string
  method: string
  args: unknown[]
  rootId: string
  active(): boolean
  onReady(): void
}

interface SurfaceEntry {
  view: any
  state: ControlSurfaceState
  delegate: any
  loading: boolean
  suspended: boolean
  recoveryAttempted: boolean
  revision: number
  applied?: string
}

const surfaces = new WeakMap<object, SurfaceEntry>()
let SurfaceDelegate: any

function canUpdate(entry: SurfaceEntry): boolean {
  return !entry.suspended && entry.state.active()
}

function loadSurface(entry: SurfaceEntry): void {
  entry.applied = undefined
  entry.loading = true
  entry.revision++
  try {
    entry.view.loadHTMLStringBaseURL(entry.state.html(), null)
  } catch {
    entry.loading = false
    recoverSurface(entry)
  }
}

function recoverSurface(entry: SurfaceEntry): void {
  if (!canUpdate(entry) || entry.loading || entry.recoveryAttempted) return
  entry.recoveryAttempted = true
  loadSurface(entry)
}

function applyState(entry: SurfaceEntry): void {
  if (!canUpdate(entry) || entry.loading || entry.view.loading) return
  const revision = ++entry.revision
  const { method, args, rootId } = entry.state
  const payload = JSON.stringify([method, args, rootId])
  if (entry.applied === payload) return
  // 返回明确的确认值：函数/DOM 不存在不能被当作同步成功。
  const script = `(function(){var fn=window[${JSON.stringify(method)}];if(typeof fn!=='function'||!document.getElementById(${JSON.stringify(rootId)}))return 'missing';fn.apply(window,${JSON.stringify(args)});return 'cardlink-control-ready';})()`
  try {
    entry.view.evaluateJavaScript(script, (result: unknown) => {
      if (revision !== entry.revision || !canUpdate(entry)) return
      if (result !== "cardlink-control-ready") return recoverSurface(entry)
      entry.applied = payload
      entry.state.onReady()
      entry.view.setNeedsLayout?.()
      entry.view.setNeedsDisplay?.()
    })
  } catch {
    if (revision === entry.revision) recoverSurface(entry)
  }
}

function createDelegate(): any {
  if (!SurfaceDelegate) {
    SurfaceDelegate = JSB.defineClass("CardLinkControlSurfaceDelegate : UIViewController <UIWebViewDelegate>", {
      webViewDidFinishLoad(view: any) {
        const entry = surfaces.get(view)
        if (!entry) return
        entry.loading = false
        applyState(entry)
      },
      webViewDidFailLoadWithError(view: any, _error: unknown) {
        const entry = surfaces.get(view)
        if (!entry) return
        entry.loading = false
        recoverSurface(entry)
      }
    }, {})
  }
  return SurfaceDelegate.new()
}

/** 挂载到可见原生容器后调用；加载期间只保留最新状态，完成回调再应用。 */
export function syncControlSurface(view: UIWebView, state: ControlSurfaceState): void {
  let entry = surfaces.get(view)
  if (!entry) {
    const delegate = createDelegate()
    entry = { view, state, delegate, loading: false, suspended: false, recoveryAttempted: false, revision: 0 }
    surfaces.set(view, entry)
    ;(view as any).delegate = delegate
    if (canUpdate(entry)) loadSurface(entry)
    return
  }
  entry.state = state
  entry.suspended = false
  entry.recoveryAttempted = false
  entry.revision++
  ;(view as any).delegate = entry.delegate
  // 保留正在加载的文档；由完成回调应用更新后的状态。
  if (entry.loading || (view as any).loading) return
  applyState(entry)
}

/** 关闭/重挂载时使旧回调失效，保留已加载页面供下次恢复。 */
export function pauseControlSurface(view: UIWebView | undefined): void {
  if (!view) return
  const entry = surfaces.get(view)
  if (!entry) return
  entry.suspended = true
  entry.revision++
}
