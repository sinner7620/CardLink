import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { ToolExecutor } from "../../src/application/tool-executor.ts";
import type { Tool, ToolDefinition } from "../../src/domain/tool.ts";

/**
 * b12：工具执行器在 JSB（无 AbortController）上可用。
 * ① 超时经 Promise.race 真实产生 timeout 结果（旧实现在 JSB 直接抛
 *    "Can't find variable: AbortController"，且 abort 标志本就无法中断非抛错工具）；
 * ② 正常路径不变。
 */

function hangingTool(): Tool {
  const definition: ToolDefinition = {
    name: "hangTool",
    description: "挂起工具（超时测试）",
    parameters: {},
    resultSchema: { type: "object" },
    permission: "mistakes:read",
  };
  return { definition, run: () => new Promise(() => undefined) };
}

function okTool(): Tool {
  const definition: ToolDefinition = {
    name: "okTool",
    description: "正常工具",
    parameters: {},
    resultSchema: { type: "object" },
    permission: "mistakes:read",
  };
  return {
    definition,
    run: async () => ({ ok: true, tool: "okTool", data: { fine: true }, evidence: { snapshotId: "s", dataAsOf: "2026-11-14T00:00:00.000Z" } }),
  };
}

function registryWith(tools: Tool[]): unknown {
  return { get: (name: string) => tools.find((t) => t.definition.name === name) };
}

const base = { sessionId: "s" as const, scope: { notebookIds: [] }, snapshotId: "none" };

describe("b12: 工具执行器 JSB 兼容", () => {
  test("挂起工具在超时后产生 timeout 结果（无 AbortController 依赖）", async () => {
    const executor = new ToolExecutor(registryWith([hangingTool()]) as never, 60);
    const outcome = await executor.execute({ id: "c1", name: "hangTool", arguments: {} }, base);
    assert.equal(outcome.result.status, "timeout");
    const envelope = outcome.envelope as { error?: { code?: string } };
    assert.equal(envelope.error?.code, "timeout");
  });

  test("正常工具返回 ok,signal 为可轮询标志", async () => {
    const executor = new ToolExecutor(registryWith([okTool()]) as never, 500);
    const outcome = await executor.execute({ id: "c2", name: "okTool", arguments: {} }, { ...base, snapshotId: "s" });
    assert.equal(outcome.result.status, "ok");
    assert.equal((outcome.envelope as { data?: { fine?: boolean } }).data?.fine, true);
  });

  test("工具返回另一快照时，不把数值交给模型", async () => {
    const executor = new ToolExecutor(registryWith([okTool()]) as never, 500);
    const outcome = await executor.execute({ id: "cross-snapshot", name: "okTool", arguments: {} }, { ...base, snapshotId: "other" });
    assert.equal(outcome.result.status, "error");
    assert.equal("data" in (outcome.envelope as object), false);
  });

  test("未注册工具兜底（防御性）", async () => {
    const executor = new ToolExecutor(registryWith([]) as never, 100);
    const outcome = await executor.execute({ id: "c3", name: "nope", arguments: {} }, base);
    assert.equal(outcome.result.status, "error");
  });
});
