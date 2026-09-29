import { MistakeLevel, MistakeReviewCurves, REVIEW_CURVES } from "./mistake-domain"

const levels: MistakeLevel[] = [0, 1, 2]

export function normalizeMistakeReviewCurves(value: unknown): MistakeReviewCurves {
  const input = value && typeof value === "object" ? value as Record<number, unknown> : {}
  // v2.3.2 and earlier stored six independent levels. Reusing their first
  // three arrays would silently produce 1/5/10 and 3-day schedules in the
  // three-level model. Treat that shape (and the already-normalized polluted
  // shape from early beta.3 builds) as legacy and start from the Demo curves.
  const hasLegacyLevels = [3, 4, 5].some(level => Object.prototype.hasOwnProperty.call(input, level))
  const oldSixLevelShape = [0, 1, 2].every(level => !Array.isArray(input[level]) || (input[level] as unknown[]).length <= 1)
  const pollutedBetaShape = JSON.stringify([input[0], input[1], input[2]]) === JSON.stringify([[1, 3, 7], [1, 5, 10], [3]])
  const source: Record<number, unknown> = hasLegacyLevels || oldSixLevelShape || pollutedBetaShape ? {} : input
  return Object.fromEntries(levels.map(level => {
    const expectedLength = REVIEW_CURVES[level].length
    const candidate = Array.isArray(source[level]) ? source[level] : []
    const curve = REVIEW_CURVES[level].map((fallback, index) => {
      const days = Number(candidate[index])
      return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : fallback
    })
    return [level, curve.slice(0, expectedLength)]
  })) as MistakeReviewCurves
}
