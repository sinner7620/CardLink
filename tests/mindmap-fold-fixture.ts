import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import { usesSubcardAnswers } from "../src/binding"

/**
 * 折叠优先测试宿主：把 JSB 侧 `mindmapBranchClose`、当前画布渲染节点与
 * 场景面板 `foldBranch` 放在同一份可变状态上，让折叠写入、读回与遮盖使用
 * 同一个"设备"视图。场景面板默认按请求改写折叠字段并同步渲染结果；
 * 通过 `behaviour` 可模拟读回不变、回执缺字段、错误与跳过。
 */

export interface FoldNoteSpec {
  children?: string[]
  folded?: boolean
  notebookId?: string
  colorIndex?: number
}

export interface FoldSceneBehaviour {
  /** 写入后是否真的改变折叠字段与渲染结果；false 模拟字段未刷新。 */
  apply?: boolean
  error?: string
  /** 已派发但结果未知（例如 8 秒超时），错误对象带 dispatched。 */
  rejectDispatched?: boolean
  skipped?: string
  topicid?: string
  sceneToken?: string
  /** 写入前回调，用于模拟宿主在写入前重新展开。 */
  beforeWrite?: (request: { noteid: string; folded: boolean }) => void
}

export interface FoldHost {
  notebookId: string
  notes: Record<string, any>
  /** 模型节点列表（MindMapView.mindmapNodes 的等价物）：**不是**画面证据。 */
  rendered: string[]
  /** 选中视图（MindMapView.selViewLst 的等价物）：只有它算画面证据。 */
  selected: Map<string, any>
  calls: Array<{ noteid: string; folded: boolean; notebookId: string; reason?: string }>
  behaviour: FoldSceneBehaviour
  scene: any
  setFolded(noteId: string, folded: boolean): void
  showTree(noteId: string, folded: boolean): void
  /** 模拟宿主刷新模型列表：把该题的下层节点从模型列表里移除。 */
  dropModel(noteId: string): void
  /** 模拟宿主给出某张卡的选中视图；attached=false 表示有选中记录但视图未附着。 */
  select(noteId: string, attached?: boolean): void
  unselect(noteId: string): void
  descendants(noteId: string): string[]
}

export function createFoldHost(options: {
  notebookId?: string
  notes?: Record<string, FoldNoteSpec>
  available?: boolean
  token?: string
  rendered?: string[]
} = {}): FoldHost {
  const notebookId = options.notebookId ?? "book"
  const notes: Record<string, any> = {}
  for (const [id, spec] of Object.entries(options.notes ?? {})) {
    notes[id] = {
      noteId: id,
      notebookId: spec.notebookId ?? notebookId,
      colorIndex: spec.colorIndex ?? 0,
      ...(spec.folded === undefined ? {} : { mindmapBranchClose: spec.folded ? 1 : 0 }),
      get childNotes() { return (spec.children ?? []).map(child => notes[child] ?? { noteId: child }) }
    }
  }
  const rendered = [...(options.rendered ?? [])]
  const selected = new Map<string, any>()
  const calls: FoldHost["calls"] = []
  const behaviour: FoldSceneBehaviour = {}
  const scene = {
    enabled: () => options.available !== false,
    sceneToken: () => options.available === false ? "" : (options.token ?? "scene-token-1"),
    foldBranch: (_owner: any, request: any) => {
      calls.push({ noteid: request.noteid, folded: request.folded === true, notebookId: request.notebookId, reason: request.reason })
      behaviour.beforeWrite?.({ noteid: request.noteid, folded: request.folded === true })
      if (behaviour.rejectDispatched) return Promise.reject(Object.assign(new Error("分支折叠请求超时，结果未确认"), { dispatched: true }))
      if (behaviour.error) return Promise.reject(new Error(behaviour.error))
      if (behaviour.skipped) return Promise.resolve({
        noteid: request.noteid, folded: request.folded === true,
        skipped: { noteid: request.noteid, reason: behaviour.skipped },
        topicid: behaviour.topicid ?? request.notebookId ?? notebookId
      })
      if (behaviour.apply !== false) {
        host.setFolded(request.noteid, request.folded === true)
        host.showTree(request.noteid, request.folded === true)
      }
      return Promise.resolve({
        noteid: request.noteid,
        folded: request.folded === true,
        topicid: behaviour.topicid ?? (request.notebookId || notebookId),
        sceneTopic: request.notebookId || notebookId,
        sceneToken: behaviour.sceneToken ?? (options.available === false ? "" : (options.token ?? "scene-token-1"))
      })
    }
  }
  const host: FoldHost = {
    notebookId, notes, rendered, selected, calls, behaviour, scene,
    setFolded(noteId, folded) {
      const note = notes[noteId]
      if (note) note.mindmapBranchClose = folded ? 1 : 0
    },
    showTree(noteId, folded) {
      // 2026-11-23 设备日志：收起后 `mindmapNodes` 仍保留答案 ID（模型列表不随画面变化）。
      if (folded) return
      const ids = host.descendants(noteId)
      rendered.splice(0, rendered.length, ...rendered.filter(id => !ids.includes(id)), ...ids)
    },
    dropModel(noteId) {
      const ids = host.descendants(noteId)
      rendered.splice(0, rendered.length, ...rendered.filter(id => !ids.includes(id)))
    },
    select(noteId, attached = true) {
      const canvas: any = { hidden: false, alpha: 1, layer: { opacity: 1 }, superview: { hidden: false, alpha: 1, layer: { opacity: 1 }, superview: { hidden: false, alpha: 1, layer: { opacity: 1 } } } }
      selected.set(noteId, {
        hidden: false, alpha: 1, layer: { opacity: 1 },
        superview: attached ? canvas : undefined
      })
    },
    unselect(noteId) {
      selected.delete(noteId)
    },
    descendants(noteId) {
      const result: string[] = []
      const walk = (id: string) => {
        for (const child of notes[id]?.childNotes ?? []) {
          const childId = String(child?.noteId ?? "")
          if (!childId || result.includes(childId)) continue
          result.push(childId)
          walk(childId)
        }
      }
      walk(noteId)
      return result
    }
  }
  return host
}

