declare const self: any

declare class UIPanGestureRecognizer extends UIGestureRecognizer {
  constructor(target: any, action: string)
}

declare class UILongPressGestureRecognizer extends UIGestureRecognizer {
  constructor(target: any, action: string)
  minimumPressDuration: number
}

declare const __APP_VERSION__: string
// 构建渠道（来自 package.json mnChannel）：stable = 正式插件 ID；beta = 独立 Beta 工作树。
// 与版本号解耦：正式项目内 2.3.3-beta.N 版本号仍属 stable 渠道。
declare const __MN_CHANNEL__: "beta" | "stable"
declare const __GITHUB_REPOSITORY__: string

declare const MNUtil: {
  animate?(updates: () => void): Promise<unknown>
  currentWindow?: any
  mindmapView?: any
  floatMindMapView?: any
  setUIStatusByConfig?(config: Record<string, unknown>): unknown
  setUIStatusByConfigAsync?(config: Record<string, unknown>): Promise<unknown>
  openNoteEditor?(noteId: string): unknown
  selectNotesInMindmap?(noteIds: string[], showMuiltpleSelectionToolbar?: boolean): Promise<unknown>
}

declare const MNNote: {
  new: (note: unknown, alert?: boolean) => {
    note?: unknown
    addAsChildNote?(note: unknown, colorInheritance?: boolean): unknown
  } | undefined
}

declare const MNCommand: {
  canSyncBookToMindMap?(): boolean
}

declare const MNButton: {
  new: (config?: Record<string, unknown>, superView?: any) => any
  addLongPressGesture: (view: any, target: any, action: string, duration?: number) => any
}

declare const __MNAM_WEB_PANEL_GLOBAL__: any
declare const NSString: any
