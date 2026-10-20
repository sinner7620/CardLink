import { usesSubcardAnswers, type BindingTarget } from "./binding"

/** Filter actual answer cards; a same-map index also contains the questions. */
export function filterMistakeAnswerCards<T>(nodes: T[], options: {
  target?: BindingTarget
  notebookId: string
  rootNodeId: string
  parentOf: (node: T) => T | undefined
  colorOf: (node: T) => number | undefined
  isIndexedAnswer: (node: T) => boolean
}): T[] {
  const { target } = options
  if (!target) return nodes
  const separateAnswerMap = target.designatedAnswer !== "subcard" || target.selectionMode === "mixed"
  const useIndex = separateAnswerMap && target.notebookId === options.notebookId &&
    !!target.rootNodeId && target.rootNodeId !== options.rootNodeId
  return nodes.filter(node => {
    const parent = options.parentOf(node)
    if (parent && usesSubcardAnswers(target, options.colorOf(parent))) return false
    if (!useIndex) return true
    try { return !options.isIndexedAnswer(node) }
    catch { return true } // An unavailable index cannot identify an answer.
  })
}
