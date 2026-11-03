import { getLocalDataByKey, setLocalDataByKey } from "marginnote"
import { Bindings, getBindingForMode as resolveBinding } from "./binding"
import { loadMatcherSettings } from "./settings"

export * from "./binding"

const STORAGE_KEY = "mn4-answer-matcher.bindings.v1"
const BACKUP_KEY = "marginnote.extension.mn4-answer-matcher.bindings.v1"

export function loadBindings(): Bindings {
  let value = getLocalDataByKey(STORAGE_KEY)
  if (!value || typeof value !== "object") {
    try {
      value = NSUserDefaults.standardUserDefaults().objectForKey(BACKUP_KEY)
      if (typeof value === "string") value = JSON.parse(value)
      if (value && typeof value === "object") setLocalDataByKey(value, STORAGE_KEY)
    } catch {
      value = undefined
    }
  }
  if (!value || typeof value !== "object") return {}
  return { ...(value as Bindings) }
}

export function saveBindings(bindings: Bindings): void {
  setLocalDataByKey(bindings, STORAGE_KEY)
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    defaults.setObjectForKey(JSON.stringify(bindings), BACKUP_KEY)
    defaults.synchronize()
  } catch {
    // The add-on local store remains the primary copy on older MarginNote builds.
  }
}

export function backupBindings(): void {
  saveBindings(loadBindings())
}

/** Global colors apply to every binding in addition to its local colors. */
export function getBindingForMode(bindings: Bindings, notebookId: string, rootNodeId: string | undefined, scoped: boolean) {
  const target = resolveBinding(bindings, notebookId, rootNodeId, scoped)
  const colors = loadMatcherSettings().globalQuestionColors
  return target && colors?.length ? { ...target, questionColors: [...new Set([...colors, ...(target.questionColors || [])])] } : target
}
