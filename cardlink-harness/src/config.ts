import { isEffort, type Effort } from "./domain/model-setting.ts";

export type HarnessConfig = {
  bind: string;
  port: number;
  httpToken: string;
  corsOrigin?: string;
  model: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    name: string;
    reviewerName: string;
    effortAssistant: Effort;
    effortReviewer: Effort;
    timeoutMs: number;
    maxOutputTokens: number;
    /** P4-2：设备 Provider 路由标识与密钥引用（§5.1.2）；缺省未设时直连形态。 */
    providerId?: string;
    credentialRef?: string;
  };
  storage: { database: string };
  limits: {
    /** 未选档（legacy）调用的默认上限；显式档位见 hardLimits（§11.3）。 */
    maxIterations: number;
    maxToolCallsPerTurn: number;
    /** v2.16 §11.3：所有预算档位的全局硬上限（min 生效）；缺省按规范默认 12/24/1200000。 */
    hardLimits?: {
      maxIterations: number;
      maxToolCalls: number;
      maxRunDurationMs: number;
    };
    toolTimeoutMs: number;
    /** v2.4 §11.1：上下文字符预算（≈token/4 估算）；0 = 禁用构建时压缩。 */
    contextBudgetChars: number;
  };
};

export function loadDotEnv(content: string, env: Record<string, string | undefined>): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

function str(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function int(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const v = str(env, key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * §14 配置规范：缺省值对齐规范；serve 启动时模型未配置必须失败并给出说明。
 */
export function loadConfig(env: Record<string, string | undefined>, requireModel = true): HarnessConfig {
  const bind = str(env, "H1_BIND") ?? "127.0.0.1";
  if (bind !== "127.0.0.1" && bind !== "localhost" && bind !== "::1") {
    throw new Error(`H1_BIND 只允许回环地址（127.0.0.1/localhost/::1），收到 ${bind}`);
  }
  const port = int(env, "H1_PORT", 7310);
  const httpToken = str(env, "H1_HTTP_TOKEN");
  const model: HarnessConfig["model"] = {
    provider: str(env, "H1_MODEL_PROVIDER") ?? "openai-compatible",
    baseUrl: str(env, "H1_MODEL_BASE_URL") ?? "",
    apiKey: str(env, "H1_MODEL_API_KEY") ?? "",
    name: str(env, "H1_MODEL_NAME") ?? "",
    reviewerName: str(env, "H1_REVIEWER_MODEL_NAME") ?? str(env, "H1_MODEL_NAME") ?? "",
    effortAssistant: (str(env, "H1_ASSISTANT_EFFORT") ?? "medium") as Effort,
    effortReviewer: (str(env, "H1_REVIEWER_EFFORT") ?? "low") as Effort,
    timeoutMs: int(env, "H1_MODEL_TIMEOUT_MS", 30000),
    // v2.5 §5.2：基础输出上限与角色配置统一为 16,384（实际值受模型能力与窗口预算约束）。
    maxOutputTokens: int(env, "H1_MAX_OUTPUT_TOKENS", 16384),
    providerId: str(env, "H1_MODEL_PROVIDER_ID"),
    credentialRef: str(env, "H1_MODEL_CREDENTIAL_REF"),
  };
  if (!isEffort(model.effortAssistant)) throw new Error(`H1_ASSISTANT_EFFORT 非法: ${model.effortAssistant}`);
  if (!isEffort(model.effortReviewer)) throw new Error(`H1_REVIEWER_EFFORT 非法: ${model.effortReviewer}`);

  if (requireModel) {
    const missing = [
      !model.baseUrl && "H1_MODEL_BASE_URL",
      !model.apiKey && "H1_MODEL_API_KEY",
      !model.name && "H1_MODEL_NAME",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`模型未配置，服务拒绝启动（§14）：缺少 ${missing.join("、")}。请配置 .env 或环境变量。`);
    }
  }
  if (requireModel && !httpToken) {
    throw new Error("H1_HTTP_TOKEN 未配置：除健康检查外所有端点要求会话令牌（§3/§11）。");
  }

  return {
    bind,
    port,
    httpToken: httpToken ?? "",
    corsOrigin: str(env, "H1_CORS_ORIGIN"),
    model,
    storage: { database: str(env, "H1_DB_PATH") ?? "./data/agent_h1.sqlite" },
    limits: {
      maxIterations: int(env, "H1_MAX_ITERATIONS", 4),
      maxToolCallsPerTurn: int(env, "H1_MAX_TOOL_CALLS_PER_TURN", 8),
      hardLimits: {
        maxIterations: int(env, "H1_HARD_MAX_ITERATIONS", 12),
        maxToolCalls: int(env, "H1_HARD_MAX_TOOL_CALLS", 24),
        maxRunDurationMs: int(env, "H1_HARD_MAX_RUN_DURATION_MS", 1_200_000),
      },
      toolTimeoutMs: int(env, "H1_TOOL_TIMEOUT_MS", 3000),
      contextBudgetChars: int(env, "H1_CONTEXT_BUDGET_CHARS", 60000),
    },
  };
}
