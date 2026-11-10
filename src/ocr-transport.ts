import { NSJSONReadingOptions, isNSNull } from "marginnote"
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

export function ocrHTTP(method: string, url: string, options: { headers?: Record<string, string>; json?: any; data?: any; timeoutMs?: number } = {}): Promise<{ status: number; json?: any; data?: any }> {
  return new Promise((resolve, reject) => { try {
    const request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(url)); request.setHTTPMethod(method); request.setTimeoutInterval((options.timeoutMs || 60000) / 1000)
    for (const [key, value] of Object.entries(options.headers || {})) request.setValueForHTTPHeaderField(value, key)
    if (options.json !== undefined) { request.setValueForHTTPHeaderField("application/json", "Content-Type"); request.setHTTPBody(NSData.dataWithStringEncoding(JSON.stringify(options.json), 4)) } else if (options.data) request.setHTTPBody(options.data)
    NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(request, NSOperationQueue.mainQueue(), (response: any, data: any, error: any) => {
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
    })
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
