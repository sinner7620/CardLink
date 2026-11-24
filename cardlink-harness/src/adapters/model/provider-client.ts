import type { Context } from "../../domain/context.ts";
import type { ModelClient, ModelClientDetailed, ModelReply } from "../../application/ports/model-client.ts";
import { assertModelSetting, type Effort, type ModelSetting } from "../../domain/model-setting.ts";
import { providerFinishReasonOf } from "../../domain/finish-reason.ts";
import { fetchTransport, type ModelHttpTransport } from "./transport.ts";

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  provider: string;
  /** 显式 effort 映射（§5：不得静默错误传参）。缺省映射低/中→low，高→high，最高→max。 */
  effortMap?: Partial<Record<Effort, "low" | "high" | "max">>;
  /** 是否发送 reasoning_effort 字段（部分兼容网关不支持时可关）。 */
  includeReasoningEffort?: boolean;
  /** 是否发送 response_format json_object（默认关闭，靠指令约束 JSON）。 */
  useResponseFormat?: boolean;
  /** P4-2：注入 HTTP 传输（设备为 ocrHTTP 实现）；缺省 Node fetch。 */
  transport?: ModelHttpTransport;
};

export const DEFAULT_EFFORT_MAP: Required<Pick<OpenAiCompatibleConfig, "effortMap">>["effortMap"] = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  max: "max",
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

const ASSISTANT_SCHEMA_NAME = "assistant_message";

/**
 * OpenAI 兼容协议适配器（P3：接入一个真实模型协议）。
 * 协议级行为由本地 stub 服务器测试覆盖；活体调用经 H1_LIVE_MODEL=1 门控（§16/T--live）。
 * v2.4 §5：实现可选 ModelClientDetailed——读取 choices[0].finish_reason 与 usage。
 */
export class OpenAiCompatibleModelClient implements ModelClient, ModelClientDetailed {
  constructor(private readonly config: OpenAiCompatibleConfig) {
    if (!config.baseUrl) throw new Error("baseUrl 缺失");
    if (!config.apiKey) throw new Error("apiKey 缺失");
  }

  async generate<T>(context: Context<T>, setting: ModelSetting): Promise<T> {
    const reply = await this.generateDetailed(context, setting);
    return reply.value;
  }

  async generateDetailed<T>(context: Context<T>, setting: ModelSetting): Promise<ModelReply<T>> {
    return this.request(context, setting);
  }

  generateWithSignal<T>(context: Context<T>, setting: ModelSetting, signal: AbortSignal): Promise<ModelReply<T>> {
    return this.request(context, setting, signal);
  }

  private async request<T>(context: Context<T>, setting: ModelSetting, signal?: AbortSignal): Promise<ModelReply<T>> {
    assertModelSetting(setting);
    // 显式映射优先：提供 effortMap 时严格使用（未配置档位 → unsupported_effort，
    // §5 不得静默错误传参）；未提供时使用缺省映射。
    const effortMap = this.config.effortMap ?? DEFAULT_EFFORT_MAP;
    const effort = effortMap[setting.effort];
    if (!effort) {
      throw new Error(`unsupported_effort: ${setting.effort} 无法映射到 ${this.config.provider}`);
    }

    const body: Record<string, unknown> = {
      model: setting.model,
      messages: this.toChatMessages(context),
      max_tokens: setting.maxOutputTokens,
    };
    if (this.config.includeReasoningEffort !== false) body.reasoning_effort = effort;
    if (context.tools.length) {
      body.tools = context.tools.map((d) => ({
        type: "function",
        function: { name: d.name, description: d.description, parameters: d.parameters },
      }));
      body.tool_choice = "auto";
    }
    if (this.config.useResponseFormat) body.response_format = { type: "json_object" };

    const transport = this.config.transport ?? fetchTransport;
    let res: { status: number; json?: unknown };
    try {
      res = await transport({
        method: "POST",
        url: `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs: setting.timeoutMs,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("model_timeout")) throw message.startsWith("model_timeout:") ? error : new Error(message);
      throw new Error(`provider_error: ${message}`.slice(0, 300));
    }

    const json = (res.json ?? null) as
      | { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      | { error?: { message?: string } }
      | null;
    if (res.status < 200 || res.status >= 300) {
      const message = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`provider_error(${res.status}): ${message}`.slice(0, 500));
    }
    const choice = (json as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> })
      ?.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error("provider_error: 响应缺少 choices[0].message");
    // v2.4 §11.1：消息级终止原因（length→output_limit 等）；未知值按 completed（不伪造）。
    const finishReason = providerFinishReasonOf(choice?.finish_reason);
    const usageRaw = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    const usage = usageRaw
      ? {
          promptTokens: typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : undefined,
          completionTokens: typeof usageRaw.completion_tokens === "number" ? usageRaw.completion_tokens : undefined,
        }
      : undefined;

    if (context.outputType.name === ASSISTANT_SCHEMA_NAME) {
      const toolCalls = (message.tool_calls ?? []).map((tc) => {
        let args: unknown = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = { _unparsed: tc.function.arguments };
        }
        return { id: tc.id, name: tc.function.name, arguments: args };
      });
      return {
        value: context.outputType.parse({ text: message.content ?? "", toolCalls }),
        finishReason,
        usage,
      };
    }

    const parsed = this.parseJsonContent(message.content ?? "");
    return { value: context.outputType.parse(parsed), finishReason, usage };
  }

  private toChatMessages<T>(context: Context<T>): ChatMessage[] {
    const out: ChatMessage[] = [{ role: "system", content: context.instruction }];
    const pendingToolCallIds = new Map<string, string>();
    const reservedIds = new Set(context.messages.flatMap((message) =>
      message.type === "assistant" ? message.toolCalls.map((call) => call.id) : []));
    const usedIds = new Set<string>();
    let nextReplayId = 0;
    const flushInterrupted = () => {
      for (const id of pendingToolCallIds.values()) {
        out.push({ role: "tool", tool_call_id: id, content: JSON.stringify({ status: "interrupted" }) });
      }
      pendingToolCallIds.clear();
    };
    for (const message of context.messages) {
      if (message.type === "user") {
        flushInterrupted();
        out.push({ role: "user", content: message.text });
      } else if (message.type === "assistant") {
        flushInterrupted();
        const calls = [];
        for (const call of message.toolCalls) {
          if (pendingToolCallIds.has(call.id)) continue;
          let id = call.id;
          if (usedIds.has(id)) {
            do { id = `call_h1_replay_${++nextReplayId}`; } while (reservedIds.has(id));
          }
          usedIds.add(id);
          pendingToolCallIds.set(call.id, id);
          calls.push({
            id,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
          });
        }
        if (!message.text && !calls.length) continue;
        out.push({
          role: "assistant",
          content: message.text || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
      } else {
        const id = pendingToolCallIds.get(message.toolCallId);
        if (id === undefined) continue;
        out.push({ role: "tool", tool_call_id: id, content: JSON.stringify(message.content ?? null) });
        pendingToolCallIds.delete(message.toolCallId);
      }
    }
    // 中断恢复：未完成调用补 interrupted 占位结果（§10.2），不自动重执行。
    flushInterrupted();
    return out;
  }

  private parseJsonContent(content: string): unknown {
    const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* fallthrough */
        }
      }
      throw new Error("schema_mismatch: 模型输出不是合法 JSON");
    }
  }
}
