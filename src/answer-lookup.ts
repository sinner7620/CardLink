import { MN, NodeNote } from "marginnote"
import { BindingTarget } from "./binding"
import {
  findAnswerByReference,
  findAnswers,
  findAnswersByRegex,
  toIndexedAnswer,
  IndexedAnswer
} from "./matcher"
import { pairedAnswerReference } from "./ordered-pairing"

export function findAnswersForQuestion(
  target: BindingTarget,
  question: NodeNote,
  titles: string[],
  path: string[]
): IndexedAnswer[] {
  const useSubcards = target.selectionMode === "mixed" || target.designatedAnswer === "subcard"
  const useMindMap = target.selectionMode === "mixed" || target.designatedAnswer !== "subcard"
  const questionColor = question.note?.colorIndex
  const subcards = useSubcards && typeof questionColor === "number" && target.questionColors?.includes(questionColor)
    ? Array.from(question.childNodes ?? []).flatMap(child => {
        try {
          const note = child.note
          const sourceNotebookId = String(question.note?.notebookId ?? (question as any).notebookId ?? MN.currnetNotebookId ?? target.notebookId)
          return note ? [toIndexedAnswer(note, sourceNotebookId).answer].filter((answer): answer is IndexedAnswer => Boolean(answer)) : []
        } catch { return [] }
      })
    : []
  if (!useMindMap) return subcards
  if (target.matchMode === "regex") {
    const matched = target.regexRules
      ? findAnswersByRegex(target, titles, target.regexRules)
      : []
    return [...subcards, ...matched]
  }
  const paired = pairedAnswerReference(target, question)
  if (paired) {
    const answer = findAnswerByReference(target, paired.noteId, paired.nodeId)
    if (answer) return [...subcards, answer]
  }
  return [...subcards, ...findAnswers(target, titles, path)]
}
