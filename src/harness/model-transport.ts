/**
 * P4-2：设备模型传输（§5.1.2 JSBHTTPSTransport 形态）。
 * 协议代码与 Node 完全一致（OpenAICompatibleModelClient），仅 HTTP 通道换成
 * P0.3 已验证的插件 ocrHTTP（数组参数、原生超时、错误不泄露密钥）。
 */
import { ocrHTTP } from "../ocr-transport"
import { errorCode, errorParams } from "../errors"
import type { ModelHttpTransport, ModelHttpRequest, ModelHttpResponse } from "../../cardlink-harness/src/adapters/model/transport.ts"
import { OpenAiCompatibleModelClient } from "../../cardlink-harness/src/adapters/model/provider-client.ts"
import { fetchProviderModels, type ModelCatalog } from "../../cardlink-harness/src/adapters/model/model-catalog.ts"
import type { ModelProviderConfig } from "../../cardlink-harness/src/domain/provider.ts"
import type { ModelClient } from "../../cardlink-harness/src/application/ports/model-client.ts"

/**
 * ocrHTTP → 模型传输端口。超时由原生 NSMutableURLRequest 承担；错误信息不含密钥。
 * ocrHTTP 把所有非 2xx 都包成 CardLinkError("network", {detail})——服务端的真实错误
 * （如"Model Not Exist"/鉴权失败）必须还原给协议适配器，否则用户只看到 network。
 */
export const deviceModelTransport: ModelHttpTransport = async (request: ModelHttpRequest): Promise<ModelHttpResponse> => {
  try {
    return await ocrHTTP(request.method, request.url, {
      headers: request.headers,
      // v2.3：模型目录是 GET，没有 body；只有 POST 才解析 JSON。
      json: request.method === "GET" || !request.body ? undefined : (JSON.parse(request.body) as unknown),
      timeoutMs: request.timeoutMs,
      rejectRedirects: true,
      signal: request.signal,
    })
  } catch (error) {
    if (request.signal?.aborted) throw new Error("model_cancelled")
    const code = errorCode(error)
    const params = errorParams(error) as { detail?: unknown; status?: unknown } | undefined
    const status = typeof params?.status === "number" && params.status > 0 ? params.status : undefined
    const detail = typeof params?.detail === "string" && params.detail.trim() ? params.detail.trim() : ""
    if (code === "timeout") {
      throw new Error(detail ? `model_timeout: ${detail}` : `model_timeout: 超过 ${request.timeoutMs}ms`)
    }
    if (code === "network" && status) {
      if (status >= 300 && status < 400) {
        return { status, json: { error: { message: "模型服务的 HTTP 重定向已拒绝" } } }
      }
      // 非 2xx：还原为标准响应，让协议适配器格式化（如 provider_error(400): Model Not Exist）。
      return { status, json: { error: { message: detail || `HTTP ${status}` } } }
    }
    if (code === "network") {
      throw new Error(detail ? `模型连接失败: ${detail}` : "模型连接失败（网络不可达或被代理/VPN 拦截）")
    }
    throw error
  }
}

/** Provider 路由的协议客户端工厂：所有 provider 走设备传输的 OpenAI 兼容适配器。 */
export function createDeviceProtocolClient(config: ModelProviderConfig, apiKey: string): ModelClient {
  return new OpenAiCompatibleModelClient({
    baseUrl: config.baseUrl,
    apiKey,
    provider: config.id,
    transport: deviceModelTransport,
  })
}

/**
 * v2.3 §5.1.6：模型目录抓取（设备侧）。URL 只由已保存的 provider 配置决定，
 * 复用 ocrHTTP 通道；密钥只进 Authorization 头，不回传 UI/日志/审计。
 */
export function createDeviceModelCatalog(config: ModelProviderConfig, apiKey: string): Promise<ModelCatalog> {
  return fetchProviderModels(
    { baseUrl: config.baseUrl, apiKey, provider: config.id },
    { transport: deviceModelTransport },
  )
}
