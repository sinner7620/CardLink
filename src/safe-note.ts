export interface SafeNoteData {
  titles: string[]
  tags: string[]
  comments: string[]
  excerpts: string[]
  children: Array<{ title: string; text: string }>
  brokenLinks: number
}

/**
 * Per the official NoteComment reference, MarginNote 4 stores linked notes as
 * plain TextNote comments whose text is `marginnote4app://note/{noteId}`
 * (older builds/cards use the marginnote3app variant). Comments that are note
 * links must be resolved like LinkNote targets instead of being dropped.
 */
const NOTE_LINK_PATTERN = /^marginnote(?:3|4)app:\/\/note\/([A-Za-z0-9]+)/

export function noteLinkTarget(text: string): string {
  return NOTE_LINK_PATTERN.exec(text.trim())?.[1] ?? ""
}

function arrayOf<T>(value: unknown): T[] {
  try {
    return value ? Array.from(value as ArrayLike<T>) : []
  } catch {
    return []
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function commentsOf(note: any): any[] {
  return arrayOf(note?.comments)
}

function directContent(
  note: any,
  resolveNote: (noteId: string) => any
): { comments: string[]; excerpts: string[]; tags: string[]; brokenLinks: number } {
  const rawComments = commentsOf(note)
  const comments: string[] = []
  const excerpts: string[] = []
  const tags: string[] = []
  let brokenLinks = 0

  const excerpt = textOf(note?.excerptText)
  if (excerpt) excerpts.push(excerpt)

  for (const comment of rawComments) {
    const type = String(comment?.type ?? "")
    const text = textOf(comment?.text)
    if (type === "TextNote" && text.startsWith("#")) {
      tags.push(...text.split(/\s+/).filter(tag => tag.startsWith("#")).map(tag => tag.slice(1)))
    } else if ((type === "TextNote" || type === "HtmlNote") && text) {
      const linkedId = type === "TextNote" ? noteLinkTarget(text) : ""
      if (linkedId) {
        const linked = resolveNote(linkedId)
        if (!linked) {
          brokenLinks++
          continue
        }
        const linkedExcerpt = textOf(linked.excerptText)
        if (linkedExcerpt) excerpts.push(linkedExcerpt)
        continue
      }
      if (!text.includes("marginnote3app") && !text.includes("marginnote4app")) comments.push(text)
    } else if (type === "LinkNote") {
      const embeddedText = textOf(comment?.q_htext)
      const hasEmbeddedImage = Boolean(textOf(comment?.q_hpic?.paint))
      if (embeddedText) excerpts.push(embeddedText)
      if (embeddedText || hasEmbeddedImage) continue
      const noteId = textOf(comment?.noteid)
      const linked = noteId ? resolveNote(noteId) : undefined
      if (!linked) {
        brokenLinks++
        continue
      }
      const linkedExcerpt = textOf(linked.excerptText)
      if (linkedExcerpt) excerpts.push(linkedExcerpt)
    }
  }

  return { comments, excerpts, tags, brokenLinks }
}

export function readSafeNote(
  note: any,
  resolveNote: (noteId: string) => any
): SafeNoteData {
  const own = directContent(note, resolveNote)
  const title = textOf(note?.noteTitle)
  const titles = title ? title.split(/\s*[;；]\s*/).filter(Boolean) : []
  const children: Array<{ title: string; text: string }> = []
  let brokenLinks = own.brokenLinks

  for (const child of arrayOf<any>(note?.childNotes)) {
    if (!child) continue
    const childContent = directContent(child, resolveNote)
    brokenLinks += childContent.brokenLinks
    children.push({
      title: textOf(child.noteTitle),
      text: [...childContent.comments, ...childContent.excerpts].join("\n\n")
    })
  }

  return {
    titles,
    tags: own.tags,
    comments: own.comments,
    excerpts: own.excerpts,
    children,
    brokenLinks
  }
}
