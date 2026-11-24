import type { Context } from "../../domain/context.ts";
import type { ModelClient, ModelClientDetailed, ModelClientErrorCode, ModelReply } from "../../application/ports/model-client.ts";
import type { ModelSetting } from "../../domain/model-setting.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";

export type ScriptedResponse = unknown;

/** v2.4：带终止原因的脚本化输出（generateDetailed 用；generate 解包 value）。 */
export type ScriptedDetailed = {
  finishReason: FinishReason;
  usage?: { promptTokens?: number; completionTokens?: number };
  value: ScriptedResponse;
};

type QueueEntry = ScriptedResponse | Error | ScriptedDetailed;

function isDetailed(entry: QueueEntry): entry is ScriptedDetailed {
  return typeof entry === "object" && entry !== null && !(entry instanceof Error) && "finishReason" in entry && "value" in entry;
}

/**
 * 测试用 ModelClient（TDD 先红后绿）：
 * - queue：按顺序消费脚本化输出（assistant → reviewer → …）；
 * - behavior：动态生成；
 * - failNext：模拟模型故障（超时/Schema 不符），供 T13 等使用；
 * - enqueueDetailed：脚本化 finishReason（v2.4）。
 */
export class FakeModelClient implements ModelClient, ModelClientDetailed {
  readonly calls: Array<{ context: Context<unknown>; setting: ModelSetting }> = [];
  private queue: QueueEntry[] = [];
  behavior?: (context: Context<unknown>, callIndex: number) => ScriptedResponse;

  enqueue(response: ScriptedResponse | Error): this {
    this.queue.push(response);
    return this;
  }

  enqueueDetailed(reply: ScriptedDetailed): this {
    this.queue.push(reply);
    return this;
  }

  enqueueMany(responses: Array<ScriptedResponse | Error | ScriptedDetailed>): this {
    for (const r of responses) this.queue.push(r);
    return this;
  }

  reset(): this {
    this.queue = [];
    this.calls.length = 0;
    return this;
  }

  private async produce(context: Context<unknown>): Promise<{ raw: unknown; finishReason: FinishReason; usage?: ScriptedDetailed["usage"] }> {
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (next !== undefined) {
      if (isDetailed(next)) return { raw: next.value, finishReason: next.finishReason, usage: next.usage };
      return { raw: next, finishReason: "completed" };
    }
    if (this.behavior) {
      const raw = await this.behavior(context, this.calls.length);
      return { raw, finishReason: "completed" };
    }
    throw new Error("FakeModelClient 未脚本化任何输出");
  }

  async generate<T>(context: Context<T>, setting: ModelSetting): Promise<T> {
    this.calls.push({ context: context as Context<unknown>, setting });
    const { raw } = await this.produce(context as Context<unknown>);
    return context.outputType.parse(raw);
  }

  async generateDetailed<T>(context: Context<T>, setting: ModelSetting): Promise<ModelReply<T>> {
    this.calls.push({ context: context as Context<unknown>, setting });
    const { raw, finishReason, usage } = await this.produce(context as Context<unknown>);
    return { value: context.outputType.parse(raw), finishReason, usage };
  }

  get assistantCalls(): number {
    return this.calls.filter((c) => c.context.outputType.name === "assistant_message").length;
  }

  get reviewerCalls(): number {
    return this.calls.filter((c) => c.context.outputType.name === "tool_call_decision").length;
  }
}

export type FakeModelErrorCode = ModelClientErrorCode;
