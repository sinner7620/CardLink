import { previewSend } from "./previewBridge"

const BRIDGE_URL = "mnaddon://bridge?payload="
// A pending request that gets no native reply must fail eventually, otherwise
// the panel busy state spins forever and __MNBridgePending leaks.
const REQUEST_TIMEOUT_MS = 30000
// UIWebView silently drops oversized custom-scheme navigations. Parts are
// sized so even worst-case percent-encoded CJK stays far below the practical
// URL length limits; the native side reassembles before dispatching.
const REQUEST_PART_CHARS = 8000
const MAX_SINGLE_REQUEST_ENCODED = 24000

const isBrowserPreview = window.__MN_FULL_UI_PREVIEW__ === true ||
  ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname)

function pendingMap() {
  window.__MNBridgePending = window.__MNBridgePending || {}
  return window.__MNBridgePending
}

function postFrame(src) {
  const frame = document.createElement("iframe")
  frame.style.display = "none"
  frame.src = src
  document.body.appendChild(frame)
  setTimeout(() => frame.remove(), 700)
}

function receive() {
  if (window.__MN_WEB_BRIDGE_RECEIVE_FN__) return
  window.__MN_WEB_BRIDGE_RECEIVE_FN__ = raw => {
    let response
    try {
      response = JSON.parse(raw)
    } catch (error) {
      logNative("bridge.client.parseError", String(raw || "").slice(0, 200))
      return
    }
    const pending = pendingMap()[response.requestId]
    if (!pending) return
    delete pendingMap()[response.requestId]
    if (response.error) return pending.reject(response.error)
    if (response.chunked) {
      // Oversized payloads arrive in chunks; pull each piece with its own
      // request, then assemble the original JSON response.
      pullChunkedResponse(response.requestId, Number(response.chunked.total) || 0)
        .then(pending.resolve, pending.reject)
      return
    }
    pending.resolve(response.payload)
  }
}

async function pullChunkedResponse(requestId, total) {
  if (!total || total < 1 || total > 4096) throw new Error("响应分块信息无效")
  const parts = []
  for (let index = 0; index < total; index++) {
    const part = await send("__pullResponseChunk", { requestId, index })
    if (!part || typeof part.data !== "string") throw new Error("响应分块读取失败")
    parts.push(part.data)
    if (part.done) break
  }
  if (parts.length !== total) throw new Error("响应分块接收不完整")
  const assembled = JSON.parse(parts.join(""))
  if (assembled.error) throw assembled.error
  return assembled.payload
}

function dispatchRequest(requestId, command, payload) {
  const body = JSON.stringify({ command, payload })
  if (encodeURIComponent(body).length <= MAX_SINGLE_REQUEST_ENCODED) {
    postFrame(BRIDGE_URL + encodeURIComponent(JSON.stringify({ command, requestId, payload })))
    return
  }
  const total = Math.ceil(body.length / REQUEST_PART_CHARS)
  for (let index = 0; index < total; index++) {
    postFrame(BRIDGE_URL + encodeURIComponent(JSON.stringify({
      __bridgeRequestPart: {
        requestId,
        index,
        total,
        data: body.slice(index * REQUEST_PART_CHARS, (index + 1) * REQUEST_PART_CHARS)
      }
    })))
  }
}

// 前端诊断日志通道：经桥写入原生侧运行日志环形缓冲（失败静默，绝不影响主流程）
function logNative(event, detail) {
  if (isBrowserPreview || event === "bridge.client.log") return
  try {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    // 诊断请求丢失不能永久占住 busy 状态，也不再为诊断超时递归写诊断。
    const timer = setTimeout(() => { delete pendingMap()[requestId] }, REQUEST_TIMEOUT_MS)
    const finish = () => { clearTimeout(timer); delete pendingMap()[requestId] }
    pendingMap()[requestId] = { resolve: finish, reject: finish }
    dispatchRequest(requestId, "runtimeLog", { event, detail: String(detail || "").slice(0, 400) })
  } catch (_) { /* 日志失败忽略 */ }
}

function send(command, payload = null) {
  if (isBrowserPreview) return previewSend(command, payload)
  receive()
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete pendingMap()[requestId]
      logNative("bridge.client.timeout", `cmd=${command} waitMs=${REQUEST_TIMEOUT_MS}`)
      reject(new Error("面板请求超时，请重试或缩小操作范围"))
    }, REQUEST_TIMEOUT_MS)
    pendingMap()[requestId] = {
      resolve: value => {
        clearTimeout(timer)
        delete pendingMap()[requestId]
        resolve(value)
      },
      reject: error => {
        clearTimeout(timer)
        delete pendingMap()[requestId]
        reject(error)
      }
    }
    dispatchRequest(requestId, command, payload)
  })
}

export function isBridgeBusy() {
  return Object.keys(pendingMap()).length > 0
}

export default { send }

if (!isBrowserPreview && typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("error", event => {
    logNative("window.error", `${event.message || "unknown"} @${String(event.filename || "").split("/").pop()}:${event.lineno || "?"}`)
  })
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason
    logNative("unhandledRejection", String((reason && reason.message) || reason).slice(0, 300))
  })
}
