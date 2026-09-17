/**
 * 类型化错误：把“错误是什么”（code）与“错误怎么显示”（error-messages 的文案表）
 * 分离。码化错误经 describeError（HUD）/presentError（桥接信封）呈现用户文案，
 * 错误分类不再依赖文案关键字；未码化的历史错误继续走关键字兼容层。
 *
 * 新增 code 时必须在 error-messages.ts 的 ERROR_TEXTS 登记文案（类型强制）。
 */
export const ERROR_CODES = [
  "indexNotReady",
  "bindingNotebookMissing",
  "answerNoteMissing",
  "bindingMissing",
  "notebookNotOpen",
  "questionNotSelected",
  "sourceNoteUnavailable",
  "answerTargetInvalid",
  "answerCardCreationFailed",
  "mistakeRecordMissing",
  "mistakeTagWriteFailed",
  "mistakeTagRemoved",
  "updatePackageIncomplete",
  "debugModeRequired",
  "network",
  "timeout",
  "aiDisabled",
  "aiTaskCancelled",
  "aiCredentialMissing",
  "aiProviderMissing",
  "handwritingUnavailable",
  "ocrRequired",
  "questionTextMissing",
  "studySetMissing",
  "subjectMissing",
  "preparationJobMissing"
] as const

export type ErrorCode = typeof ERROR_CODES[number]

export type ErrorParams = Record<string, string | number>

export class CardLinkError extends Error {
  readonly code: ErrorCode
  readonly params: ErrorParams | undefined
  constructor(code: ErrorCode, params?: ErrorParams) {
    super(code)
    this.name = "CardLinkError"
    this.code = code
    this.params = params
  }
}

export function errorCode(error: unknown): ErrorCode | undefined {
  if (error instanceof CardLinkError) return error.code
  // 原生桥接边界会重建错误对象，instanceof 不再成立时按 duck-type 识别
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : undefined
}

export function errorParams(error: unknown): ErrorParams | undefined {
  return error instanceof CardLinkError
    ? error.params
    : (error as { params?: ErrorParams } | null | undefined)?.params
}
