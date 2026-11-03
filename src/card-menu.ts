import type { CardMistakeFeedback } from './card-mistake-panel'
import type { ErrorReason } from './error-reasons'
import type { MistakeLevel } from './mistake-domain'

export type CardMenuCommandId = "findAnswer" | "markMistake"
export interface CardMenuTarget { noteID: string; notebookID: string }
export interface CardMistakeSaveReceipt { recordId: string; historyId: string; level: MistakeLevel }
export interface CardMenuDependencies {
  resolve(noteID: string): CardMenuTarget
  findAnswer(target: CardMenuTarget): Promise<void>
  currentLevel(target: CardMenuTarget): 0 | 1 | 2 | undefined
  showFeedback(target: CardMenuTarget, current: 0 | 1 | 2 | undefined, submit: (feedback: CardMistakeFeedback) => Promise<void>): Promise<{ cancelled?: boolean }>
  mark(target: CardMenuTarget, feedback: CardMistakeFeedback): Promise<CardMistakeSaveReceipt | undefined>
  supplementReason(target: CardMenuTarget, reason: ErrorReason, receipt: CardMistakeSaveReceipt): Promise<void>
  notebookID(): string | undefined
}

// The menu event owns the target, even if selection changes while feedback is open.
export async function runCardMenuCommand(command: CardMenuCommandId, noteID: string, deps: CardMenuDependencies): Promise<{ cancelled?: boolean }> {
  if (command !== "findAnswer" && command !== "markMistake") throw new Error("未知卡片菜单命令")
  if (typeof noteID !== "string" || !noteID.trim()) throw new Error("菜单未提供有效的卡片ID")
  const target = deps.resolve(noteID.trim())
  if (command === "findAnswer") { await deps.findAnswer(target); return {} }
  let receipt: CardMistakeSaveReceipt | undefined
  return deps.showFeedback(target, deps.currentLevel(target), async feedback => {
    if (deps.notebookID() !== target.notebookID) throw new Error("学习集已切换，请在目标卡片上重新标记")
    if (![0, 1, 2].includes(feedback.level)) throw new Error("请选择有效的掌握等级")
    const reason = feedback.level === 2 ? undefined : feedback.reason
    if (reason) {
      if (!receipt || receipt.level !== feedback.level) throw new Error('请先成功保存本次掌握等级，再补充错因')
      await deps.supplementReason(target, reason, { ...receipt })
      return
    }
    // A new grade attempt supersedes the earlier receipt even if this save fails.
    receipt = undefined
    const saved = await deps.mark(target, { level: feedback.level })
    if (!saved) throw new Error('等级未能保存，请重试')
    if (saved.recordId !== `${target.notebookID}:${target.noteID}` || saved.level !== feedback.level ||
      typeof saved.historyId !== 'string' || !saved.historyId) throw new Error('等级保存回执与目标卡片不一致，请重试')
    receipt = { ...saved }
  })
}
