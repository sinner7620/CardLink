/**
 * 服务商预置表（§5.1.6 v2.3）。
 *
 * 只是"填表用的静态数据"：Base URL 与默认模型用于把配置步骤从 4 步降到 1 步；
 * 不参与鉴权判断，也不代表这些地址/模型已在真机验证可用。用户可以切到「自定义」
 * 或展开高级自己填。
 */

export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    note: "OpenAI 兼容 · 国内直连",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    note: "需可访问 api.openai.com",
  },
  {
    id: "dashscope",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    note: "阿里云百炼兼容模式",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    note: "OpenAI 兼容",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    note: "Kimi 开放平台",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    note: "聚合多家模型",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    note: "聚合网关，需外网",
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    defaultModel: "",
    note: "自填 https 地址（兼容网关、自建代理）",
  },
]

export function presetById(id) {
  return PROVIDER_PRESETS.find((item) => item.id === id) || PROVIDER_PRESETS[0]
}

/** 按服务商反查预置：用于"已保存配置"回显时高亮对应 chip。 */
export function presetForBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim().replace(/\/+$/, "")
  if (!normalized) return undefined
  return PROVIDER_PRESETS.find((item) => item.baseUrl && item.baseUrl.replace(/\/+$/, "") === normalized)
}

/**
 * 密钥前缀提示。只做**提示**，不做强制：`sk-` 被多家服务商共用，
 * 猜错只会导致一次失败请求，因此这里只在高置信前缀上给出建议。
 * 返回 `{ presetId?, warning? }`。
 */
export function inspectApiKey(apiKey) {
  const key = String(apiKey ?? "").trim()
  if (!key) return {}
  if (/^sk-ant-/i.test(key)) {
    return { warning: "这看起来是 Anthropic 官方密钥；H1 只支持 OpenAI 兼容协议，需要兼容网关或代理地址。" }
  }
  if (/^sk-or-v1-/i.test(key)) return { presetId: "openrouter" }
  if (/^sk-proj-|^sk-svcacct-|^sk-admin-/i.test(key)) return { presetId: "openai" }
  return {}
}
