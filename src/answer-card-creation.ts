export interface AnswerBranchCandidate<T> {
  value: T
  id: string
  title: string
  /** Immediate parent first, matching NodeNote.ancestorNodes. */
  pathTitles: string[]
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

function sameTitles(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((title, index) => normalized(title) === normalized(right[index] || ""))
}

/**
 * Reuse only an unambiguous, structurally identical answer branch.
 * The outermost source/answer roots are intentionally ignored because paired
 * mind maps normally have different root titles. When no such branch exists,
 * callers attach the generated card to the bound answer root instead of
 * manufacturing a duplicate branch tree.
 */
export function selectReusableAnswerParent<T>(
  questionPathTitles: string[],
  candidates: AnswerBranchCandidate<T>[],
  boundRootId?: string
): T | undefined {
  const sourceBranch = questionPathTitles.slice(0, -1).filter(Boolean)
  if (!sourceBranch.length) {
    return candidates.find(candidate => candidate.id === boundRootId)?.value
  }
  const matches = candidates.filter(candidate => {
    if (normalized(candidate.title) !== normalized(sourceBranch[0])) return false
    const answerHigherBranch = candidate.pathTitles.slice(0, -1).filter(Boolean)
    return sameTitles(answerHigherBranch, sourceBranch.slice(1))
  })
  return matches.length === 1 ? matches[0].value : undefined
}
