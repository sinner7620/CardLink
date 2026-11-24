/** 规范化 JSON：键排序，保证哈希稳定（domain 纯实现，JSB/Node 通用）。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortValue((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * djb2 确定性哈希（十六进制）。用于工具调用参数幂等冲突检测（§5）：
 * 只需稳定性与区分度，不作安全用途；跨平台（Node/JSB）一致。
 */
export function stableHashHex(text: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = (h1 * 33) ^ ch;
    h2 = (h2 * 31) ^ ch;
  }
  const unsigned = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
  return `${unsigned(h1)}${unsigned(h2)}`;
}
