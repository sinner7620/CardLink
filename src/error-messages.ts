/**
 * 用户可读的错误文案映射：HUD 不直接展示原始异常串（可含内部路径/英文堆栈），
 * 完整异常仍通过 MN.error / 运行日志保留供诊断。
 *
 * 主通道是错误码查表（错误身份与文案分离，抛错方只声明 code + params）；
 * 正则映射仅作为未码化历史错误的兼容层，码化全量覆盖后移除。
 */
import { ErrorCode, ErrorParams, errorParams, errorCode } from "./errors"

type ErrorMessageKey = `error.${ErrorCode}`
const ERROR_TEXTS: Record<ErrorMessageKey, string | ((params: ErrorParams) => string)> = {
  "error.indexNotReady": "答案索引尚未建立，请在插件菜单点击“刷新答案索引”",
  "error.bindingNotebookMissing": "找不到已绑定的答案脑图，可能已被删除",
  "error.answerNoteMissing": "答案卡片已不存在，请刷新答案索引",
  "error.bindingMissing": "请先绑定答案脑图",
  "error.notebookNotOpen": "请先打开题目脑图",
  "error.questionNotSelected": "请先选中当前题目脑图中的任一卡片",
  "error.sourceNoteUnavailable": "原题卡片不存在或尚未同步",
  "error.answerTargetInvalid": "绑定的答案脑图根节点不存在，请重新绑定答案脑图",
  "error.answerCardCreationFailed": params => params.detail
    ? `未能在绑定答案脑图创建卡片：${params.detail}`
    : "未能在绑定答案脑图创建卡片，请重新绑定后重试",
  "error.mistakeRecordMissing": "错题记录不存在",
  "error.mistakeTagWriteFailed": params => `${params.action}失败：未能写入原题标签，请打开原题所在学习集后重试`,
  "error.mistakeTagRemoved": "该错题的标签已在 MarginNote 内被移除，记录已同步取消",
  "error.updatePackageIncomplete": params => `更新包下载不完整（${params.sizeKb}KB，可能是限流或错误页），请稍后重试或到 Gitee Releases 手动下载`,
  "error.debugModeRequired": "请先开启调试模式",
  "error.network": params => params.detail ? `网络请求失败：${params.detail}` : "网络请求失败，请稍后重试",
  "error.timeout": params => params.detail ? `网络请求超时：${params.detail}` : "网络请求超时，请稍后重试",
  "error.aiDisabled": "AI 错题分析未开启，请先在设置中开启",
  "error.aiTaskCancelled": params => String(params.detail || "任务已取消"),
  "error.aiCredentialMissing": params => `${params.provider} 尚未设置 ${params.credential}`,
  "error.aiProviderMissing": params => params.provider ? `AI 服务不存在：${params.provider}` : "默认 AI 服务未配置",
  "error.handwritingUnavailable": "手写内容无法读取，请检查原卡片或关闭手写内容发送",
  "error.ocrRequired": "题目含图片但未开启题目识别（OCR）",
  "error.questionTextMissing": "没有可读取的题目文字",
  "error.studySetMissing": "学习集不存在",
  "error.subjectMissing": "科目不存在",
  "error.preparationJobMissing": "题目准备任务不存在"
}

/** 当前仅有中文表；未来增加语言表时，调用方仍只依赖稳定的 error.<code> 键。 */
export function t(key: ErrorMessageKey, params: ErrorParams = {}): string | undefined {
  const entry = ERROR_TEXTS[key]
  if (entry === undefined) return undefined
  return typeof entry === "function" ? entry(params) : entry
}

/** 未码化历史错误的关键字兼容层（码化全量覆盖后可整体移除）。 */
const KEYWORD_ERROR_TEXTS: Array<[RegExp, string]> = [
  [/索引/, "答案索引尚未建立或已过期，请先在设置中刷新答案索引"],
  [/不存在|已被删除|not found/i, "目标内容不存在或已被删除，请刷新后重试"],
  [/noteId|卡片/, "所选卡片无效，请重新选择"],
  [/超时|timeout/i, "操作超时，请稍后重试"],
  [/网络|network|fetch|http/i, "网络连接失败，请检查网络后重试"],
  [/JSON|解析|parse/i, "数据解析失败，请刷新索引后重试"],
  [/权限|permission/i, "没有执行该操作的权限"]
]

export function describeError(error: unknown, fallback = "操作失败，请重试；若持续出现请开启调试模式导出日志"): string {
  const code = errorCode(error)
  const byCode = code ? t(`error.${code}`, errorParams(error)) : undefined
  if (byCode !== undefined) return byCode
  // Error 实例取 message：String(error) 会带 "Error: " 前缀，锚定正则全部失配
  const objectMessage = (error as { message?: unknown } | null | undefined)?.message
  const raw = error instanceof Error
    ? error.message
    : typeof objectMessage === "string" ? objectMessage : String(error ?? "")
  for (const [pattern, text] of KEYWORD_ERROR_TEXTS) {
    if (pattern.test(raw)) return text
  }
  return fallback
}

/**
 * 桥接边界统一呈现：码化错误换成表内用户文案并保留 code 供信封透出；
 * 未码化错误继续走一个版本的关键字兼容层；Web 端始终只消费 message。
 */
export interface PresentedError { code?: ErrorCode; message: string }

export function presentError(error: unknown): PresentedError {
  const code = errorCode(error)
  return code
    ? { code, message: describeError(error) }
    : { message: describeError(error) }
}
