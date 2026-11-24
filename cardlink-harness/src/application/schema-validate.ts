/**
 * 极简 JSON Schema 校验器（只支持工具参数用到的子集）。
 * additionalProperties:false 时拒绝未知字段（§11 严格输入 / T05）。
 */
type Schema = {
  oneOf?: Schema[];
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
};

export function validateAgainstSchema(schema: Schema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.oneOf && schema.oneOf.filter((option) => validateAgainstSchema(option, value, path).length === 0).length !== 1) {
    errors.push(`${path}: 必须匹配一个允许的参数变体`);
  }
  if (schema.type) {
    if (!matchesType(schema.type, value)) {
      return [`${path}: 期望 ${schema.type}，实际 ${describe(value)}`];
    }
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: 值不在枚举 ${JSON.stringify(schema.enum)} 内`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: 小于最小值 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: 大于最大值 ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 长度小于 ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: 长度超过 ${schema.maxLength}`);
  }
  if (Array.isArray(value) && schema.items) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 数组长度小于 ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 数组长度超过 ${schema.maxItems}`);
    value.forEach((item, i) => errors.push(...validateAgainstSchema(schema.items as Schema, item, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (!schema.type || schema.type === "object")) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: 缺少必填字段 ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}: 未知字段 ${key}（additionalProperties:false）`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(sub, obj[key], `${path}.${key}`));
      }
    }
  }
  return errors;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
