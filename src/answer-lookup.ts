import { MN, NodeNote } from "marginnote"
import { BindingTarget, usesSubcardAnswers } from "./binding"
import {
  findAnswerByReference,
  findAnswers,
  findAnswersByRegex,
  toIndexedAnswer,
  IndexedAnswer
} from "./matcher"
import { pairedAnswerReference } from "./ordered-pairing"
import { normalizeParentTitle } from "./ordered-pairing-domain"
import { recordRuntimeState } from "./note-navigation"

export function findAnswersForQuestion(
  target: BindingTarget,
  question: NodeNote,
  titles: string[],
  path: string[]
): IndexedAnswer[] {
  const useMindMap = target.selectionMode === "mixed" || target.designatedAnswer !== "subcard"
  const questionColor = question.note?.colorIndex
  const subcards = usesSubcardAnswers(target, questionColor)
    ? Array.from(question.childNodes ?? []).flatMap(child => {
        try {
          const note = child.note
          const sourceNotebookId = String(question.note?.notebookId ?? (question as any).notebookId ?? MN.currnetNotebookId ?? target.notebookId)
          return note ? [toIndexedAnswer(note, sourceNotebookId).answer].filter((answer): answer is IndexedAnswer => Boolean(answer)) : []
        } catch { return [] }
      })
    : []
  if (!useMindMap) return subcards
  // Paths are root-first. Only the direct parent identifies the containing
  // chapter; the source and answer mind-map roots can have different names.
  // No parent match means no map answer, including single candidates/fallbacks.
  const parent = normalizeParentTitle(path[path.length - 1] || "")
  const filterByParent = (answers: IndexedAnswer[]): IndexedAnswer[] => {
    const matched = parent ? answers.filter(answer => {
      const answerPath = answer.pathTitles
      return normalizeParentTitle(answerPath[answerPath.length - 1] || "") === parent
    }) : []
    recordRuntimeState("答案匹配", "parent.filter", `mode=${target.matchMode || "title"} parent=${parent || "(缺失)"} before=${answers.length} after=${matched.length}`)
    return matched
  }
  if (target.matchMode === "regex") {
    const matched = target.regexRules
      ? findAnswersByRegex(target, titles, target.regexRules)
      : []
    return [...subcards, ...filterByParent(matched)]
  }
  const paired = pairedAnswerReference(target, question)
  if (paired) {
    const answer = findAnswerByReference(target, paired.noteId, paired.nodeId)
    if (answer) {
      const matched = filterByParent([answer])
      if (matched.length) return [...subcards, ...matched]
    }
  }
  return [...subcards, ...filterByParent(findAnswers(target, titles, path))]
}
