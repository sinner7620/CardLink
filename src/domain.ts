export interface AnswerLike {
  id: string
  titles: string[]
  tags: string[]
  comments: string[]
  excerpts: string[]
  children: Array<{ title: string; text: string }>
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[？?。．.!！：:]/g, "")
    .trim()
    .toLowerCase()
}

export function buildIndex<T extends Pick<AnswerLike, "id" | "titles">>(
  answers: T[]
): Map<string, T[]> {
  const index = new Map<string, T[]>()
  const seenByKey = new Map<string, Set<string>>()

  for (const answer of answers) {
    for (const title of answer.titles) {
      const key = normalizeTitle(title)
      if (!key) continue
      const seen = seenByKey.get(key) ?? new Set<string>()
      if (seen.has(answer.id)) continue
      seen.add(answer.id)
      seenByKey.set(key, seen)
      index.set(key, [...(index.get(key) ?? []), answer])
    }
  }
  return index
}

export function rankAnswers<T extends Pick<AnswerLike, "tags">>(answers: T[]): T[] {
  return [...answers].sort((a, b) => {
    const aStandard = a.tags.some(tag => normalizeTitle(tag) === "标准答案")
    const bStandard = b.tags.some(tag => normalizeTitle(tag) === "标准答案")
    return Number(bStandard) - Number(aStandard)
  })
}

export function excludeAnswerNoteId<T extends { noteId?: string }>(
  answers: T[],
  excludedNoteId: string
): T[] {
  const target = excludedNoteId.trim()
  if (!target) return [...answers]
  return answers.filter(answer => String(answer.noteId ?? "").trim() !== target)
}

/** Keep a multi-selection inside the group that contains the card which opened the action. */
export function filterSelectionToAnchorGroup<T>(
  items: T[],
  anchor: T | undefined,
  groupOf: (item: T) => string
): T[] {
  if (!anchor || items.length < 2) return [...items]
  const anchorGroup = groupOf(anchor)
  if (!anchorGroup) return [...items]
  return items.filter(item => groupOf(item) === anchorGroup)
}

export function pathMatchScore(questionPath: string[], answerPath: string[]): number {
  const question = questionPath.map(normalizeTitle).filter(Boolean)
  const answer = answerPath.map(normalizeTitle).filter(Boolean)
  let score = 0
  for (let index = 0; index < Math.min(question.length, answer.length); index++) {
    if (question[index] !== answer[index]) break
    score += Math.max(1, 100 - index)
  }
  return score
}

/** The same MarginNote card can be represented by more than one mind-map node. */
export function distinctAnswers<T extends { id: string; noteId?: string }>(answers: T[]): T[] {
  const seen = new Set<string>()
  return answers.filter(answer => {
    const identity = String(answer.noteId || answer.id).trim()
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/** Only expose a chooser while the ranked result remains genuinely ambiguous. */
export function answerCandidatesForDisplay<
  T extends { id: string; noteId?: string; pathTitles: string[]; tags: string[] }
>(answers: T[], questionPath: string[]): T[] {
  const distinct = distinctAnswers(answers)
  if (distinct.length < 2) return []
  const scores = distinct.map(answer => pathMatchScore(questionPath, answer.pathTitles))
  const topScore = scores[0]
  const tiedTop = distinct.filter((_answer, index) => scores[index] === topScore)
  if (topScore > 0 && tiedTop.length === 1) return []
  const standardTop = tiedTop.filter(answer =>
    answer.tags.some(tag => normalizeTitle(tag) === "标准答案")
  )
  return standardTop.length === 1 ? [] : distinct
}

export function extractAnswer(answer: AnswerLike): string {
  const comments = answer.comments.map(text => text.trim()).filter(Boolean)
  if (comments.length) return comments.join("\n\n")

  const excerpts = answer.excerpts.map(text => text.trim()).filter(Boolean)
  if (excerpts.length) return excerpts.join("\n\n")

  const children = answer.children
    .map(child => {
      const title = child.title.trim()
      const text = child.text.trim()
      if (!title && !text) return ""
      return title ? `【${title}】${text ? `\n${text}` : ""}` : text
    })
    .filter(Boolean)
  return children.join("\n\n")
}
