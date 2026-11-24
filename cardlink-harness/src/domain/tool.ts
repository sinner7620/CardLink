import type { ToolEnvelope } from "./evidence.ts";
import type { SessionId, SessionScope } from "./session.ts";

export type ToolPermission = "mistakes:read";

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema，additionalProperties:false；由 PolicyGuard 严格执行。 */
  parameters: object;
  resultSchema: object;
  permission: ToolPermission;
};

export type ToolExecutionContext = {
  sessionId: SessionId;
  scope: SessionScope;
  snapshotId: string;
  dataAsOf?: string;
  readVerifiedEvidence?: (evidenceId: string) => ToolEnvelope | undefined;
  /** b12：JSB 无 AbortController——最小可轮询标志（工具当前均为快速 SQL，不使用）。 */
  signal: { readonly aborted: boolean };
};

export interface Tool {
  definition: ToolDefinition;
  run(args: unknown, ctx: ToolExecutionContext): Promise<unknown>;
}
