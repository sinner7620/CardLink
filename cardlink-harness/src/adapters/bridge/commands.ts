import type { InteractionStore, PendingQuestion } from "../../application/public-interaction.ts";
import { validateUserText } from "../../domain/message.ts";
import type { AgentService, AgentTurnResult } from "../../application/agent-service.ts";
import type { SyncService } from "../../application/sync-service.ts";
import type { StatisticsEngine } from "../../application/statistics-engine.ts";
import type { MistakeRepository } from "../../application/ports/mistake-repository.ts";
import type { ProviderConfigStore, ModelCredentialStore } from "../../application/ports/provider-store.ts";
import type { ModelProviderConfig } from "../../domain/provider.ts";
import type { RunStore } from "../../application/ports/run-store.ts";
import type { EvidenceStore } from "../../application/ports/evidence-store.ts";
import { InMemoryRoleConfigStore, type RoleConfigStore } from "../../application/ports/role-config-store.ts";
import type { ModelCapabilitiesRegistry } from "../../application/model-capabilities-registry.ts";
import type { CompactionService } from "../../application/compaction-service.ts";
import type { RequestTelemetryService } from "../../application/request-telemetry-service.ts";
import { defaultCapabilities } from "../../domain/model-capabilities.ts";
import { randomUUID } from "../../platform/uuid.ts";
import type { ModelRoleSetting, RoleName } from "../../domain/provider.ts";
import { supportedReasoningEfforts, validateProviderConfig } from "../../domain/provider.ts";
import { fetchProviderModels } from "../model/model-catalog.ts";
import { judgeFreshness } from "../../application/data-freshness.ts";
import { validateBudgetTier, type BudgetTier, type RunBudget } from "../../domain/run-budget.ts";
import { canonicalJson, stableHashHex } from "../../domain/canonical.ts";
import type { ToolEnvelope } from "../../domain/evidence.ts";
import { sha256Hex } from "../../platform/sha256.ts";

function pendingQuestionDto(pending: PendingQuestion | null | undefined) {
  return pending ? { runId: pending.runId, questionId: pending.questionId, steps: pending.question.steps,
    submittedAnswers: pending.answers, draft: pending.draft, submissionId: pending.submissionId } : undefined;
}

export type BridgeResult = { ok: boolean; data?: unknown; error?: { code: string; message: string } };

/** v2.1 §13 白名单命令面（不是模型工具）；v2.4 §13.1 新增会话管理/续答命令。 */
export const HARNESS_COMMANDS = [
  "harness.health",
  "harness.createSession",
  "harness.listSessions",
  "harness.getSession",
  "harness.forkSession",
  "harness.selectSessionBranch",
  "harness.answerRunQuestion",
  "harness.saveQuestionDraft",
  "harness.startRun",
  "harness.getRunStatus",
  "harness.cancelRun",
  "harness.deleteSession",
  "harness.purgeSession",
  "harness.renameSession",
  "harness.continueRun",
  "harness.resolveRecordTitles",
  "harness.exportSession",
  "harness.importSnapshot",
  "harness.stats",
  "harness.getEvidence",
  "harness.listModelProviders",
  "harness.getModelSettings",
  "harness.setSessionModel",
  "harness.saveModelConnection",
  "harness.activateModelRoles",
  "harness.listProviderModels",
  "harness.setProviderConfig",
  "harness.setCredential",
  "harness.setModelRoleConfig",
  "harness.testModelProvider",
  "harness.clearCredential",
  "harness.setReviewLevel",
  // v2.5 §13：模型能力（上下文窗口/输出上限）用户覆盖与查询。
  "harness.getModelCapabilities",
  "harness.setModelCapabilities",
  // v2.14 §22：上下文用量遥测（只读）与手动费率（H1 元数据，不是模型工具）。
  "harness.getContextInsights",
  "harness.getModelRate",
  "harness.setModelRate",
  "harness.clearModelRate",
  "harness.listModelRates",
  // v2.16 §6.3/§11.3：本地源新鲜度（只读）与会话默认运行预算档位。
  "harness.getDataFreshness",
  "harness.setBudgetTier",
] as const;

export type BridgeCommandName = (typeof HARNESS_COMMANDS)[number];

export { InMemoryRoleConfigStore, type RoleConfigStore };

export type BridgeDeps = {
  service: AgentService;
  interactions?: InteractionStore;
  repository: MistakeRepository;
  syncService?: SyncService;
  statisticsEngine?: StatisticsEngine;
  runStore?: RunStore;
  evidenceStore?: EvidenceStore;
  providers?: ProviderConfigStore;
  credentials?: ModelCredentialStore;
  roles?: RoleConfigStore;
  /** v2.5 §5.2：模型能力登记（预算/校准）。 */
  capabilities?: ModelCapabilitiesRegistry;
  /** v2.5 §11.1：压缩记录（UI 显示已压缩次数）。 */
  compactions?: CompactionService;
  /** v2.14 §22：请求用量遥测与手动费率（只读查询 + 本地设置命令）。 */
  telemetry?: RequestTelemetryService;
  /** v2.16 §6.3：本地源指纹基线（设备侧由插件写入；此处只读回显）。 */
  sourceBaseline?: { get(sourceId: string): { fingerprint: string; snapshotId: string; updatedAt: string } | null };
  /** P4-2：协议客户端工厂（设备注入 ocrHTTP 传输）；缺省 fetch 直连。 */
  createProtocolClient?: (config: import("../../domain/provider.ts").ModelProviderConfig, apiKey: string) => import("../../application/ports/model-client.ts").ModelClient;
  /**
   * v2.3 §5.1.6：模型目录抓取（设备注入 ocrHTTP 传输，缺省 fetch 直连）。
   * 只接收 provider 配置与已解析的密钥，不接受来自 WebView 的 URL。
   */
  modelCatalog?: (config: ModelProviderConfig, apiKey: string) => Promise<import("../model/model-catalog.ts").ModelCatalog>;
};

type RunHandle = {
  promise?: Promise<AgentTurnResult>;
  controller: AbortController;
  result?: AgentTurnResult;
  context?: AgentTurnResult["context"];
  /** v2.4：会话绑定（deleteSession 判断运行中会话、getRunStatus 回显）。 */
  sessionId?: string;
  requestId: string;
  /** v2.16 §11.3：本 Run 固定的预算（运行中也可回显档位/上限/已用工具数）。 */
  budget?: RunBudget;
};

/**
 * AgentTurnResult → Run 状态（仅当 runs 行已不可读时用于内存回显）。
 * 与 launchTurn 的兜底收尾同口径；用户取消优先于 failed。
 */
