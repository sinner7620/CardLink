import type { MbBookNote } from "marginnote"

// 官方文档（MbBookNote.appendNoteLink）给出的笔记链接格式是
// marginnote4app://note/{noteId}；marginnote3app 仅作为旧版本兼容回退保留。
export function noteReferenceUrl(noteId: string): string {
  return `marginnote4app://note/${encodeURIComponent(noteId)}`
}

export function notebookReferenceUrl(notebookId: string): string {
  return `marginnote4app://notebook/${encodeURIComponent(notebookId)}`
}

export function noteReferenceUrlCandidates(noteId: string): string[] {
  return [noteReferenceUrl(noteId), `marginnote3app://note/${encodeURIComponent(noteId)}`]
}
export function commentNoteReferenceId(comment: MbBookNote["comments"][number]): string | undefined {
  if (comment.type !== "TextNote" || typeof comment.text !== "string") return
  const match = /^marginnote[34]app:\/\/note\/([^/?#\s]+)$/.exec(comment.text.trim())
  if (!match) return
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

export function linkedNoteIds(note: Pick<MbBookNote, "linkedNotes" | "comments">): string[] {
  const ids = new Set<string>()
  for (const link of Array.from(note.linkedNotes ?? [])) {
    if (!link.summary && link.noteid) ids.add(link.noteid)
  }
  for (const comment of Array.from(note.comments ?? [])) {
    const noteId = commentNoteReferenceId(comment)
    if (noteId) ids.add(noteId)
  }
  return [...ids]
}
