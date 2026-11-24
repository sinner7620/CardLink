import type { ToolCall, ToolResult } from "../domain/message.ts";
import { newToolResult } from "../domain/message.ts";
import type { ToolEnvelope } from "../domain/evidence.ts";
import type { ToolExecutionContext } from "../domain/tool.ts";
import type { ToolRegistry } from "./tool-registry.ts";

export type ExecutionOutcome = {
  result: ToolResult;
  envelope: unknown;
};

/**
 * 工具超时定时器端口（b17）。
 *
 * JSB 的裸 `setTimeout` 实测按 ~30s 节拍触发（`docs/changes/2026-11-13-harness-p0-package.md`：
 * 预期 150ms 实测 30092ms），所以设备侧必须注入 MN Utils `delay` 适配器；
 * Node/测试侧沿用默认实现。可注入也便于单测用假时钟验证"超时丢弃迟到结果"。
 */
export type ToolTimer = (ms: number) => { promise: Promise<void>; cancel: () => void };

export const defaultToolTimer: ToolTimer = (ms) => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
};

const TIMEOUT = Symbol("tool_timeout");

/**
 * 只读工具执行器：带超时与受控错误；任何异常都转成结构化 envelope，
 * 不向模型泄漏堆栈或敏感正文（§11）。
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly timeoutMs: number,
    private readonly timer: ToolTimer = defaultToolTimer,
  ) {}

  has(name: string): boolean {
    return this.registry.get(name) !== undefined;
  }

  async execute(call: ToolCall, base: Omit<ToolExecutionContext, "signal">): Promise<ExecutionOutcome> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      // 理论上不可达：PolicyGuard 先行。防御性兜底（T05）。
      return {
        envelope: { ok: false, tool: call.name, error: { code: "invalid_args", message: "工具未注册" } },
        result: newToolResult(call.id, "error", { code: "unknown_tool", message: "工具未注册" }),
      };
    }
    // b12 修正（P0 教训）：JSB JavaScriptCore 无 AbortController——改用可变标志 + 竞速实现超时。
    let aborted = false;
    const ctx: ToolExecutionContext = { ...base, signal: { get aborted() { return aborted; } } };
    const timeout = this.timer(this.timeoutMs);
    try {
      const run = Promise.resolve(tool.run(call.arguments ?? {}, ctx)) as Promise<Record<string, unknown>>;
      const raced = (await Promise.race([run, timeout.promise.then(() => TIMEOUT)])) as
        | Record<string, unknown>
        | typeof TIMEOUT;
      if (raced === TIMEOUT) {
        aborted = true;
        const envelope = {
          ok: false,
          tool: call.name,
          error: { code: "timeout", message: `工具执行超时（>${this.timeoutMs}ms）` },
        };
        return { envelope, result: newToolResult(call.id, "timeout", envelope) };
      }
      const ok = raced.ok === true;
      if (ok && (raced as ToolEnvelope).evidence?.snapshotId !== base.snapshotId) {
        throw new Error("工具结果与运行锁定的快照不一致");
      }
      return {
        envelope: raced,
        result: newToolResult(call.id, ok ? "ok" : "error", raced),
      };
    } catch (error) {
      const code = aborted ? "timeout" : "internal_error";
      const message = aborted
        ? `工具执行超时（>${this.timeoutMs}ms）`
        : `工具执行失败: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
      const envelope = { ok: false, tool: call.name, error: { code, message } };
      return {
        envelope,
        result: newToolResult(call.id, aborted ? "timeout" : "error", envelope),
      };
    } finally {
      timeout.cancel();
    }
  }
}