export interface FoldModuleOptions {
  binding?: any
  settings?: Record<string, unknown>
  /** 答案索引里的卡片身份；null 表示索引不可用。 */
  answerIds?: Set<string> | null
}

/** 在当前上下文中加载真实的 `src/mindmap-fold.ts`，只替换 JSB 与绑定来源。 */
export function loadMindmapFold(host: FoldHost, options: FoldModuleOptions = {}) {
  const scope: any = {
    exports: {},
    console: { log() {} },
    __MNAM_SCENE_WORKBENCH_GLOBAL__: host.scene,
    require: (name: string) => name === "marginnote"
      ? {
          delay: () => Promise.resolve(),
          MN: {
            get currnetNotebookId() { return host.notebookId },
            notebookController: {
              get notebookId() { return host.notebookId },
              get mindmapView() {
                return {
                  mindmapNodes: host.rendered.map(noteId => ({ note: { noteId } })),
                  superview: { hidden: false, alpha: 1, layer: { opacity: 1 } },
                  bounds: { x: 0, y: 0, width: 1024, height: 768 },
                  selViewLst: [...host.selected.entries()].map(([noteId, view]) => ({ note: { note: { noteId } }, view }))
                }
              }
            },
            db: { getNoteById: (noteId: string) => host.notes[noteId] }
          }
        }
      : name === "./binding"
        ? { getBindingForMode: () => options.binding, usesSubcardAnswers }
        : name === "./matcher"
          ? {
              answerReferenceIds: () => {
                if (!options.answerIds) throw new Error("indexNotReady")
                return options.answerIds
              }
            }
          : name === "./note-navigation" ? { recordRuntimeState() {} }
            : name === "./settings" ? { loadMatcherSettings: () => ({ allowSameStudySetMindMap: true, ...(options.settings ?? {}) }) }
              : name === "./store" ? { loadBindings: () => ({}) }
                : {}
  }
  runInNewContext(transpileModule(readFileSync("src/mindmap-fold.ts", "utf8"), {
    compilerOptions: { module: 1, target: 7 }
  }).outputText, scope)
  return scope.exports as {
    foldSceneSession: (owner: any) => { available: boolean; token: string; reason?: string }
    foldEligibility: (notebookId: string, noteId: string, rootNodeId?: string) => { eligible: boolean; reason?: string; capability: boolean }
    readBranchFolded: (noteId: string) => boolean | undefined
    foldVisibility: (noteId: string) => {
      folded?: boolean; visibleAnswers: number; detachedSelections: number
      source: string; canvasReady: boolean; targetAttached: boolean; children: number
    }
    describeVisibility: (visibility: any) => string
    foldConfirmation: (noteId: string, folded: boolean) => { state: string; visibility: any }
    directChildIds: (noteId: string) => string[]
    writeBranchFolded: (request: any) => Promise<any>
    logFoldEvent: (label: string, detail?: string) => void
  }
}

/** 子卡绑定：直接子卡即答案。 */
export function subcardBinding(extra: Record<string, unknown> = {}) {
  return { notebookId: "book", designatedAnswer: "subcard" as const, questionColors: [0, 1, 2, 3], ...extra }
}
