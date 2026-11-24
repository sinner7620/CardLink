export type OutputSchema<T> = {
  name: string;
  jsonSchema: object;
  /** 运行时校验：不可仅凭 TypeScript 泛型假设模型输出正确。 */
  parse(raw: unknown): T;
};

export type Context<T> = {
  instruction: string;
  tools: import("./tool.ts").ToolDefinition[];
  messages: import("./message.ts").AgentMessage[];
  outputType: OutputSchema<T>;
  evidenceRefs?: string[];
};
