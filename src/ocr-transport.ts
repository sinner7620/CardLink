import { NSJSONReadingOptions, isNSNull, type NSURLRequest } from "marginnote"
import { decodeBase64Ascii, decodeBase64Utf8 } from "./base64"
import { CardLinkError } from "./errors"

function text(value: string, max: number) { return value.replace(/\s+/g, " ").trim().slice(0, max) }

export function isNativeNull(value: any): boolean { return value == null || isNSNull(value) }

/** Foundation JSON 会把 JSON null 桥接为 NSNull；递归转换后再进入业务逻辑与 Web 桥。 */
export function normalizeNativeJSON(value: any): any {
  if (isNativeNull(value)) return null
  if (Array.isArray(value)) return value.map(normalizeNativeJSON)
  if (typeof value !== "object") return value
  const output: Record<string, any> = {}
  for (const key of Object.keys(value)) output[key] = normalizeNativeJSON(value[key])
  return output
}

function nativeErrorMessage(error: any): string {
  if (isNativeNull(error)) return ""
  for (const candidate of [error?.localizedDescription, error?.message]) {
    if (!isNativeNull(candidate) && typeof candidate === "string" && candidate.trim()) return text(candidate, 240)
  }
  const fallback = String(error)
  return fallback === "[object NSNull]" ? "网络请求失败" : text(fallback, 240) || "网络请求失败"
}

function responseError(json: any, status: number): string {
  for (const candidate of [json?.error?.message, json?.message, json?.msg, json?.error?.type, json?.error?.code]) {
    if (typeof candidate === "string" && candidate.trim()) return text(candidate, 240)
  }
  return `HTTP ${status || "无响应"}`
}

function networkError(detail: string): CardLinkError {
  return new CardLinkError(/超时|timed?\s*out|-1001/i.test(detail) ? "timeout" : "network", { detail })
}

type NativeCompletion = (response: any, data: any, error: any) => void
type GuardedRequest = {
  response?: any
  chunks: string[]
  finish: NativeCompletion
  rejectRedirect: (response: any, stop: () => void) => void
}
const guardedRequests = new WeakMap<object, GuardedRequest>()
let GuardedConnectionDelegate: any

function cancelConnection(connection: { cancel(): void } | undefined) {
  try { connection?.cancel() } catch { /* JS 收尾和拒绝重定向仍继续。 */ }
}

function sendWithoutRedirect(request: NSURLRequest, completion: NativeCompletion, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("model_cancelled")
  if (!GuardedConnectionDelegate) {
    GuardedConnectionDelegate = JSB.defineClass("CardLinkModelConnectionDelegate : NSObject <NSURLConnectionDataDelegate>", {
      connectionWillSendRequestRedirectResponse(connection: any, next: any, redirect: any) {
        if (isNativeNull(redirect)) return next
        guardedRequests.get(self)?.rejectRedirect(redirect, () => cancelConnection(connection))
        return null
      },
      connectionDidReceiveResponse(_connection: any, response: any) {
        const state = guardedRequests.get(self)
        if (state) {
          state.response = response
          state.chunks.length = 0
        }
      },
      connectionDidReceiveData(connection: any, data: any) {
        const state = guardedRequests.get(self)
        if (!state) return
        try {
          const encoded = data.base64Encoding()
          if (!isNativeNull(encoded) && encoded) state.chunks.push(decodeBase64Ascii(String(encoded)))
        } catch (error) {
          cancelConnection(connection)
          state.finish(null, null, error)
        }
      },
      connectionDidFinishLoading() {
        const state = guardedRequests.get(self)
        if (!state) return
        let data
        try {
          if (state.chunks.length) data = NSData.dataWithStringEncoding(state.chunks.join(""), 5)
        } catch (error) {
          state.finish(null, null, error)
          return
        }
        state.finish(state.response, data, null)
      },
      connectionDidFailWithError(_connection: any, error: any) {
        guardedRequests.get(self)?.finish(null, null, error)
      },
    }, {})
  }
  const delegate = GuardedConnectionDelegate.new()
  let connection: { cancel(): void } | undefined
  const finish: NativeCompletion = (response, data, error) => {
    if (!guardedRequests.delete(delegate)) return
    signal?.removeEventListener("abort", abort)
    completion(response, data, error)
  }
  const abort = () => {
    cancelConnection(connection)
    finish(null, null, new Error("model_cancelled"))
  }
  guardedRequests.set(delegate, {
    chunks: [],
    finish,
    rejectRedirect: (response, stop) => {
      // 先回报 3xx，再取消底层加载，避免以通用网络错误覆盖重定向。
      try { finish(response, null, null) } finally { stop() }
    },
  })
  signal?.addEventListener("abort", abort)
  try {
    // 经典 JSB 导出完整的 selector 名，marginnote 的类型声明漏写了 Delegate。
    const nativeConnection = NSURLConnection as typeof NSURLConnection & {
      connectionWithRequestDelegate(request: NSURLRequest, delegate: object): { cancel(): void }
    }
    connection = nativeConnection.connectionWithRequestDelegate(request, delegate)
    if (isNativeNull(connection)) throw new Error("当前宿主无法创建模型 HTTPS 连接")
  } catch (error) {
    finish(null, null, error)
  }
}

