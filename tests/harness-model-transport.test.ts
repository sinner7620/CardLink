import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { installAbortControllerPolyfill } from "../cardlink-harness/src/platform/abort.ts"

mock.module("marginnote", {
  namedExports: { isNSNull: (value: unknown) => value == null, NSJSONReadingOptions: { FragmentsAllowed: 4 } },
})

test("通过经典 JSB 创建模型连接、拒绝重定向、支持取消并合并 UTF-8 响应块", async () => {
  const bridge = globalThis as Record<string, unknown>
  let delegate: Record<string, (...args: unknown[]) => unknown>
  let cancelled = 0
  const connection = { cancel: () => { cancelled++ } }
  const request = { setHTTPMethod() {}, setTimeoutInterval() {}, setValueForHTTPHeaderField() {}, setHTTPBody() {} }
  const globals = {
    JSB: { defineClass: (_declaration: string, methods: typeof delegate) => ({ new: () => Object.create(methods) }) },
    NSURL: { URLWithString: (url: string) => url },
    NSMutableURLRequest: { requestWithURL: () => request },
    NSURLConnection: { connectionWithRequestDelegate: (_request: unknown, listener: typeof delegate) => {
      delegate = listener
      return connection
    } },
    NSData: { dataWithStringEncoding: (bytes: string) => Buffer.from(bytes, "latin1") },
    NSJSONSerialization: { JSONObjectWithDataOptions: (bytes: Buffer) => JSON.parse(bytes.toString("utf8")) },
  }
  const saved = new Map(Object.keys({ ...globals, self: null, AbortController: null, AbortSignal: null })
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(bridge, globals)
  bridge.AbortController = undefined
  installAbortControllerPolyfill()
  const invoke = (method: string, ...args: unknown[]) => {
    bridge.self = delegate
    return delegate[method](...args)
  }
  try {
    const { deviceModelTransport } = await import("../src/harness/model-transport")
    const options = { method: "GET" as const, url: "https://fixture.invalid", headers: {}, timeoutMs: 3000 }
    const redirect = deviceModelTransport(options)
    assert.equal(invoke("connectionWillSendRequestRedirectResponse", connection, request, null), request)
    assert.equal(invoke("connectionWillSendRequestRedirectResponse", connection, request, { statusCode: 307 }), null)
    assert.equal((await redirect).status, 307)
    assert.equal(cancelled, 1)

    const controller = new AbortController()
    const waiting = deviceModelTransport({ ...options, signal: controller.signal })
    controller.abort()
    await assert.rejects(waiting, /model_cancelled/)
    assert.equal(cancelled, 2)

    const answer = deviceModelTransport(options)
    const bytes = Buffer.from('{"content":"回传"}', "utf8")
    invoke("connectionDidReceiveResponse", connection, { statusCode: 200 })
    for (const chunk of [bytes.subarray(0, 13), bytes.subarray(13)]) {
      invoke("connectionDidReceiveData", connection, { base64Encoding: () => chunk.toString("base64") })
    }
    invoke("connectionDidFinishLoading")
    assert.deepEqual((await answer).json, { content: "回传" })
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