function runStatusOf(result: AgentTurnResult): "finished" | "interrupted" | "cancelled" | "failed" {
  if (result.status === "completed") return "finished";
  if (result.status === "limit_reached") return "interrupted";
  if (result.finishReason === "cancelled") return "cancelled";
  return "failed";
}

/**
 * v2.1 §13：命令桥分发器（WebView/场景面板 → Harness）。
 * - 严格白名单：未知命令拒绝（T25）；
 * - startRun 异步返回 runId，getRunStatus 轮询，cancelRun 协作取消；
 * - 密钥只经 setCredential 进入内存（T30：任何响应/持久化不含密钥）。
 */
export function createBridgeHandler(deps: BridgeDeps): (name: string, data?: unknown) => Promise<BridgeResult> {
  const runs = new Map<string, RunHandle>();

  /** v2.4：该会话是否有未终结的运行（内存 handle；进程重启后无从运行，视为空闲）。 */
  const runningHandleOfSession = (sessionId: string): { runId: string; handle: RunHandle } | null => {
    for (const [runId, handle] of runs) {
      if (handle.sessionId === sessionId && handle.result === undefined) return { runId, handle };
    }
    return null;
  };

  const branchTarget = (payload: Record<string, unknown>): string => {
    const rootId = String(payload.sessionId ?? "");
    return typeof payload.branchId === "string"
      ? deps.service.branchView(rootId, payload.branchId).branchId
      : rootId;
  };

  const runningInConversation = (rootId: string) => {
    for (const { id } of deps.service.branchView(rootId).branches) {
      const running = runningHandleOfSession(id);
      if (running) return running;
    }
    return null;
  };

  /**
   * v2.16 §6.3/§11：Run 入列时决定快照。
   * - 新提问：最新快照；
   * - 续答：沿用该会话最近一次 Run 锁定的快照（历史 `none` 表示空快照，缺元数据显式失败，
   *   不回退最新）；无历史 Run 时按首次续答使用最新。
   * 必须在预占 Run 之前调用，否则“最近 Run”会先命中本次预占行。
   */
  const snapshotForLaunch = async (sessionId: string, mode: "send" | "continue") => {
    if (mode === "send") return deps.repository.getLatestSnapshotMeta();
    const previous = deps.runStore?.latestBySession?.(sessionId) ?? null;
    if (!previous) return deps.repository.getLatestSnapshotMeta();
    if (previous.snapshotId === "none") return null;
    const pinned = deps.repository.forSnapshot?.(previous.snapshotId);
    if (!pinned) throw new Error(`snapshot_unavailable: 当前仓储不支持读取上次 Run 锁定的快照 ${previous.snapshotId}`);
    const meta = await pinned.getLatestSnapshotMeta();
    if (!meta) throw new Error(`snapshot_unavailable: 上次 Run 锁定的快照 ${previous.snapshotId} 已不可用`);
    return meta;
  };

  /** startRun / continueRun 共用启动器：run 行 + 异步执行 + 兜底收尾。 */
  const launchTurn = async (sessionId: string, requestId: string, mode: "send" | "continue", text?: string, budgetTier?: BudgetTier, resumeQuestion?: PendingQuestion) => {
    const stored = deps.runStore?.findByRequest(sessionId, requestId);
    if (stored && !resumeQuestion) return { runId: stored.runId };
    if (resumeQuestion && (!stored || stored.runId !== resumeQuestion.runId || stored.status !== "active")) throw new Error("原运行无法继续");
    // 先决定快照再预占 Run（§6.3 续答使用上次 Run 的保留快照）。
    const snapshot = await snapshotForLaunch(sessionId, mode);
    // Recheck after the await for handlers without durable storage.
    for (const [runId, handle] of runs) {
      if (handle.sessionId === sessionId && handle.requestId === requestId && (!resumeQuestion || handle.result === undefined)) return { runId };
    }
    // v2.16 §11.3：档位在 Run 入列时解析并固定（未知档已在此之前拒绝）。
    const budget = resumeQuestion?.checkpoint.budget ?? (budgetTier ? deps.service.resolveBudget(budgetTier) : deps.service.legacyBudget());
    const runId = resumeQuestion?.runId ?? randomUUID();
    const reserved = resumeQuestion ? stored : deps.runStore?.startRun(runId, sessionId, snapshot?.snapshotId ?? "none", requestId, budgetTier);
    if (reserved && reserved.runId !== runId) return { runId: reserved.runId };
    if (resumeQuestion && (deps.runStore?.get(runId)?.status !== "active" || !deps.interactions?.pendingForRun(runId))) {
      throw new Error("原运行已终止");
    }
    const handle: RunHandle = { controller: new AbortController(), sessionId, requestId, budget };
    const promise = Promise.resolve().then(() => {
      const options = {
        runId,
        snapshot,
        signal: handle.controller.signal,
        budget,
        resumeQuestion,
        onContext: (context: NonNullable<AgentTurnResult["context"]>) => { handle.context = context; },
      };
      return mode === "send"
        ? deps.service.sendMessage(sessionId, requestId, text ?? "", options)
        : deps.service.continueTurn(sessionId, requestId, options);
    }).then(
      (result) => {
        // 兜底收尾仍处于 active 的 run 记录——sendMessage 的早退错误路径
        // （session_not_found/invalid_message 等）不会自己收尾，否则轮询 UI 永远 active。
        if (result.status !== "waiting_input") deps.interactions?.closeRun(runId);
        if (result.status !== "waiting_input" && deps.runStore && deps.runStore.get(runId)?.status === "active") {
          const status = runStatusOf(result);
          deps.runStore.finish(
            runId,
            status,
            status === "finished" ? "finished" : "interrupted",
            JSON.stringify(result),
            undefined,
            result.finishReason,
          );
        }
        handle.result = result;
        return result;
      },
      (error) => {
        const result: AgentTurnResult = {
          status: "error",
          error: { code: "run_failed", message: String(error instanceof Error ? error.message : error).slice(0, 400) },
        };
        handle.result = result;
        deps.interactions?.closeRun(runId);
        if (deps.runStore && deps.runStore.get(runId)?.status === "active") {
          deps.runStore.finish(runId, "failed", "failed", JSON.stringify(result), result.error?.message);
        }
        return result;
      },
    );
    handle.promise = promise;
    runs.set(runId, handle);
    return { runId };
  };

  const asResult = async (name: string, fn: () => Promise<unknown> | unknown): Promise<BridgeResult> => {
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      // 错误信息不携带密钥（适配器层已保证）；此处仅截断长度。
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: `${name}_failed`, message: message.slice(0, 400) } };
    }
  };

  return async (name: string, data?: unknown): Promise<BridgeResult> => {
    if (!(HARNESS_COMMANDS as readonly string[]).includes(name)) {
      return { ok: false, error: { code: "unknown_command", message: `未知命令: ${name}` } };
    }
    const payload = (data ?? {}) as Record<string, unknown>;

    switch (name) {
      case "harness.health": {
        const meta = await deps.repository.getLatestSnapshotMeta();
        // credentialRefs 仅含引用名（不含密钥），供设置页显示"已设置"状态（§12.1）。
        const credentialRefs = deps.credentials?.refs?.() ?? [];
        const assistant = deps.roles?.get("assistant");
        return { ok: true, data: {
          ok: true, snapshotId: meta?.snapshotId ?? "none", version: "h1-0.1.0", credentialRefs,
          assistantConfigured: assistant ? credentialRefs.includes(assistant.credentialRef) : false,
        } };
      }
      case "harness.createSession":
        return asResult(name, () => deps.service.createSession(payload.scope ?? { notebookIds: [] }).then((s) => ({ sessionId: s.id })));
      case "harness.listSessions": {
        const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 20)));
        // v2.4 §13.1：默认返回摘要（不加载消息体）；summaries=false 走旧全量列表。
        if (payload.summaries !== false) {
          const query = typeof payload.query === "string" ? payload.query : undefined;
          return asResult(name, () => deps.service.listSessionSummaries(limit, query));
        }
        return asResult(name, () =>
          deps.service.listSessions(limit, typeof payload.cursor === "string" ? payload.cursor : undefined),
        );
      }
      case "harness.getSession":
        return asResult(name, async () => {
          const rootId = String(payload.sessionId ?? "");
          const view = payload.includeToolActivity === true
            ? deps.service.branchView(rootId, typeof payload.branchId === "string" ? payload.branchId : undefined)
            : null;
          const session = await deps.service.getSession(view?.branchId ?? rootId);
          if (!session) throw new Error("会话不存在");
          if (!view || !deps.runStore) return session;
          const toolActivity = Object.create(null) as Record<string, unknown>;
          const durations = new Map<string, number | undefined>();
          for (const message of session.messages) {
            if (message.type !== "tool_result") continue;
            const owner = session.sharedMessageOwners?.[message.id] ?? session.id;
            const call = deps.runStore.getToolCall(owner, message.toolCallId);
            if (!call) continue;
            const { runId, executionStatus, policyStatus, reviewerApproved, reviewerReason, argsHash, evidenceJson } = call;
            if (!durations.has(runId)) {
              const run = deps.runStore.get(runId);
              const elapsed = run && run.status !== "active" ? Date.parse(run.updatedAt) - Date.parse(run.createdAt) : NaN;
              durations.set(runId, Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined);
            }
            toolActivity[message.id] = { runId, durationMs: durations.get(runId), executionStatus, policyStatus,
              reviewerApproved, reviewerReason, argsHash, evidenceJson };
          }
          const visibleOutcomes: Record<string, unknown> = Object.create(null);
          const interactionStore = deps.interactions;
          if (interactionStore) {
            const owners = new Set([session.id, ...Object.values(session.sharedMessageOwners ?? {})]);
            for (const owner of owners) {
              const outcomes = interactionStore.outcomes(owner);
              for (const message of session.messages) {
                if ((session.sharedMessageOwners?.[message.id] ?? session.id) === owner && outcomes[message.id]) {
                  visibleOutcomes[message.id] = outcomes[message.id];
                }
              }
            }
          }
          const pending = pendingQuestionDto(interactionStore?.pendingForSession(session.id));
          const assistant = session.assistantModel ?? deps.roles?.get("assistant");
          const assistantModel = assistant ? { ...assistant,
            availableEfforts: supportedReasoningEfforts(deps.providers?.get(assistant.providerId), assistant.model),
          } : undefined;
          return { ...session, ...view, assistantModel, toolActivity, publicOutcomes: visibleOutcomes, pendingQuestion: pending };
        });
      case "harness.selectSessionBranch":
        return asResult(name, () => deps.service.selectBranch(String(payload.sessionId ?? ""), String(payload.branchId ?? "")));
      case "harness.forkSession":
        return asResult(name, async () => {
          const rootId = String(payload.sessionId ?? "");
          if (runningInConversation(rootId)) throw new Error("请等待本轮结束再创建分支");
          const fromId = branchTarget(payload);
          const requestId = String(payload.requestId ?? "");
          const anchorId = String(payload.anchorId ?? "");
          const operation = payload.operation;
          if (!requestId.trim() || requestId.length > 128 || !anchorId || anchorId.length > 128 ||
            (operation !== "edit" && operation !== "regenerate")) throw new Error("分支请求非法");
          const text = operation === "edit" ? validateUserText(payload.text) : undefined;
          if (text && !text.ok) throw new Error(text.reason);
          const view = deps.service.forkSession(rootId, fromId, anchorId, operation, requestId);
          const session = await deps.service.getSession(view.branchId);
          const launched = await launchTurn(view.branchId, requestId, operation === "edit" ? "send" : "continue",
            text?.ok ? text.text : undefined, session?.budgetTier);
          return { ...view, ...launched };
        });
      case "harness.saveQuestionDraft":
        return asResult(name, () => {
          if (!deps.interactions) throw new Error("问题不可用");
          deps.interactions.saveDraft(String(payload.questionId ?? ""), String(payload.runId ?? ""), branchTarget(payload), payload.answers);
          return { saved: true };
        });
      case "harness.answerRunQuestion":
        return asResult(name, async () => {
          const interactions = deps.interactions;
          const store = deps.runStore;
          const sessionId = branchTarget(payload);
          const runId = String(payload.runId ?? "");
          const questionId = String(payload.questionId ?? "");
          const requestId = String(payload.requestId ?? "");
          const run = store?.get(runId);
          const session = await deps.service.getSession(sessionId);
          if (!interactions || !run || !session || session.deletedAt || run.sessionId !== sessionId ||
            !questionId || questionId.length > 80 || !requestId.trim() || requestId.length > 128) throw new Error("问题不可用");
          const pending = interactions.pendingForRun(runId);
          if (pending && pending.questionId !== questionId) throw new Error("当前运行正在等待另一个问题");
          const answer = interactions.accept(questionId, requestId, payload.answers, runId, sessionId);
          if (!pending || run.status !== "active") return { runId };
          const existing = runs.get(runId);
          if (existing && existing.result === undefined) return { runId };
          if (run.iteration >= answer.checkpoint.iteration) throw new Error("应答后的运行已在重启前开始，无法从该检查点重复请求");
          return launchTurn(sessionId, run.requestId, "continue", undefined, run.budgetTier, answer);
        });
      case "harness.renameSession":
        // v2.4 §13.1：重命名（标题校验由 service 承担）。
        return asResult(name, () =>
          deps.service.renameSession(String(payload.sessionId ?? ""), payload.title).then((s) => ({ sessionId: s.id, title: s.title })),
        );
      case "harness.deleteSession": {
        // v2.4 §13.1：软删除。运行中默认拒绝（session_running + runId）；force=先协作取消再删除。
        const sessionId = String(payload.sessionId ?? "");
        const running = await deps.service.getSession(sessionId) ? runningInConversation(sessionId) : null;
        if (running && payload.force !== true) {
          return { ok: false, error: { code: "session_running", message: `会话正在运行（runId: ${running.runId}），先取消或使用 force` } };
        }
        if (running) {
          running.handle.controller.abort();
        }
        return asResult(name, async () => {
          await running?.handle.promise;
          await deps.service.deleteSession(sessionId);
          return { sessionId, deleted: true, cancelRequested: Boolean(running) };
        });
      }
      case "harness.purgeSession": {
        // v2.4 §13.1 补强：彻底删除（不可恢复）。运行中与软删除同口径——先取消，除非明确 force。
        const sessionId = String(payload.sessionId ?? "");
        const running = await deps.service.getSession(sessionId) ? runningInConversation(sessionId) : null;
        if (running && payload.force !== true) {
          return { ok: false, error: { code: "session_running", message: `会话正在运行（runId: ${running.runId}），先取消或使用 force` } };
        }
        if (running) {
          running.handle.controller.abort();
          // 运行中彻底删除：等本轮收尾（取消检查点）后再物理清除——
          // 否则正在运行的 turn 会向已删除的会话追加消息而失败。
          return asResult(name, async () => {
            await running.handle.promise?.catch(() => undefined);
            await deps.service.purgeSession(sessionId);
            return { sessionId, purged: true, cancelRequested: true };
          });
        }
        return asResult(name, () =>
          deps.service.purgeSession(sessionId).then(() => ({ sessionId, purged: true, cancelRequested: false })),
        );
      }
      case "harness.startRun": {
        let sessionId: string;
        try { sessionId = branchTarget(payload); }
        catch { return { ok: false, error: { code: "invalid_branch", message: "分支不属于此会话" } }; }
        const requestId = String(payload.requestId ?? "");
        const text = String(payload.text ?? "");
        if (!requestId.trim() || requestId.length > 128) return { ok: false, error: { code: "invalid_request", message: "requestId 非法" } };
        // 快速失败：会话不存在时直接拒绝，不让 UI 空转轮询（P4-2 桥接验收修正）。
        const existing = await deps.service.getSession(sessionId);
        if (!existing) return { ok: false, error: { code: "session_not_found", message: `会话不存在: ${sessionId}` } };
        if (deps.interactions?.pendingForSession(sessionId)) return { ok: false, error: { code: "waiting_input", message: "请先回答或取消本轮提问" } };
        // v2.16 §11.3：档位只能由用户/可信 UI 选择；未知值在入列前拒绝，模型无此通道。
        let budgetTier: BudgetTier | undefined;
        if (payload.budgetTier !== undefined && payload.budgetTier !== null) {
          const checked = validateBudgetTier(payload.budgetTier);
          if (!checked.ok) return { ok: false, error: { code: "invalid_budget_tier", message: checked.reason } };
          budgetTier = checked.tier;
        } else {
          budgetTier = existing.budgetTier;
        }
        return asResult(name, () => launchTurn(sessionId, requestId, "send", text, budgetTier));
      }
      case "harness.continueRun": {
        // v2.4 §11.1：续答上一未完成轮次（不追加用户消息；工具经幂等不重复执行）。
        let sessionId: string;
        try { sessionId = branchTarget(payload); }
        catch { return { ok: false, error: { code: "invalid_branch", message: "分支不属于此会话" } }; }
        const requestId = String(payload.requestId ?? "");
        if (!requestId.trim() || requestId.length > 128) return { ok: false, error: { code: "invalid_request", message: "requestId 非法" } };
        const existing = await deps.service.getSession(sessionId);
        if (!existing) return { ok: false, error: { code: "session_not_found", message: `会话不存在: ${sessionId}` } };
        if (deps.interactions?.pendingForSession(sessionId)) return { ok: false, error: { code: "waiting_input", message: "请先回答或取消本轮提问" } };
        // v2.16 §11.3：未显式指定档位时沿用会话最近一次 Run 的档位（其次会话默认）。
        let budgetTier: BudgetTier | undefined;
        if (payload.budgetTier !== undefined && payload.budgetTier !== null) {
          const checked = validateBudgetTier(payload.budgetTier);
          if (!checked.ok) return { ok: false, error: { code: "invalid_budget_tier", message: checked.reason } };
          budgetTier = checked.tier;
        } else {
          budgetTier = deps.service.lastRunBudgetTier(sessionId) ?? existing.budgetTier;
        }
        return asResult(name, () => launchTurn(sessionId, requestId, "continue", undefined, budgetTier));
      }
      case "harness.setBudgetTier":
        return asResult(name, () => deps.service.setBudgetTier(branchTarget(payload), payload.tier));
      case "harness.getRunStatus": {
        const runId = String(payload.runId ?? "");
        const handle = runs.get(runId);
        const record = deps.runStore?.get(runId) ?? null;
        // v2.4：内存未命中时从 runs 行兜底（进程重启语义）——result_json 反序列化返回。
        let fallbackResult: unknown;
        if (!handle && record?.resultJson) {
          try { fallbackResult = JSON.parse(record.resultJson); } catch { fallbackResult = undefined; }
        }
        const pending = deps.interactions?.pendingForRun(runId);
        const waiting = Boolean(pending && (!pending.submissionId || !handle || handle.result?.status === "waiting_input"));
        const orphaned = !waiting && !handle && record?.status === "active";
        if (orphaned) {
          fallbackResult = {
            status: "error", runId, continuable: true,
            error: { code: "run_interrupted", message: "上次运行已中断，可从会话继续。" },
          };
        }
        const sessionId = handle?.sessionId ?? record?.sessionId;
        const toolCalls = deps.runStore?.listToolCalls(runId) ?? [];
        const executedToolCalls = toolCalls.filter((call) => call.executionStatus === "executed").length;
        const resultBudget = handle?.result?.budget ?? (fallbackResult as AgentTurnResult | undefined)?.budget;
        return { ok: true, data: {
          runId,
          sessionId,
          // run 行可能已被彻底删除（purge）：内存 handle 已有终态结果时按结果回显，
          // 否则轮询方会一直看到 active。
          pendingQuestion: waiting ? pendingQuestionDto(pending) : undefined,
          plan: deps.interactions?.plan(runId),
          status: waiting ? "waiting_input" : orphaned ? "interrupted" : record?.status ?? (handle ? (handle.result ? runStatusOf(handle.result) : "active") : "not_found"),
          phase: orphaned ? "interrupted" : record?.phase,
          iteration: record?.iteration,
          result: handle?.result ?? fallbackResult,
          finishReason: record?.finishReason ?? handle?.result?.finishReason,
          // v2.5 §5.2：真实/估算用量与上下文预算；UI 必须按 estimated 标注。
          usage: record?.usage ?? handle?.result?.usage,
          context: handle?.result?.context ?? handle?.context,
          compactionCount: sessionId ? (deps.compactions?.count(sessionId) ?? 0) : 0,
          // v2.16 §11.3：本 Run 固定档位与预算（终态结果优先；运行中按已执行调用回显）。
          budgetTier: record?.budgetTier ?? handle?.budget?.tier,
          budget: resultBudget ?? (handle?.budget ? { ...handle.budget, usedToolCalls: executedToolCalls } : undefined),
          toolCalls,
        } };
      }
      case "harness.cancelRun": {
        const runId = String(payload.runId ?? "");
        const handle = runs.get(runId);
        if (handle && !handle.result) handle.controller.abort();
        else if (deps.interactions?.pendingForRun(runId)) {
          deps.interactions.closeRun(runId);
          const result: AgentTurnResult = { status: "error", error: { code: "cancelled", message: "用户取消" }, runId, finishReason: "cancelled" };
          deps.runStore?.finish(runId, "cancelled", "interrupted", JSON.stringify(result), "用户取消", "cancelled");
          if (handle) handle.result = result;
        }
        return { ok: true, data: { runId, cancelRequested: true } };
      }
      case "harness.importSnapshot":
        if (!deps.syncService) return { ok: false, error: { code: "not_available", message: "SyncService 未装配" } };
        return asResult(name, () => deps.syncService?.importSnapshot(payload));
      case "harness.stats":
        if (!deps.statisticsEngine) return { ok: false, error: { code: "not_available", message: "StatisticsEngine 未装配" } };
        return asResult(name, () =>
          deps.statisticsEngine?.getStats({
            filter: (payload.filter ?? {}) as never,
            scope: { notebookIds: [] },
            statsTime: typeof payload.statsTime === "string" ? payload.statsTime : undefined,
            timezone: typeof payload.timezone === "string" ? payload.timezone : undefined,
          }),
        );
      case "harness.exportSession": {
        // v2.4 §13.1：用户可读导出（Markdown）。不含密钥/审计参数/工具 JSON；引用已标题化。
        const format = payload.format === "markdown" ? "markdown" : null;
        if (!format) return { ok: false, error: { code: "invalid_args", message: "仅支持 format: markdown" } };
        return asResult(name, () =>
          deps.service.exportSessionMarkdown(branchTarget(payload)).then((r) => ({
            format,
            filename: `cardlink-会话-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.md`,
            markdown: r.markdown,
          })),
        );
      }
      case "harness.resolveRecordTitles": {
        // v2.4 §10.1.1：展示层标题解析——重开会话时把持久化的 recordId 引用映射为真实卡片标题。
        // 只读投影查询；返回值不含题目正文/OCR（仅标题/分类/等级元数据）。
        const rawIds = Array.isArray(payload.recordIds) ? payload.recordIds : [];
        const ids = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 200))].slice(0, 50);
        return asResult(name, async () => {
          const titles: Record<string, { available: boolean; title?: string; notebookTitle?: string; level?: number | null }> = {};
          for (const id of ids) {
            const record = await deps.repository.getById(id, { notebookIds: [] });
            titles[id] = record
              ? { available: true, title: record.sourceTitle, notebookTitle: record.sourceNotebookTitle, level: record.level ?? null }
              : { available: false };
          }
          return titles;
        });
      }
      case "harness.getEvidence": {
        // 证据表（§7）：按 evidenceId 回溯工具结果证据行 + 完整工具结果（证据详情页数据源）。
        const evidenceId = String(payload.evidenceId ?? "");
        if (!evidenceId.trim() || evidenceId.length > 256) {
          return { ok: false, error: { code: "invalid_args", message: "evidenceId 非法" } };
        }
        if (!deps.evidenceStore) return { ok: false, error: { code: "not_available", message: "EvidenceStore 未装配" } };
        const row = deps.evidenceStore.get(evidenceId);
        if (!row) return { ok: false, error: { code: "not_found", message: `证据不存在: ${evidenceId}` } };
        if (typeof payload.sessionId === "string") {
          let session;
          try { session = await deps.service.getSession(branchTarget(payload)); } catch { /* invalid branch */ }
          const visible = session && !session.deletedAt && session.messages.some((item) =>
            item.type === "tool_result" && item.toolCallId === row.sourceRef &&
            deps.runStore?.getToolCall(session.sharedMessageOwners?.[item.id] ?? session.id, item.toolCallId)?.runId === row.runId);
          if (!visible) return { ok: false, error: { code: "not_found", message: "当前分支无此证据" } };
        }
        // 关联 tool_calls（runId + toolCallId 定位）取完整结果包络——证据详情页数据源。
        let envelope: unknown = null;
        let toolName: string | undefined;
        try {
          const call = deps.runStore?.listToolCalls(row.runId).find((c) => c.toolCallId === row.sourceRef) ?? null;
          if (call?.executionStatus === "executed" && call.resultJson) {
            const result = JSON.parse(call.resultJson) as ToolEnvelope;
            const hash = row.resultHash.length === 16 ? stableHashHex : sha256Hex;
            if (result?.ok && result.evidence?.snapshotId === row.snapshotId && hash(canonicalJson(result)) === row.resultHash) {
              toolName = call.toolName;
              envelope = result;
            }
          }
        } catch { /* 解析失败时仅返回证据行,不伪造内容 */ }
        return { ok: true, data: { ...row, toolName, envelope } };
      }
      case "harness.getDataFreshness": {
        // v2.16 §6.3：设备侧由插件拦截并携带当前本地源指纹；此处的桌面/HTTP 运行时
        // 没有本地 CardLink 源，只能如实返回 unknown（不把"最新快照存在"当作未变化）。
        const meta = await deps.repository.getLatestSnapshotMeta();
        const baseline = deps.sourceBaseline?.get("cardlink-plugin") ?? null;
        const judgement = judgeFreshness({ baseline, latestSnapshotId: meta?.snapshotId ?? "none" });
        return { ok: true, data: {
          status: judgement.status,
          ...(judgement.reason ? { reason: judgement.reason } : {}),
          snapshotId: meta?.snapshotId ?? "none",
          ...(meta?.dataAsOf ? { dataAsOf: meta.dataAsOf } : {}),
          baselineSnapshotId: baseline?.snapshotId,
          baselineFingerprintAt: baseline?.updatedAt,
          checkedAt: new Date().toISOString(),
          answerChanges: "not_tracked",
          answerChangesNote: "答案卡片正文的修改没有轻量本地信号；如需最新答案文本，请同步快照。",
        } };
      }
      case "harness.listModelProviders":
        if (!deps.providers) return { ok: false, error: { code: "not_available", message: "ProviderConfigStore 未装配" } };
        return asResult(name, () => deps.providers?.list());
      case "harness.getModelSettings": {
        const { providers, credentials, roles } = deps;
        if (!providers || !credentials || !roles) return { ok: false, error: { code: "not_available", message: "模型设置未装配" } };
        return asResult(name, () => {
          const refs = new Set(credentials.refs?.() ?? []);
          const assistant = roles.get("assistant");
          const reviewer = roles.get("reviewer");
          return {
            connections: providers.list().map((config) => ({
              ...config, keySet: refs.has(config.credentialRef),
              authorizedRoles: (["assistant", "reviewer"] as const).filter((role) => roles.isAuthorized(role, config.id)),
            })),
            assistant, reviewer,
            assistantVerification: assistant ? credentials.getVerification(assistant.credentialRef, assistant.model) : null,
            reviewerVerification: reviewer ? credentials.getVerification(reviewer.credentialRef, reviewer.model) : null,
          };
        });
      }
      case "harness.setSessionModel": {
        const { providers, credentials, roles } = deps;
        if (!providers || !credentials || !roles) return { ok: false, error: { code: "not_available", message: "模型设置未装配" } };
        return asResult(name, async () => {
          const sessionId = branchTarget(payload);
          const providerId = typeof payload.providerId === "string" ? payload.providerId : "";
          const model = typeof payload.model === "string" ? payload.model.trim() : "";
          const provider = providers.get(providerId);
          if (!provider?.enabled || provider.protocol !== "openai-compatible" || !roles.isAuthorized("assistant", providerId)) {
            throw new Error("请先在 AI 分析设置中授权该助手连接");
          }
          if (!credentials.resolve(provider.credentialRef)) throw new Error("请先保存此连接的 API Key");
          if (!model || model.length > 256 || /[\x00-\x1f\x7f]/.test(model)) throw new Error("模型名称无效");
          const current = (await deps.service.getSession(sessionId))?.assistantModel;
          const currentDefault = roles.get("assistant");
          const matched = [current, currentDefault].find((item) => item?.providerId === providerId && item.model === model);
          const availableEfforts = supportedReasoningEfforts(provider, model);
          const effort = availableEfforts.find((item) => item === payload.effort);
          if (payload.effort !== undefined && !effort) throw new Error("此模型不支持所选推理强度");
          const setting = await deps.service.setAssistantModel(sessionId, {
            ...(matched ?? { providerId, model, credentialRef: provider.credentialRef, timeoutMs: 60000, maxOutputTokens: 16384 }),
            ...(effort ? { effort } : {}),
          });
          return { ...setting, availableEfforts };
        });
      }
      case "harness.saveModelConnection": {
        const { providers, credentials } = deps;
        if (!providers || !credentials) return { ok: false, error: { code: "not_available", message: "模型连接未装配" } };
        return asResult(name, () => {
          const baseUrl = typeof payload.baseUrl === "string" ? payload.baseUrl.trim().replace(/\/+$/, "") : "";
          const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
          if (baseUrl.length > 512 || !/^https:\/\/[^/?#@\s\\]+(?:\/[^?#\s\\]*)?$/.test(baseUrl)) {
            throw new Error("接口地址必须是有效的 HTTPS Base URL");
          }
          if (apiKey.length > 4096) throw new Error("API Key 超过允许长度");
          const currentId = typeof payload.connectionId === "string" ? payload.connectionId : "";
          const current = providers.get(currentId);
          if (currentId && !current) throw new Error("连接已不存在，请刷新设置");
          if (current?.baseUrl.replace(/\/+$/, "") === baseUrl && current.protocol === "openai-compatible") {
            if (apiKey) credentials.set(current.credentialRef, apiKey);
            if (!credentials.resolve(current.credentialRef)) throw new Error("请填写这个连接的 API Key");
            return { connection: { ...current, keySet: true } };
          }
          if (!apiKey) throw new Error("新连接需要单独填写 API Key");
          const id = `connection-${randomUUID()}`;
          const connection: ModelProviderConfig = { id, protocol: "openai-compatible", baseUrl, credentialRef: id, enabled: true };
          credentials.set(id, apiKey);
          try {
            providers.upsert(connection);
          } catch (error) {
            credentials.clear(id);
            throw error;
          }
          return { connection: { ...connection, keySet: true } };
        });
      }
      case "harness.activateModelRoles": {
        const { providers, credentials, roles } = deps;
        if (!providers || !credentials || !roles) return { ok: false, error: { code: "not_available", message: "模型设置未装配" } };
        return asResult(name, () => {
          const readRole = (raw: unknown, role: RoleName): ModelRoleSetting => {
            const entry = (raw ?? {}) as Record<string, unknown>;
            const providerId = typeof entry.providerId === "string" ? entry.providerId : "";
            const model = typeof entry.model === "string" ? entry.model.trim() : "";
            const config = providers.get(providerId);
            if (!config?.enabled || config.protocol !== "openai-compatible") throw new Error("请选择已启用的兼容连接");
            if (!credentials.resolve(config.credentialRef)) throw new Error("请先保存该连接的 API Key");
            if (!model || model.length > 256 || /[\x00-\x1f\x7f]/.test(model)) throw new Error("模型名称无效");
            const maxOutputTokens = role === "reviewer" ? 1024 : Number(entry.maxOutputTokens ?? 16384);
            if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 131072) throw new Error("最大输出 Token 无效");
            const previous = roles.get(role);
            if (!roles.isAuthorized(role, providerId) && entry.authorized !== true) {
              throw new Error(role === "assistant" ? "请授权助手连接接收错题数据" : "请授权审核连接接收错题数据");
            }
            return {
              providerId, model, credentialRef: config.credentialRef, timeoutMs: 60000, maxOutputTokens,
              ...(previous && previous.providerId === providerId && previous.model === model && previous.effort ? { effort: previous.effort } : {}),
            };
          };
          const assistant = readRole(payload.assistant, "assistant");
          const reviewerInput = (payload.reviewer ?? {}) as Record<string, unknown>;
          const followsAssistant = reviewerInput.followsAssistant === true;
          const reviewer = readRole(
            followsAssistant ? { providerId: assistant.providerId, model: assistant.model, authorized: reviewerInput.authorized } : reviewerInput,
            "reviewer",
          );
          const settings = { assistant, reviewer: { ...reviewer, followsAssistant } };
          roles.activate(settings);
          return {
            ...settings,
            assistantVerification: credentials.getVerification(assistant.credentialRef, assistant.model),
            reviewerVerification: credentials.getVerification(reviewer.credentialRef, reviewer.model),
          };
        });
      }
      case "harness.listProviderModels": {
        // v2.3 §5.1.6：只接收 providerId；URL、凭据、协议均取自已保存配置，不回传密钥。
        if (!deps.providers || !deps.credentials) {
          return { ok: false, error: { code: "not_available", message: "Provider 能力未装配" } };
        }
        const providerId = String(payload.providerId ?? "");
        const config = deps.providers.get(providerId);
        if (!config) return { ok: false, error: { code: "provider_not_found", message: `provider_not_found: ${providerId}` } };
        if (!config.enabled) return { ok: false, error: { code: "provider_disabled", message: `provider_disabled: ${providerId}` } };
        if (config.protocol !== "openai-compatible") {
          return { ok: false, error: { code: "unsupported_protocol", message: `unsupported_protocol: ${config.protocol}` } };
        }
        const apiKey = deps.credentials.resolve(config.credentialRef);
        if (apiKey === undefined) {
          return { ok: false, error: { code: "credential_missing", message: `credential_missing: ${config.credentialRef}` } };
        }
        try {
          const catalog = deps.modelCatalog
            ? await deps.modelCatalog(config, apiKey)
            : await fetchProviderModels({ baseUrl: config.baseUrl, apiKey, provider: config.id });
          return {
            ok: true,
            data: {
              providerId: config.id,
              models: catalog.models,
              fetchedAt: catalog.fetchedAt,
              source: catalog.source,
            },
          };
        } catch (error) {
          // 目录错误码由适配器以 `code: 说明` 形式抛出；解析回结构化 code 供 UI 分支。
          const raw = error instanceof Error ? error.message : String(error);
          const message = raw.split(apiKey).join("[已隐藏]").slice(0, 400);
          const code = /^([a-z_]+):/.exec(message)?.[1] ?? "model_catalog_failed";
          return { ok: false, error: { code, message } };
        }
      }
      case "harness.setProviderConfig":
        if (!deps.providers) return { ok: false, error: { code: "not_available", message: "ProviderConfigStore 未装配" } };
        return asResult(name, () => {
          const checked = validateProviderConfig(payload.config);
          if (!checked.ok) throw new Error(checked.reason);
          const previous = deps.providers?.get(checked.value.id);
          if (previous && (previous.baseUrl !== checked.value.baseUrl || previous.credentialRef !== checked.value.credentialRef || previous.protocol !== checked.value.protocol)) {
            throw new Error("接口地址、协议或密钥引用变更时请新建连接");
          }
          deps.providers?.upsert(checked.value);
          return { id: checked.value.id };
        });
      case "harness.setCredential":
        if (!deps.credentials) return { ok: false, error: { code: "not_available", message: "ModelCredentialStore 未装配" } };
        return asResult(name, () => {
          const ref = String(payload.credentialRef ?? "");
          const apiKey = String(payload.apiKey ?? "");
          if (!ref || !apiKey) throw new Error("credentialRef/apiKey 缺失");
          deps.credentials?.set(ref, apiKey);
          return { credentialRef: ref, set: true };
        });
      case "harness.setModelRoleConfig":
        if (!deps.roles) return { ok: false, error: { code: "not_available", message: "RoleConfigStore 未装配" } };
        return asResult(name, () => {
          const role = payload.role as RoleName;
          if (role !== "assistant" && role !== "reviewer") throw new Error("role 必须是 assistant/reviewer");
          const setting: ModelRoleSetting = {
            providerId: String(payload.providerId ?? ""),
            model: String(payload.model ?? ""),
            credentialRef: String(payload.credentialRef ?? ""),
            timeoutMs: Number(payload.timeoutMs ?? 30000),
            // v2.5：助手默认 16,384（受模型能力上限约束）；Reviewer 保持 1,024 避免无谓成本。
            maxOutputTokens: Number(payload.maxOutputTokens ?? (role === "assistant" ? 16384 : 1024)),
          };
          if (!setting.providerId || !setting.model || !setting.credentialRef) throw new Error("providerId/model/credentialRef 缺失");
          deps.roles?.set(role, setting);
          return { role, setting };
        });
      case "harness.clearCredential":
        if (!deps.credentials) return { ok: false, error: { code: "not_available", message: "Credential 能力未装配" } };
        {
          const ref = String(payload.credentialRef ?? "");
          if (!ref.trim() || ref.length > 128) return { ok: false, error: { code: "invalid_args", message: "credentialRef 非法" } };
          deps.credentials?.clear(ref);
          return { ok: true, data: { credentialRef: ref, cleared: true } };
        }
      case "harness.setReviewLevel":
        // v2.2 §10.1：设置会话审核档位；作用于下一轮。档位非法/会话不存在由 service 抛错转结构化错误。
        return asResult(name, () => deps.service.setReviewLevel(branchTarget(payload), payload.level));
      case "harness.getModelCapabilities": {
        // v2.5 §5.2：返回生效能力（用户覆盖 > 已验证预置 > 保守默认）与校准系数。
        const providerId = String(payload.providerId ?? "");
        const model = String(payload.model ?? "");
        if (!model.trim()) return { ok: false, error: { code: "invalid_args", message: "model 缺失" } };
        const resolved = deps.capabilities?.resolve(providerId, model) ?? {
          capabilities: defaultCapabilities(providerId || "unknown", model),
          calibrationRatio: undefined,
        };
        return { ok: true, data: resolved };
      }
      case "harness.setModelCapabilities":
        // v2.5 §5.2：用户覆盖上下文窗口/输出上限（source='user'）。
        if (!deps.capabilities) return { ok: false, error: { code: "not_available", message: "模型能力登记未装配" } };
        return asResult(name, () =>
          deps.capabilities?.setUserOverride({
            providerId: payload.providerId,
            modelId: payload.modelId ?? payload.model,
            contextWindowTokens: payload.contextWindowTokens,
            maxOutputTokens: payload.maxOutputTokens,
            supportsToolCalls: payload.supportsToolCalls,
            supportsUsage: payload.supportsUsage,
          }),
        );
      case "harness.getContextInsights": {
        // v2.14 §22：只读查询——会话内 Assistant 请求的输入分项、用量来源与费用估算。
        // 不含 prompt/工具正文；分页与近期窗口均有界（limit ≤ 50、offset ≤ 500、days ≤ 30）。
        if (!deps.telemetry) return { ok: false, error: { code: "not_available", message: "请求遥测未装配" } };
        let sessionId: string;
        try { sessionId = branchTarget(payload); }
        catch { return { ok: false, error: { code: "invalid_branch", message: "分支不属于此会话" } }; }
        if (!sessionId.trim() || sessionId.length > 200) {
          return { ok: false, error: { code: "invalid_args", message: "sessionId 非法" } };
        }
        const session = await deps.service.getSession(sessionId);
        if (!session) return { ok: false, error: { code: "not_found", message: `会话不存在: ${sessionId}` } };
        return asResult(name, () =>
          deps.telemetry!.sessionInsights(sessionId, {
            limit: Number(payload.limit ?? 20),
            offset: Number(payload.offset ?? 0),
            days: Number(payload.days ?? 7),
          }),
        );
      }
      case "harness.getModelRate": {
        // v2.14 §22：读取当前 providerId+model 的手动费率（与密钥无关）。
        if (!deps.telemetry) return { ok: false, error: { code: "not_available", message: "费率存储未装配" } };
        const providerId = String(payload.providerId ?? "");
        const model = String(payload.model ?? "");
        if (!providerId.trim() || !model.trim()) {
          return { ok: false, error: { code: "invalid_args", message: "providerId/model 缺失" } };
        }
        return { ok: true, data: { providerId, model, rate: deps.telemetry.getRate(providerId, model) } };
      }
      case "harness.setModelRate": {
        // v2.14 §22：用户手动维护的本地费率（币种 + 每百万输入/输出 token）。
        if (!deps.telemetry) return { ok: false, error: { code: "not_available", message: "费率存储未装配" } };
        try {
          const rate = deps.telemetry.setRate({
            providerId: payload.providerId,
            model: payload.model,
            currency: payload.currency,
            inputPerMillion: payload.inputPerMillion,
            outputPerMillion: payload.outputPerMillion,
          });
          return { ok: true, data: rate };
        } catch (error) {
          return { ok: false, error: { code: "invalid_args", message: (error instanceof Error ? error.message : String(error)).slice(0, 300) } };
        }
      }
      case "harness.clearModelRate": {
        if (!deps.telemetry) return { ok: false, error: { code: "not_available", message: "费率存储未装配" } };
        const providerId = String(payload.providerId ?? "");
        const model = String(payload.model ?? "");
        if (!providerId.trim() || !model.trim()) {
          return { ok: false, error: { code: "invalid_args", message: "providerId/model 缺失" } };
        }
        return { ok: true, data: { providerId, model, cleared: deps.telemetry.clearRate(providerId, model) } };
      }
      case "harness.listModelRates": {
        if (!deps.telemetry) return { ok: false, error: { code: "not_available", message: "费率存储未装配" } };
        const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 50)));
        return { ok: true, data: deps.telemetry.listRates(limit) };
      }
      case "harness.testModelProvider":
        if (!deps.providers || !deps.credentials) return { ok: false, error: { code: "not_available", message: "Provider 能力未装配" } };
        return asResult(name, async () => {
          const providerId = String(payload.providerId ?? "");
          const role: RoleName = payload.role === "reviewer" ? "reviewer" : "assistant";
          const config = deps.providers?.get(providerId);
          if (!config) throw new Error(`provider_not_found: ${providerId}`);
          if (!config.enabled) throw new Error(`provider_disabled: ${providerId}`);
          const apiKey = deps.credentials?.resolve(config.credentialRef);
          if (apiKey === undefined) throw new Error(`credential_missing: ${config.credentialRef}`);
          if (config.protocol !== "openai-compatible") throw new Error(`unsupported_protocol: ${config.protocol}`);
          // 模型名优先级：UI 显式传入 > 角色已保存配置；都没有 → 显式报错（绝不拿占位名去请求，b8 修正）。
          const roleSetting = deps.roles?.get(role) ?? null;
          const model = String(payload.model ?? roleSetting?.model ?? "").trim();
          if (!model || model.length > 256 || /[\x00-\x1f\x7f]/.test(model)) throw new Error("model_missing: 请填写有效模型名后再测试");
          const revision = deps.credentials?.revision(config.credentialRef);
          const effort = roleSetting?.providerId === providerId && roleSetting.model === model ? roleSetting.effort ?? "low" : "low";
          // 最小探测：无错题敏感信息的往返（§5.1.4.1）。设备走注入的协议工厂（ocrHTTP 传输）。
          const client = deps.createProtocolClient
            ? deps.createProtocolClient(config, apiKey)
            : new (await import("../model/provider-client.ts")).OpenAiCompatibleModelClient({ baseUrl: config.baseUrl, apiKey, provider: config.id });
          const reply = await client.generate(
            {
              instruction: "连通性探测：只回复 JSON {\"ok\":true}。",
              tools: [],
              messages: [{ type: "user", id: "probe", text: "ping", createdAt: new Date().toISOString() }],
              outputType: {
                name: "probe",
                jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
                parse: (raw: unknown) => {
                  const o = raw as { ok?: unknown };
                  if (typeof o?.ok !== "boolean") throw new Error("探测响应缺少 ok 布尔");
                  return { ok: o.ok };
                },
              },
            },
            { provider: config.id, model, effort, timeoutMs: 20000, maxOutputTokens: 32, providerId, credentialRef: config.credentialRef },
          ).catch((error: unknown) => {
            if (revision) deps.credentials?.recordVerification(config.credentialRef, revision, model, false);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(message.split(apiKey).join("[已隐藏]"));
          });
          const reachable = reply.ok === true;
          if (revision) deps.credentials?.recordVerification(config.credentialRef, revision, model, reachable);
          return { providerId: config.id, model, reachable };
        });
      default:
        return { ok: false, error: { code: "unknown_command", message: `未知命令: ${name}` } };
    }
  };
}
