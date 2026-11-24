import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createBridgeHandler, type BridgeResult } from "../../src/adapters/bridge/commands.ts";
import { openDatabase } from "../../src/adapters/sqlite/node-driver.ts";
import { FakeModelClient } from "../../src/adapters/model/fake-model-client.ts";
import { createHarnessApp } from "../../src/bootstrap.ts";
import { loadConfig } from "../../src/config.ts";
import { PUBLIC_INTERACTION_PREFIX } from "../../src/application/public-interaction.ts";
import { snapshot1 } from "../fixtures/fixture-data.ts";

async function setup() {
  const driver = openDatabase(":memory:");
  const model = new FakeModelClient();
  const config = loadConfig({ H1_HTTP_TOKEN: "integration", H1_MODEL_API_KEY: "offline" }, false);
  const app = createHarnessApp(config, { driver, model, toolProtocolVersion: 2 });
  await app.syncService.importSnapshot({
    schemaVersion: 1, sourceId: "v217-suite", exportedAt: new Date().toISOString(), isFullSnapshot: true, records: snapshot1(),
  });
  const makeHandler = () => createBridgeHandler({
    service: app.service, repository: app.repository, interactions: app.interactions,
    evidenceStore: app.evidenceStore, runStore: app.runStore,
  });
  const handler = makeHandler();
  const session = await app.service.createSession({ notebookIds: [] });
  return { driver, app, model, handler, makeHandler, session };
}

async function invoke<T = any>(handler: ReturnType<typeof createBridgeHandler>, name: string, data?: unknown): Promise<T> {
  const result = await handler(name, data);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.data as T;
}

async function waitForStop(handler: ReturnType<typeof createBridgeHandler>, runId: string): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await invoke(handler, "harness.getRunStatus", { runId });
    if (result.status !== "active") return result;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail("运行没有进入终态或等待");
}

test("编辑与重生成共享正确的前缀，切换分支不用模型，彻底删除清除全部分支", async () => {
  const { driver, model, handler, session } = await setup();
  try {
    const sessionId = session.id;
    const send = async (text: string, requestId: string) => {
      model.enqueue({ text: requestId, toolCalls: [] });
      const { runId } = await invoke(handler, "harness.startRun", { sessionId, text, requestId });
      assert.equal((await waitForStop(handler, runId)).status, "finished");
    };
    await send("前缀问题", "前缀回答");
    await send("原问题", "原回答");
    const initial = await invoke(handler, "harness.getSession", { sessionId, includeToolActivity: true });
    const [prefix, , anchor] = initial.messages;
    model.enqueue({ text: "改写回答", toolCalls: [] });
    const edited = await invoke(handler, "harness.forkSession", {
      sessionId, branchId: sessionId, anchorId: anchor.id, operation: "edit", text: "改写问题", requestId: "edit-once",
    });
    assert.equal((await waitForStop(handler, edited.runId)).status, "finished");
    const newHistory = await invoke(handler, "harness.getSession", { sessionId, includeToolActivity: true });
    assert.equal(newHistory.messages[0].id, prefix.id);
    assert.deepEqual(newHistory.messages.map((item: any) => item.text), ["前缀问题", "前缀回答", "改写问题", "改写回答"]);
    assert.ok(!model.calls.at(-1)?.context.messages.some((item: any) => item.text === "原回答"));

    const count = model.calls.length;
    await invoke(handler, "harness.selectSessionBranch", { sessionId, branchId: sessionId });
    assert.equal(model.calls.length, count);
    model.enqueue({ text: "重新生成的回答", toolCalls: [] });
    const regenerated = await invoke(handler, "harness.forkSession", {
      sessionId, branchId: sessionId, anchorId: anchor.id, operation: "regenerate", requestId: "regenerate-once",
    });
    assert.equal((await waitForStop(handler, regenerated.runId)).status, "finished");
    const replayed = await invoke(handler, "harness.forkSession", {
      sessionId, branchId: sessionId, anchorId: anchor.id, operation: "regenerate", requestId: "regenerate-once",
    });
    assert.equal(replayed.runId, regenerated.runId);
    const regeneratedHistory = await invoke(handler, "harness.getSession", { sessionId, includeToolActivity: true });
    assert.equal(regeneratedHistory.messages[2].id, anchor.id);
    assert.equal(regeneratedHistory.messages.at(-1).text, "重新生成的回答");
    assert.equal((await invoke(handler, "harness.listSessions")).length, 1);
    const root = await invoke(handler, "harness.getSession", { sessionId, branchId: sessionId, includeToolActivity: true });
    assert.equal(root.messages.at(-1).text, "原回答");
    await invoke(handler, "harness.purgeSession", { sessionId });
    assert.equal(driver.rows("SELECT session_id FROM sessions").length, 0);
    assert.equal(driver.rows("SELECT branch_id FROM session_branches").length, 0);
  } finally { driver.close?.(); }
});

