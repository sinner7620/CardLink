/**
 * v2.5 §5.2：token 用量。`estimated=true` 表示服务商未返回用量（或适配器未实现
 * generateDetailed），由本地估算器得出；UI 必须如实标注"估算"，不得展示虚假精确值。
 */
export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated: boolean;
};

export function makeUsage(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  estimated: boolean,
): TokenUsage {
  const prompt = typeof promptTokens === "number" && Number.isFinite(promptTokens) ? Math.max(0, Math.round(promptTokens)) : undefined;
  const completion =
    typeof completionTokens === "number" && Number.isFinite(completionTokens) ? Math.max(0, Math.round(completionTokens)) : undefined;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt !== undefined || completion !== undefined ? (prompt ?? 0) + (completion ?? 0) : undefined,
    estimated,
  };
}

/** 轮次累计：多次模型调用（Assistant 循环 + Reviewer）求和；任一为估算则整体标注估算。 */
export function addUsage(a: TokenUsage | null | undefined, b: TokenUsage | null | undefined): TokenUsage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const sum = (x?: number, y?: number): number | undefined => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return {
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    estimated: a.estimated || b.estimated,
  };
}
