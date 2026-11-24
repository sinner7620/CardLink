import { extractAnswer, type AnswerLike } from "./domain.ts"
import { readSafeNote } from "./safe-note.ts"

/**
 * v2.16 §6.1：设备端答案正文投影（纯函数，无宿主 API）。
 *
 * 输入是插件现有只读候选逻辑（绑定 → 答案匹配索引 → 去重 → 排除题目卡片）
 * 得到的候选卡片与一个作用域感知的卡片解析器；输出只有两种情况：
 * - 唯一匹配、来源可定位、有文本 → 投影正文与实际答案笔记身份；
 * - 否则显式不可用/缺失，并给出原因。
 *
 * 严禁把答案脑图根、根标题、预览 HTML 或任意候选当成本题答案：
 * 这里只接受调用方传入的**已匹配答案卡片**，且必须恰好一张。
 */

/** 候选答案卡片（IndexedAnswer 的结构子集，便于纯函数测试）。 */
export type AnswerCandidate = AnswerLike & {
  noteId: string
  notebookId: string
  pathTitles?: string[]
}

export type AnswerProjectionReason =
  | "answer_source_unbound"
  | "answer_not_found"
  | "answer_index_unavailable"
  | "answer_ambiguous"
  | "answer_note_unavailable"
  | "answer_text_empty"
  | "source_note_unavailable"

export type AnswerTextProjection =
  | {
      status: "projected"
      text: string
      source: { notebookId: string; noteId: string }
      title?: string
      path?: string
      candidateCount: 1
    }
  | {
      status: "unavailable" | "missing"
      reason: AnswerProjectionReason
      candidateCount?: number
    }

/** 匹配阶段结果（由插件匹配逻辑提供；与 matcher 的 IndexedAnswer 兼容）。 */
export type AnswerMatchOutcome =
  | { status: "ok"; candidates: AnswerCandidate[] }
  | { status: "unbound" | "not-found" | "index-missing"; candidates: [] }

/** 跨学习集卡片解析：只按 (notebookId, noteId) 直取，不做模糊查找。 */
export type AnswerNoteResolver = (notebookId: string, noteId: string) => unknown

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * 唯一匹配判定：按笔记身份去重（同一卡片可能有多个脑图节点），
 * 0 张 → not_found；>1 张 → ambiguous（不猜、不合并、不按标题择优）。
 */
export function uniqueAnswerCandidate(candidates: AnswerCandidate[]): AnswerTextProjection | AnswerCandidate {
  const seen = new Set<string>()
  const distinct: AnswerCandidate[] = []
  for (const candidate of candidates) {
    const identity = textOf(candidate.noteId) || textOf(candidate.id)
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    distinct.push(candidate)
  }
  if (distinct.length === 0) return { status: "unavailable", reason: "answer_not_found", candidateCount: 0 }
  if (distinct.length > 1) return { status: "unavailable", reason: "answer_ambiguous", candidateCount: distinct.length }
  return distinct[0] as AnswerCandidate
}

/**
 * 从已匹配的答案卡片读取纯文本：评论 > 摘录 > 子卡片（与插件现有抽取口径一致），
 * 不渲染 HTML、不读图片/手写。匹配笔记不可读时显式 unavailable。
 */
export function extractMatchedAnswerText(
  candidate: AnswerCandidate,
  resolveNote: AnswerNoteResolver,
): AnswerTextProjection {
  const notebookId = textOf(candidate.notebookId)
  const noteId = textOf(candidate.noteId)
  if (!notebookId || !noteId) return { status: "unavailable", reason: "answer_source_unbound" }
  const note = resolveNote(notebookId, noteId)
  if (!note) return { status: "unavailable", reason: "answer_note_unavailable" }
  const safe = readSafeNote(note, (linkedId) => resolveNote(notebookId, linkedId))
  const text = extractAnswer({ id: noteId, ...safe }).trim()
  if (!text) return { status: "missing", reason: "answer_text_empty" }
  const path = (candidate.pathTitles ?? []).filter(Boolean).join(" › ")
  return {
    status: "projected",
    text,
    source: { notebookId, noteId },
    ...(textOf(candidate.titles[0]) ? { title: textOf(candidate.titles[0]) } : {}),
    ...(path ? { path } : {}),
    candidateCount: 1,
  }
}

/** 匹配结果 → 投影（唯一入口；所有不可用分支都显式返回原因）。 */
export function projectAnswerText(
  match: AnswerMatchOutcome,
  resolveNote: AnswerNoteResolver,
): AnswerTextProjection {
  if (match.status === "unbound") return { status: "unavailable", reason: "answer_source_unbound" }
  if (match.status === "index-missing") return { status: "unavailable", reason: "answer_index_unavailable" }
  if (match.status === "not-found") return { status: "unavailable", reason: "answer_not_found", candidateCount: 0 }
  const unique = uniqueAnswerCandidate(match.candidates)
  if ("status" in unique) return unique
  return extractMatchedAnswerText(unique, resolveNote)
}
