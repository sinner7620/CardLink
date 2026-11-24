import { fetchTransport, type ModelHttpTransport } from "./transport.ts";

/**
 * v2.3 §5.1.6：在线模型目录。
 *
 * 只做一件事：用已保存的 provider 配置 + 密钥，向 `GET {baseUrl}/models` 取模型标识列表。
 * - 不落库、不写审计、不回传密钥；
 * - 只允许 HTTPS，不跟随跨域重定向（传输层只发一次请求，跳转由服务端返回 3xx 状态码拒绝）；
 * - 超时与条数有上限，失败一律抛错（fail-closed），由桥转换为可操作错误码。
 */

export type ModelCatalogEntry = { id: string; ownedBy?: string };

export type ModelCatalog = {
  models: ModelCatalogEntry[];
  fetchedAt: string;
  source: "network" | "manual";
};

export type FetchProviderModelsInput = {
  baseUrl: string;
  apiKey: string;
  provider?: string;
};

export type FetchProviderModelsOptions = {
  transport?: ModelHttpTransport;
  timeoutMs?: number;
  now?: Date;
  maxModels?: number;
};

export const MODEL_CATALOG_TIMEOUT_MS = 20_000;
export const MODEL_CATALOG_MAX_ENTRIES = 300;

/** 收集响应里的模型条目：兼容 `{data:[{id}]}`、`{models:[{id}]}` 与裸数组。 */
function collectEntries(json: unknown): Array<{ id: string; ownedBy?: string }> | null {
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown } | null)?.data)
      ? ((json as { data: unknown[] }).data)
      : Array.isArray((json as { models?: unknown } | null)?.models)
        ? ((json as { models: unknown[] }).models)
        : null;
  if (!list) return null;

  const entries: Array<{ id: string; ownedBy?: string }> = [];
  for (const item of list) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id) entries.push({ id });
      continue;
    }
    const record = item as { id?: unknown; name?: unknown; owned_by?: unknown; ownedBy?: unknown } | null;
    const raw = typeof record?.id === "string" ? record.id : typeof record?.name === "string" ? record.name : "";
    const id = raw.trim();
    if (!id) continue;
    const ownedBy = typeof record?.owned_by === "string" ? record.owned_by : typeof record?.ownedBy === "string" ? record.ownedBy : undefined;
    entries.push(ownedBy ? { id, ownedBy } : { id });
  }
  return entries;
}

export async function fetchProviderModels(
  input: FetchProviderModelsInput,
  options: FetchProviderModelsOptions = {},
): Promise<ModelCatalog> {
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("provider_base_url_not_https: 模型目录只支持 https 地址");
  const apiKey = String(input.apiKey ?? "");
  if (!apiKey.trim()) throw new Error("credential_missing: 尚未保存 API Key");

  const transport = options.transport ?? fetchTransport;
  const timeoutMs = options.timeoutMs ?? MODEL_CATALOG_TIMEOUT_MS;
  const maxModels = options.maxModels ?? MODEL_CATALOG_MAX_ENTRIES;
  const url = `${baseUrl}/models`;

  const response = await transport({
    method: "GET",
    url,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    timeoutMs,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`credential_invalid: 密钥被服务商拒绝（HTTP ${response.status}）`);
  }
  if (response.status === 404) {
    throw new Error("models_unsupported: 该服务商未提供 /models 接口，请手动填写模型名");
  }
  if (response.status === 429) {
    throw new Error("rate_limited: 请求过于频繁（HTTP 429），请稍后重试");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("model_catalog_failed: 模型服务的 HTTP 重定向已拒绝");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`model_catalog_failed: 服务商返回 HTTP ${response.status}`);
  }

  const entries = collectEntries(response.json);
  if (!entries) throw new Error("models_unsupported: 模型目录响应格式无法识别，请手动填写模型名");

  const seen = new Set<string>();
  const models: ModelCatalogEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push(entry);
    if (models.length >= maxModels) break;
  }
  if (!models.length) throw new Error("models_unsupported: 模型目录为空，请手动填写模型名");

  return {
    models,
    fetchedAt: (options.now ?? new Date()).toISOString(),
    source: "network",
  };
}
