const legacyMarker = /^CardLink 答案批注 ([a-f0-9]{64}):([a-f0-9]{64})$/
const tagMarker = /^cardlink-answer-ink-([a-f0-9]{64})-([a-f0-9]{64})$/
const htmlMarker = /<(?:details|img)\b[^>]*\sid=["'](cardlink-answer-ink-[a-f0-9]{64}-[a-f0-9]{64})["']/i

export function answerInkCommentMarker(group: string, imageHash: string): string {
  return `cardlink-answer-ink-${group}-${imageHash}`
}

export function answerInkCommentIdentity(comment?: { text?: unknown; html?: unknown; tag?: unknown }): { group: string; imageHash: string } | undefined {
  const match = String(comment?.tag || "").match(tagMarker) ||
    String(comment?.html || "").match(htmlMarker)?.[1].match(tagMarker) ||
    String(comment?.text || "").match(legacyMarker)
  return match ? { group: match[1], imageHash: match[2] } : undefined
}
