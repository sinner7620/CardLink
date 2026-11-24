/**
 * P0 教训补课（b12）：JSB JavaScriptCore 无 AbortController（P0 探针只验证了
 * Promise/异步，漏了此 API——真机上工具执行器直接抛
 * "Can't find variable: AbortController"）。提供最小 polyfill 兜底：
 * H1 传输和运行层通过 abort 事件中止在途操作。
 */
export function installAbortControllerPolyfill(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.AbortController === "function") return;
  class AbortSignalStub {
    aborted = false;
    private readonly listeners = new Set<() => void>();

    addEventListener(type: string, listener: () => void): void {
      if (type === "abort") this.listeners.add(listener);
    }

    removeEventListener(type: string, listener: () => void): void {
      if (type === "abort") this.listeners.delete(listener);
    }

    dispatchAbort(): void {
      if (this.aborted) return;
      this.aborted = true;
      for (const listener of this.listeners) listener();
      this.listeners.clear();
    }
  }
  class AbortControllerStub {
    readonly signal = new AbortSignalStub();
    abort(): void {
      this.signal.dispatchAbort();
    }
  }
  g.AbortController = AbortControllerStub;
  g.AbortSignal = AbortSignalStub;
}