type OcrHttpOptions = {
  headers?: Record<string, string>
  json?: any
  data?: any
  timeoutMs?: number
  rejectRedirects?: boolean
  signal?: AbortSignal
}

export function ocrHTTP(method: string, url: string, options: OcrHttpOptions = {}): Promise<{ status: number; json?: any; data?: any }> {
  return new Promise((resolve, reject) => { try {
    const request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(url)); request.setHTTPMethod(method); request.setTimeoutInterval((options.timeoutMs || 60000) / 1000)
    for (const [key, value] of Object.entries(options.headers || {})) request.setValueForHTTPHeaderField(value, key)
    if (options.json !== undefined) { request.setValueForHTTPHeaderField("application/json", "Content-Type"); request.setHTTPBody(NSData.dataWithStringEncoding(JSON.stringify(options.json), 4)) } else if (options.data) request.setHTTPBody(options.data)
    const completion: NativeCompletion = (response, data, error) => {
      if (!isNativeNull(error)) return reject(networkError(nativeErrorMessage(error)))
      if (isNativeNull(response)) return reject(new CardLinkError("network", { detail: "未返回 HTTP 响应" }))
      const raw = typeof response.statusCode === "function" ? response.statusCode() : response.statusCode
      const numericStatus = isNativeNull(raw) ? 0 : Number(raw), status = Number.isFinite(numericStatus) ? numericStatus : 0
      const responseData = isNativeNull(data) ? undefined : data
      let json: any
      try { if (responseData) json = normalizeNativeJSON(NSJSONSerialization.JSONObjectWithDataOptions(responseData, NSJSONReadingOptions.FragmentsAllowed)) } catch {}
      if (status < 200 || status >= 300) {
        const rawCode=String(json?.error?.code ?? ""),serviceCode=/^\d{1,8}$/.test(rawCode)?rawCode:""
        return reject(new CardLinkError("network", { detail: responseError(json, status), status, serviceCode }))
      }
      resolve({ status, json, data: responseData })
    }
    if (options.rejectRedirects) sendWithoutRedirect(request, completion, options.signal)
    else NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(request, NSOperationQueue.mainQueue(), completion)
  } catch (error) { reject(error) } })
}
/**
 * 使用插件已经过真机路径验证的 Latin-1 字符串桥创建二进制 NSData。
 * marginnote typings 中声明的 NSData 字节指针静态构造器在 MN4 真机并未暴露，
 * 而 JS Uint8Array 也不能作为 Objective-C 指针直接传入。
 */
export function ocrImageData(source: string): any {
  const base64 = String(source || "").split(",").pop()?.replace(/\s/g, "") || ""
  if (!base64) throw new Error("MinerU 上传图片为空")
  const data = NSData.dataWithStringEncoding(decodeBase64Ascii(base64), 5)
  if (isNativeNull(data)) throw new Error("当前 MarginNote 无法创建 MinerU 上传图片数据")
  return data
}
/**
 * 禁止通过 NSString 的 alloc 创建实例：MN4 的 JSC 会在 init 前尝试把 NSPlaceholderString
 * 自动桥接成 JS 字符串并触发不可捕获的 Objective-C 异常。NSData 返回已初始化
 * 的 base64 字符串，再在纯 JS 中解码 UTF-8，可安全读取 MinerU 的 full.md。
 */
export function ocrReadUtf8(path: string): string {
  const data = NSData.dataWithContentsOfFile(path)
  if (isNativeNull(data)) return ""
  const encoded = data.base64Encoding?.()
  return isNativeNull(encoded) ? "" : decodeBase64Utf8(String(encoded))
}
