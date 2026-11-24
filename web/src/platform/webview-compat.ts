/**
 * WebView 运行时兼容层(b16):
 * - createContext 裸引用兜底——部分 ESM 包(如 use-stick-to-bottom)在 IIFE 产物中
 *   react 链接异常(裸 createContext ReferenceError);全局提供 React.createContext。
 * - AbortController 兜底——旧 UIWebView JSC 无此 API。
 * 必须最先导入(main.jsx 第一行)。
 */
import * as React from "react"

const g = globalThis as Record<string, unknown>

if (typeof g.createContext !== "function") {
  g.createContext = React.createContext
}
if (typeof g.AbortController !== "function") {
  class AbortSignalStub {
    aborted = false
    onabort: unknown = null
  }
  class AbortControllerStub {
    readonly signal = new AbortSignalStub()
    abort(): void {
      ;(this.signal as { aborted: boolean }).aborted = true
    }
  }
  g.AbortController = AbortControllerStub
  g.AbortSignal = AbortSignalStub
}
