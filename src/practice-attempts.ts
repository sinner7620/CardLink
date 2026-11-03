import { getLocalDataByKey, setLocalDataByKey } from 'marginnote'

const KEY = 'cardlink.practice-answer-check.v1'
const ATTEMPTS_KEY = 'cardlink.practice-attempts.v1'
const scopeKey = (topicid: string, noteid: string) => `${topicid.toLowerCase()}:${noteid.toLowerCase()}`

/** Ordinary native annotations have no host practice metadata. Keep only their
 * identity and CardLink feedback locally; the host still owns all ink. */
export function savePracticeAttempt(topicid: string, noteid: string, commentId: string, self?: 'got' | 'again'): void {
  const all = getLocalDataByKey(ATTEMPTS_KEY) || {}, key = scopeKey(topicid, noteid)
  const previous = all[key]?.[commentId]
  setLocalDataByKey({ ...all, [key]: { ...all[key], [commentId]: {
    ...previous, createdAt: previous?.createdAt || Date.now() / 1000, ...(self ? { self } : {})
  } } }, ATTEMPTS_KEY)
}
export function attemptAnswerChecked(noteid: string, commentId: string): boolean | undefined {
  return getLocalDataByKey(KEY)?.[noteid]?.[commentId]
}
export function saveAttemptAnswerChecked(noteid: string, commentId: string, checked: boolean): void {
  const all = getLocalDataByKey(KEY) || {}
  setLocalDataByKey({ ...all, [noteid]: { ...all[noteid], [commentId]: checked } }, KEY)
}

export function practiceHistoryRows(comments: any[], topicid: string, noteid: string) {
  const local = getLocalDataByKey(ATTEMPTS_KEY)?.[scopeKey(topicid, noteid)] || {}
  return comments.filter(c => c.cardAnnotation && (local[c.commentId] || (c.practice &&
    String(c.practice.topic).toLowerCase() === topicid.toLowerCase() &&
    (!c.practice.card || String(c.practice.card).toLowerCase() === noteid.toLowerCase()))))
    .map(c => !local[c.commentId] ? c : { ...c, createdAt: c.createdAt || local[c.commentId].createdAt,
      practice: { topic: topicid, card: noteid, self: local[c.commentId].self, reasonLabel: null, source: 'CardLink-local' } })
    .sort((a, b) => {
      const time = (value: any) => { const n = Number(value || 0); return n < 1e12 ? n * 1000 : n }
      return time(a.createdAt) - time(b.createdAt) || a.index - b.index
    })
    .map((c, i) => ({ ...c, ordinal: i + 1 })).reverse()
}
