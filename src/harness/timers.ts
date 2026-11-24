/**
 * 设备侧定时器适配（b17 §11）。
 *
 * 真机证据：JSB 裸 `setTimeout` 按 ~30s 节拍触发（`docs/changes/2026-11-13-harness-p0-package.md`）。
 * 因此工具超时等"必须按毫秒生效"的等待一律走 MN Utils `delay`（秒为单位）。
 * NSTimer 无法取消，cancelled 只用于让竞速方忽略迟到结果。
 */
import { delay } from "marginnote"
import type { ToolTimer } from "../../cardlink-harness/src/application/tool-executor.ts"

export const deviceToolTimer: ToolTimer = (ms) => {
  const seconds = Math.max(1, Math.round(Number(ms) || 0)) / 1000
  const promise = delay(seconds).then(() => undefined)
  return {
    promise,
    // 设备端没有可用的 NSTimer 取消接口；竞速结束即忽略该 promise 的后续结果。
    cancel: () => {},
  }
}