test("待答问题重开桥后可继续同一次运行，提交幂等且取消后拒绝迟到答案", async () => {
  const { driver, model, handler, makeHandler, session } = await setup();
  const sessionId = session.id;
  const question = {
    steps: [{ id: "scope", question: "分析哪种题？", selectionMode: "single", options: [{ id: "due", label: "待复习" }, { id: "all", label: "所有题" }] }],
  };
  const ask = async (requestId: string) => {
    model.enqueue({ text: PUBLIC_INTERACTION_PREFIX + JSON.stringify({ text: "", question }), toolCalls: [] });
    const { runId } = await invoke(handler, "harness.startRun", { sessionId, requestId, text: "分析一道题" });
    const paused = await waitForStop(handler, runId);
    assert.equal(paused.status, "waiting_input");
    return paused.pendingQuestion;
  };
  try {
    const pending = await ask("ask-user");
    await invoke(handler, "harness.saveQuestionDraft", { sessionId, runId: pending.runId, questionId: pending.questionId, answers: { scope: ["due"] } });
    const resumedHandler = makeHandler();
    const restored = await invoke(resumedHandler, "harness.getSession", { sessionId, includeToolActivity: true });
    assert.equal(restored.pendingQuestion.questionId, pending.questionId);
    assert.deepEqual(restored.pendingQuestion.draft, { scope: ["due"] });
    const request = { sessionId, runId: pending.runId, questionId: pending.questionId, requestId: "submit-once" };
    const wrong = await resumedHandler("harness.answerRunQuestion", { ...request, answers: { scope: ["forged"] } });
    assert.equal(wrong.ok, false);
    assert.equal(model.calls.length, 1);
    model.enqueue({ text: "按已选范围完成", toolCalls: [] });
    const answer = await invoke(resumedHandler, "harness.answerRunQuestion", { ...request, answers: { scope: ["due"] } });
    assert.equal(answer.runId, pending.runId);
    assert.equal((await waitForStop(resumedHandler, answer.runId)).status, "finished");
    assert.equal(model.calls.length, 2);
    assert.equal((await invoke(resumedHandler, "harness.answerRunQuestion", { ...request, answers: { scope: ["due"] } })).runId, pending.runId);
    assert.equal(model.calls.length, 2);
    assert.ok(model.calls[1]?.context.messages.some((message) => message.type === "user" && message.text.includes("待复习")));
    const another = await ask("cancel-user");
    await invoke(resumedHandler, "harness.cancelRun", { runId: another.runId });
    const late = await resumedHandler("harness.answerRunQuestion", {
      sessionId, runId: another.runId, questionId: another.questionId, requestId: "late", answers: { scope: ["all"] },
    });
    assert.equal(late.ok, false);
    assert.equal(model.calls.length, 3);
  } finally { driver.close?.(); }
});

test("v2 工具注册显式启用，假证据被拒，队列使用快照确定的有序结果", async () => {
  const { driver, app, model, handler, session } = await setup();
  try {
    assert.equal(app.registry.version, 2);
    assert.equal(app.registry.size(), 7);
    await app.service.setReviewLevel(session.id, "full_allow");
    model.enqueueMany([
      { text: "", toolCalls: [{ id: "stats", name: "getMistakeStats", arguments: {} }] },
      { text: "", toolCalls: [
        { id: "fake", name: "renderVisualization", arguments: { kind: "evidence", view: "table", evidenceIds: ["fabricated"] } },
        { id: "queue", name: "buildReviewQueue", arguments: { goal: "dueToday", limit: 3, timeBudgetMinutes: 15 } },
      ] },
    ]);
    let source = "";
    model.behavior = (context) => {
      const match = /可传给 renderVisualization 的本轮已验证证据：([^ ]+) \(getMistakeStats\)/.exec(context.instruction);
      if (match && !source) {
        source = match[1]!;
        return { text: "", toolCalls: [{ id: "chart", name: "renderVisualization",
          arguments: { kind: "evidence", view: "chart", evidenceIds: [source], fields: ["totalRecords"] } }] };
      }
      return { text: "已生成", toolCalls: [] };
    };
    const { runId } = await invoke(handler, "harness.startRun", { sessionId: session.id, requestId: "artifact-run", text: "生成图表和复习队列" });
    const completed = await waitForStop(handler, runId);
    assert.equal(completed.status, "finished", JSON.stringify(completed.result));
    const calls = completed.toolCalls as Array<{ toolCallId: string; executionStatus: string; resultJson: string }>;
    const envelope = (id: string) => JSON.parse(calls.find((call) => call.toolCallId === id)!.resultJson);
    assert.equal(envelope("fake").ok, false);
    const queue = envelope("queue");
    assert.equal(queue.ok, true, JSON.stringify(queue));
    assert.equal(queue.data.estimate, "unavailable");
    assert.ok(queue.data.items.length <= 3);
    const chart = envelope("chart");
    assert.ok(chart.ok, JSON.stringify(chart));
    assert.equal(chart.data.sources[0].rows[0][0].value, snapshot1().length);
    assert.equal(chart.data.sources[0].evidenceId, source);
  } finally { driver.close?.(); }
});
