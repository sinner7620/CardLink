import type { Context } from "../../domain/context.ts";
import type { ModelSetting } from "../../domain/model-setting.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";

/** §5 冻结端口：适配器翻译厂商 API。失败抛错，由调用方按 §11 显式处理。 */
export interface ModelClient {
  generate<T>(context: Context<T>, setting: ModelSetting): Promise<T>;
}

/** v2.4 §5 可选扩展（加法，generate 原签名不动）：返回消息级终止原因与用量。 */
export type ModelReply<T> = {
  value: T;
  finishReason: FinishReason;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export interface ModelClientDetailed {
  generateDetailed<T>(context: Context<T>, setting: ModelSetting): Promise<ModelReply<T>>;
}

/** 能力探测：适配器实现 detailed 时返回，否则 null（调用方退回 generate）。 */
export function detailedClientOf(client: ModelClient): ModelClientDetailed | null {
  const candidate = client as unknown as Partial<ModelClientDetailed>;
  return typeof candidate.generateDetailed === "function" ? (client as unknown as ModelClientDetailed) : null;
}

/** 运行时取消能力，由支持中止传输的适配器实现。 */
export interface AbortableModelClient {
  generateWithSignal<T>(context: Context<T>, setting: ModelSetting, signal: AbortSignal): Promise<ModelReply<T>>;
}

export async function requestModel<T>(
  client: ModelClient,
  context: Context<T>,
  setting: ModelSetting,
  signal?: AbortSignal,
  detailed = false,
): Promise<ModelReply<T>> {
  const abortable = client as ModelClient & Partial<AbortableModelClient>;
  const generate = async (): Promise<ModelReply<T>> => {
    if (signal && abortable.generateWithSignal) return abortable.generateWithSignal(context, setting, signal);
    const adapter = detailed ? detailedClientOf(client) : null;
    if (adapter) return adapter.generateDetailed(context, setting);
    return { value: await client.generate(context, setting), finishReason: "completed" };
  };
  if (!signal) return generate();
  if (signal.aborted) throw new Error("model_cancelled");
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("model_cancelled"));
    signal.addEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([generate(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export type ModelClientErrorCode =
  | "unsupported_effort"
  | "timeout"
  | "schema_mismatch"
  | "provider_error"
  | "not_configured";
