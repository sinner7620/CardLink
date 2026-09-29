import { getLocalDataByKey, setLocalDataByKey } from "marginnote"

type AnswerReference = { notebookId: string; noteId: string; id: string }

function storageKey(notebookId: string, noteId: string): string {
  return `cardlink.answer-choice.v1.${encodeURIComponent(notebookId)}.${encodeURIComponent(noteId)}`
}

/** Store identity, never position: rebuilding an index must not bind another answer. */
export function rememberAnswer(notebookId: string, noteId: string, answer: AnswerReference): void {
  if (!notebookId || !noteId) return
  setLocalDataByKey({ notebookId: answer.notebookId, noteId: answer.noteId, id: answer.id }, storageKey(notebookId, noteId))
}

export function preferredAnswer<T extends AnswerReference>(notebookId: string, noteId: string, candidates: T[]): T | undefined {
  const saved = getLocalDataByKey(storageKey(notebookId, noteId)) as AnswerReference | undefined
  const matches = candidates.filter(item => item.notebookId === saved?.notebookId && item.noteId === saved?.noteId)
  return matches.find(item => item.id === saved?.id) ?? matches[0] ?? candidates[0]
}
