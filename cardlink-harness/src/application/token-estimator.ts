/**
 * v2.5 §5.2：token 估算器（应用层）。
 *
 * H1 不引入 Node 依赖或庞大分词器：默认使用**保守语言感知估算器**——
 * - CJK / 全角字符按 1 token/字（中文实际约 1–1.5 字/token，按 1 估算偏保守）；
 * - 拉丁字母、数字与结构字符按 3 字符/token（英文实际约 4 字符/token，偏保守）；
 * - 空白不计；每条消息与每个工具定义另计结构开销。
 * 估算结果会由服务商返回的 `prompt_tokens` 按 provider+model 校准（见 ModelCapabilitiesRegistry）。
 */
import { BREAKDOWN_PART_KEYS, type RequestTokenBreakdown } from "../domain/request-telemetry.ts";

export interface TokenEstimator {
  readonly id: string;
  estimate(text: string): number;
}

function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) || // CJK 部首、假名、统一表意文字
    (cp >= 0xac00 && cp <= 0xd7af) || // 韩文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意文字
    (cp >= 0xff00 && cp <= 0xffef) || // 全角字符
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK 扩展 B 及以后
  );
}

export class HeuristicTokenEstimator implements TokenEstimator {
  readonly id = "heuristic-v1";

  estimate(text: string): number {
    if (!text) return 0;
    let tokens = 0;
    let latinRun = 0;
    const flush = (): void => {
      if (latinRun > 0) {
        tokens += Math.ceil(latinRun / 3);
        latinRun = 0;
      }
    };
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 0;
      if (cp <= 0x20 || cp === 0x7f) {
        flush();
        continue;
      }
      if (isCjkCodePoint(cp)) {
        flush();
        tokens += 1;
        continue;
      }
      latinRun += 1;
      if (latinRun >= 3) {
        tokens += 1;
        latinRun = 0;
      }
    }
    flush();
    return tokens;
  }
}

export const DEFAULT_TOKEN_ESTIMATOR: TokenEstimator = new HeuristicTokenEstimator();

export type EstimableContext = {
  instruction: string;
  messages: Array<unknown>;
  tools: Array<unknown>;
};

/** 估算一次模型调用的输入 token（系统指令 + 工具定义 + 完整消息 + 结构开销）。 */
export function estimateContextInput(context: EstimableContext, estimator: TokenEstimator = DEFAULT_TOKEN_ESTIMATOR): number {
  let total = estimator.estimate(context.instruction) + 8;
  for (const tool of context.tools) total += estimator.estimate(JSON.stringify(tool)) + 8;
  for (const message of context.messages) total += estimator.estimate(JSON.stringify(message)) + 4;
  return total;
}

/** 按校准系数缩放（向上取整，保持保守）。 */
export function applyCalibration(tokens: number, ratio: number | undefined): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return tokens;
  return Math.ceil(tokens * ratio);
}

/**
 * v2.14 §22：把一次请求的输入按来源拆成估算分项。
 * 与 `estimateContextInput` 同源同算法（每个工具 +8、每条消息 +4、指令 +8），
 * 因此 raw 分项之和恒等于 `estimateContextInput` 的返回值。
 */
export type BreakdownInput = {
  /** 系统指令正文（不含压缩摘要）。 */
  instructionBase: string;
  /** 注入 instruction 的历史压缩摘要（无则 null）。 */
  compactionSummary?: string | null;
  tools: Array<unknown>;
  messages: Array<{ type?: string }>;
};

export function estimateBreakdown(
  input: BreakdownInput,
  estimator: TokenEstimator = DEFAULT_TOKEN_ESTIMATOR,
): RequestTokenBreakdown {
  const instructionTokens = estimator.estimate(input.instructionBase);
  const compactionTokens = input.compactionSummary ? estimator.estimate(input.compactionSummary) : 0;
  let toolDefinitionTokens = 0;
  for (const tool of input.tools) toolDefinitionTokens += estimator.estimate(JSON.stringify(tool)) + 8;
  let messageTokens = 0;
  let toolResultTokens = 0;
  for (const message of input.messages) {
    const tokens = estimator.estimate(JSON.stringify(message)) + 4;
    if (message && message.type === "tool_result") toolResultTokens += tokens;
    else messageTokens += tokens;
  }
  const overheadTokens = 8;
  return {
    instructionTokens,
    compactionTokens,
    toolDefinitionTokens,
    messageTokens,
    toolResultTokens,
    overheadTokens,
    totalTokens:
      instructionTokens + compactionTokens + toolDefinitionTokens + messageTokens + toolResultTokens + overheadTokens,
  };
}

/**
 * 按校准系数缩放分项，并让 `totalTokens` 精确等于预算计划的有效输入估算。
 *
 * 采用累计取整把校准误差摊到各分项，最后把舍入差额并入结构开销：
 * 不变量是「分项之和 == totalTokens == 计划估算」，展示层不需要再解释差额。
 */
export function scaleBreakdown(
  raw: RequestTokenBreakdown,
  ratio: number | undefined,
  targetTotal?: number,
): RequestTokenBreakdown {
  const factor = ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const parts: number[] = [];
  let cumulative = 0;
  let previous = 0;
  for (const key of BREAKDOWN_PART_KEYS) {
    cumulative += raw[key] * factor;
    const rounded = Math.round(cumulative);
    parts.push(Math.max(0, rounded - previous));
    previous = rounded;
  }
  const scaledSum = parts.reduce((sum, value) => sum + value, 0);
  const total =
    typeof targetTotal === "number" && Number.isFinite(targetTotal) && targetTotal >= 0
      ? Math.round(targetTotal)
      : scaledSum;
  let diff = total - scaledSum;
  // 差额通常为 0 或 ±1；负差额在结构开销不足时按最大项吸收，保证分项非负且总额精确。
  for (let guard = 0; diff !== 0 && guard < parts.length * 2; guard++) {
    let index = BREAKDOWN_PART_KEYS.indexOf("overheadTokens");
    if (diff < 0 && parts[index] + diff < 0) {
      index = 0;
      for (let i = 1; i < parts.length; i++) if (parts[i] > parts[index]) index = i;
    }
    if (diff > 0) {
      parts[index] += diff;
      diff = 0;
    } else {
      const absorb = Math.min(parts[index], -diff);
      parts[index] -= absorb;
      diff += absorb;
    }
  }
  const result = { ...raw };
  BREAKDOWN_PART_KEYS.forEach((key, index) => {
    result[key] = parts[index] as number;
  });
  result.totalTokens = parts.reduce((sum, value) => sum + value, 0);
  return result;
}
