/**
 * 模型 HTTP 传输端口（P4-2，§5.1.2 分层：协议适配器 ↔ 传输层解耦）。
 * Node（开发/回归）用 fetchTransport；设备（JSB）由插件胶水提供
 * ocrHTTP 实现（P0.3 已验证的 HTTPS 通道）——协议代码两环境完全一致。
 *
 * v2.3：新增 `GET`（模型目录 `GET {baseUrl}/models`）与可选 body。
 */
export type ModelHttpRequest = {
  method: "POST" | "GET";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ModelHttpResponse = { status: number; json?: unknown };

export type ModelHttpTransport = (request: ModelHttpRequest) => Promise<ModelHttpResponse>;

/** Node/开发默认传输：fetch + AbortController 超时。 */
export const fetchTransport: ModelHttpTransport = async (request) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (request.signal?.aborted) throw new Error("model_cancelled");
  request.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? undefined : request.body,
      signal: controller.signal,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, json: { error: { message: "模型服务的 HTTP 重定向已拒绝" } } };
    }
    const json = (await res.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return null;
    })) as unknown;
    return { status: res.status, json };
  } catch (error) {
    if (request.signal?.aborted) throw new Error("model_cancelled");
    if (controller.signal.aborted) throw new Error(`model_timeout: 超过 ${request.timeoutMs}ms`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
};
