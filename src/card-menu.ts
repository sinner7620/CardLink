export type CardMenuCommandId = "findAnswer" | "markMistake"
export interface CardMenuTarget { noteID: string; notebookID: string }
export interface CardMenuDependencies {
  resolve(noteID: string): CardMenuTarget
  findAnswer(target: CardMenuTarget): Promise<void>
  currentLevel(target: CardMenuTarget): 0 | 1 | 2 | undefined
  chooseLevel(level?: 0 | 1 | 2): Promise<0 | 1 | 2 | undefined>
  mark(target: CardMenuTarget, level: 0 | 1 | 2): Promise<void>
  notebookID(): string | undefined
}

// The menu event owns the target. Never consult current selection after a
// picker has opened; that selection may change while the user decides.
export async function runCardMenuCommand(command: CardMenuCommandId, noteID: string, deps: CardMenuDependencies): Promise<{ cancelled?: boolean }> {
  if (command !== "findAnswer" && command !== "markMistake") throw new Error("未知卡片菜单命令")
  if (typeof noteID !== "string" || !noteID.trim()) throw new Error("菜单未提供有效的卡片ID")
  const target = deps.resolve(noteID.trim())
  if (command === "findAnswer") { await deps.findAnswer(target); return {} }
  const level = await deps.chooseLevel(deps.currentLevel(target))
  if (level === undefined) return { cancelled:true }
  if (deps.notebookID() !== target.notebookID) throw new Error("学习集已切换，请在目标卡片上重新标记")
  await deps.mark(target, level)
  return {}
}
