// 官方文档（MbBookNote.appendNoteLink）给出的笔记链接格式是
// marginnote4app://note/{noteId}；marginnote3app 仅作为旧版本兼容回退保留。
export function noteReferenceUrl(noteId: string): string {
  return `marginnote4app://note/${encodeURIComponent(noteId)}`
}

export function noteReferenceUrlCandidates(noteId: string): string[] {
  return [noteReferenceUrl(noteId), `marginnote3app://note/${encodeURIComponent(noteId)}`]
}
