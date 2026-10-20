import { errorCode } from "./errors"

export type AnswerIndexRecoveryResult = "refreshed" | "rebound" | "cancelled"

/** 与错误文案层保持一致：已有码的其他错误不落入旧版“索引”关键字分支。 */
export function isAnswerIndexError(error: unknown): boolean {
  const code = errorCode(error)
  if (code) return code === "indexNotReady"
  const message = (error as { message?: unknown } | null | undefined)?.message
  return /索引/.test(typeof message === "string" ? message : String(error ?? ""))
}

export interface AnswerIndexRecoveryInfo {
  bindingName: string
  updatedAt?: string
}

export interface AnswerIndexRecoveryActions {
  choose(options: { title: string; message: string; buttons: string[]; canCancel: boolean }): Promise<{ buttonIndex: number }>
  refresh(): Promise<unknown>
  rebind(): Promise<unknown>
}

export async function promptAnswerIndexRecovery(
  info: AnswerIndexRecoveryInfo,
  actions: AnswerIndexRecoveryActions
): Promise<AnswerIndexRecoveryResult> {
  const date = info.updatedAt ? new Date(info.updatedAt) : undefined
  const updatedText = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false }) : "暂无刷新记录"
  const result = await actions.choose({
    title: "答案索引需要处理",
    message: `答案索引尚未建立或暂时无法读取。\n当前绑定的答案脑图：${info.bindingName}\n上次刷新时间：${updatedText}`,
    // popup 的 canCancel 自动提供原生“取消”按钮，不再重复添加。
    buttons: ["刷新索引", "换绑"],
    canCancel: true
  })
  if (result.buttonIndex === 0) {
    await actions.refresh()
    return "refreshed"
  }
  if (result.buttonIndex === 1) {
    await actions.rebind()
    return "rebound"
  }
  return "cancelled"
}
