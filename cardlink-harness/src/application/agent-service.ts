import { newToolResult, validateUserText, newUserMessage, type ToolResult, type AssistantMessage } from "../domain/message.ts";
import { extractRecordIdCandidates } from "../domain/mistake.ts";
import type { Session, SessionId, SessionScope } from "../domain/session.ts";
import { newSessionId, validateReviewLevel, validateSessionScope, validateSessionTitle } from "../domain/session.ts";
import { classifyModelError, type FinishReason } from "../domain/finish-reason.ts";
import type { ModelClient } from "./ports/model-client.ts";
import { requestModel } from "./ports/model-client.ts";
import type { SessionStore } from "./ports/session-store.ts";
import {
  isTransactionalAuditLog,
  newAuditId,
  summarizeArgs,
  type AuditLog,
  type ToolAudit,
  type TransactionalAuditLog,
} from "./ports/audit-log.ts";
import type { MistakeRepository, SnapshotMeta } from "./ports/mistake-repository.ts";
import type { EvidenceStore, EvidenceRow } from "./ports/evidence-store.ts";
import { newEvidenceId } from "./ports/evidence-store.ts";
import type { RunStore, RunPhase, RunStatus } from "./ports/run-store.ts";
import type { RoleConfigStore } from "./ports/role-config-store.ts";
import type { ModelSetting } from "../domain/model-setting.ts";
import { parsePublicOutcome, PUBLIC_INTERACTION_INSTRUCTION, readableAnswers, type InteractionStore, type PendingQuestion } from "./public-interaction.ts";
import type { BranchOperation, SessionBranchView } from "./ports/session-store.ts";
import type { ModelRoleSetting } from "../domain/provider.ts";
import type { AssistantRole } from "./assistant-role.ts";
import type { ReviewerRole } from "./reviewer-role.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import type { ToolExecutor } from "./tool-executor.ts";
import type { EvidenceValidator, EvidenceCheck } from "./evidence-validator.ts";
import type { CitationResolver, Citation } from "./citation-resolver.ts";
import type { EvidenceWarningCode, ToolEnvelope, TurnEvidence } from "../domain/evidence.ts";
import { statisticEvidenceInstruction, supportsStatisticEvidence } from "./statistic-evidence.ts";
import { canonicalJson, stableHashHex } from "../domain/canonical.ts";
import { randomUUID } from "../platform/uuid.ts";
import { sha256Hex } from "../platform/sha256.ts";
import { defaultCapabilities, type ContextPlan } from "../domain/model-capabilities.ts";
import { addUsage, makeUsage, type TokenUsage } from "../domain/token-usage.ts";
import { compactionTriggerTokens } from "./context-budget.ts";
import { DEFAULT_TOKEN_ESTIMATOR } from "./token-estimator.ts";
import type { ModelCapabilitiesRegistry } from "./model-capabilities-registry.ts";
import type { CompactionService } from "./compaction-service.ts";
import type { CompactionRecord } from "./ports/compaction-store.ts";
import type { AssistantBudget } from "./context-builder.ts";
import type { RequestTelemetryService } from "./request-telemetry-service.ts";
import { EMPTY_BREAKDOWN } from "../domain/request-telemetry.ts";
import {
  BUDGET_TIERS,
  legacyRunBudget,
  resolveRunBudget,
  validateBudgetTier,
  type BudgetCaps,
  type BudgetTier,
  type RunBudget,
} from "../domain/run-budget.ts";
import {
  collectSessionRecordIds,
  effectiveReviewLevel,
  provenanceHitOf,
  shouldReview,
  summarizeCallChain,
  type ReviewChainContext,
} from "./review-policy.ts";

export type AgentTurnResult = {
  status: "completed" | "limit_reached" | "error" | "waiting_input";
  message?: string;
  evidenceRefs?: string[];
  warnings?: Array<{ code: EvidenceWarningCode; detail: string }>;
  error?: { code: string; message: string };
  runId?: string;
  /** v2.4 §11.1：轮次终止原因（status 为粗粒度兼容字段，finishReason 为权威语义）。 */
  finishReason?: FinishReason;
  /** v2.4 §11.1：true 时 UI 提供"继续生成"入口（continueRun）。 */
  continuable?: boolean;
  /** v2.4 §10.1.1：最终回答的引用 DTO（CardCitation/StatCitation，含真实标题）。 */
  citations?: Citation[];
  /** v2.4 §10.1.1：模型原始回答（含引用标记；随 turn_results/runs.result_json 持久化供审计）。 */
  rawText?: string;
  /** v2.5 §5.2：本轮 token 用量（服务商未返回时 estimated=true）。 */
  usage?: TokenUsage;
  /** v2.5 §5.2：本轮上下文预算与压缩情况（UI 显示"上下文已使用 X / Y token"）。 */
  context?: {
    inputBudgetTokens: number;
    estimatedInputTokens: number;
    /** 旧结果可能仍携带完整历史估算。 */
    estimatedFullTokens?: number;
    compactionTriggerTokens?: number;
    compactionStatus?: "none" | "reused" | "compacted" | "insufficient";
    outputBudgetTokens: number;
    reservedTokens: number;
    compactionCount: number;
  };
  /**
   * v2.16 §11.3：本 Run 固定的运行预算与已用工具数（UI/getRunStatus 回显）。
   * 旧结果/旧调用缺失该字段按未选档处理。
   */
  budget?: {
    tier?: BudgetTier;
    maxIterations: number;
    maxToolCalls: number;
    maxDurationMs: number;
    usedToolCalls: number;
  };
};

export type AgentServiceConfig = {
  /** 未选档旧调用的默认上限（与既有配置兼容）。 */
  maxIterations: number;
  maxToolCallsPerTurn: number;
  /** v2.16 §11.3：档位全局硬上限；缺省 12/24/1200000。 */
  hardLimits?: BudgetCaps;
};

export type SendMessageOptions = {
  /** v2.1 §10/§11：由桥接层生成的 runId；传入时启用 Run 检查点记录。 */
  runId?: string;
  /** Bridge acceptance-time snapshot, including null when it accepted against an empty repository. */
  snapshot?: SnapshotMeta;
  /** 协作取消：在迭代与工具调用之间检查；取消 → interrupted（RunPhase）+ status error/cancelled。 */
  cancelCheck?: () => boolean;
  signal?: AbortSignal;
  onContext?: (context: NonNullable<AgentTurnResult["context"]>) => void;
  /** v2.16 §11.3：本 Run 预算（由桥接层按用户档位解析后传入；缺省 = 未选档旧调用）。 */
  budget?: RunBudget;
  resumeQuestion?: PendingQuestion;
};

export type AgentServiceDeps = {
  store: SessionStore;
  model: ModelClient;
  assistant: AssistantRole;
  reviewer: ReviewerRole;
  guard: PolicyGuard;
  executor: ToolExecutor;
  evidenceValidator: EvidenceValidator;
  auditLog: AuditLog;
  repository: MistakeRepository;
  /** v2.1 §7：可选证据存储；提供时执行成功的工具结果落证据行（getEvidence 可回溯）。 */
  evidenceStore?: EvidenceStore;
  config: AgentServiceConfig;
  assistantSetting: ModelSetting;
  reviewerSetting: ModelSetting;
  /** v2.1 §11：可选 Run 检查点；未提供时仅保留会话消息与 turn_results 语义。 */
  runStore?: RunStore;
  /** P4-2（§5.1.5）：可选角色配置存储；提供时每次调用前解析，覆盖默认装配。 */
  roleConfigStore?: RoleConfigStore;
  interactions?: InteractionStore;
  /** v2.4 §10.1.1：可选引用解析器；提供时最终回答经协议解析/校验/重写后落库。 */
  citationResolver?: CitationResolver;
  /** v2.5 §5.2：可选模型能力登记；提供时按窗口计算 token 预算（未提供时走保守默认）。 */
  capabilities?: ModelCapabilitiesRegistry;
  /** v2.5 §11.1：可选压缩服务；提供时压缩记录持久化并可跨重启复用。 */
  compactions?: CompactionService;
  /**
   * v2.14 §22：可选请求用量遥测；提供时每个真实 Assistant 请求记录
   * runId + 请求序号、输入分项、预算摘要、用量来源、压缩关联与执行/计量状态。
   */
  telemetry?: RequestTelemetryService;
};

class Mutex {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/** §10 运行循环：每步有记录；每个 toolCallId 恰有一个终结 ToolResult。 */
export class AgentService {
  private readonly locks = new Map<SessionId, Mutex>();

  constructor(private readonly deps: AgentServiceDeps) {}

  /** v2.16 §11.3：档位全局硬上限（缺省规范默认值；管理员配置更小时以配置为准）。 */
  budgetCaps(): BudgetCaps {
    const hard = this.deps.config.hardLimits;
    return {
      maxIterations: Math.max(1, hard?.maxIterations ?? BUDGET_TIERS.deep.iterations),
      maxToolCalls: Math.max(1, hard?.maxToolCalls ?? BUDGET_TIERS.deep.toolCalls),
      maxDurationMs: Math.max(1_000, hard?.maxDurationMs ?? BUDGET_TIERS.deep.durationMs),
    };
  }

  /**
   * v2.16 §6.3/§11：继续生成沿用该会话最近一次 Run 锁定的快照。
   * - 未指定快照的新提问/首次续答 → 最新快照；
   * - 已有 Run：`none` 表示历史空快照（不使用最新）；快照元数据读不到时抛
   *   `snapshot_unavailable`，绝不回退到最新版本冒充原快照。
   */
  private async snapshotForTurn(
    sessionId: SessionId,
    continuation: boolean,
    explicit: SnapshotMeta | null | undefined,
  ): Promise<SnapshotMeta | null> {
    if (explicit !== undefined) return explicit;
    if (!continuation) return this.deps.repository.getLatestSnapshotMeta();
    const previous = this.deps.runStore?.latestBySession?.(sessionId) ?? null;
    if (!previous) return this.deps.repository.getLatestSnapshotMeta();
    if (previous.snapshotId === "none") return null;
    const pinned = this.deps.repository.forSnapshot?.(previous.snapshotId);
    if (!pinned) throw new Error(`snapshot_unavailable: 无法读取上次 Run 锁定的快照 ${previous.snapshotId}`);
    const meta = await pinned.getLatestSnapshotMeta();
    if (!meta) throw new Error(`snapshot_unavailable: 上次 Run 锁定的快照 ${previous.snapshotId} 已不可用`);
    return meta;
  }

  /** 用户/可信 UI 显式档位 → 生效预算（Run 入列时解析并固定）。 */
  resolveBudget(tier: BudgetTier): RunBudget {
    return resolveRunBudget(tier, this.budgetCaps());
  }

  /** 未选档旧调用：沿用管理员配置的默认上限（不套用档位默认值）。 */
  legacyBudget(): RunBudget {
    return legacyRunBudget({
      maxIterations: this.deps.config.maxIterations,
      maxToolCalls: this.deps.config.maxToolCallsPerTurn,
      maxDurationMs: this.budgetCaps().maxDurationMs,
    });
  }

  /** 会话最近一次 Run 的档位（续答未显式指定时沿用；不可得返回 undefined）。 */
  lastRunBudgetTier(sessionId: SessionId): BudgetTier | undefined {
    const tier = this.deps.runStore?.latestBySession?.(sessionId)?.budgetTier;
    return tier === "simple" || tier === "comparison" || tier === "deep" ? tier : undefined;
  }

  async createSession(scope: unknown): Promise<Session> {
    const checked = validateSessionScope(scope);
    if (!checked.ok) throw new Error(checked.reason);
    const now = new Date();
    const meta = await this.deps.repository.getLatestSnapshotMeta();
    const assistantModel = this.deps.roleConfigStore?.get("assistant");
    const session: Session = {
      ...(assistantModel ? { assistantModel } : {}),
      id: newSessionId(),
      messages: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      scope: checked.scope,
      snapshotId: meta?.snapshotId ?? "none",
      status: "active",
    };
    await this.deps.store.create(session);
    return session;
  }

  async listSessions(limit: number, cursor?: string): Promise<Session[]> {
    return this.deps.store.list(limit, cursor);
  }

  branchView(sessionId: string, branchId?: string): SessionBranchView {
    if (this.deps.store.branchView) return this.deps.store.branchView(sessionId, branchId);
    if (branchId && branchId !== sessionId) throw new Error("分支不可用");
    return { sessionId, branchId: sessionId, branches: [{ id: sessionId }] };
  }

  selectBranch(sessionId: string, branchId: string): SessionBranchView {
    if (!this.deps.store.selectBranch) throw new Error("当前会话存储不支持分支");
    return this.deps.store.selectBranch(sessionId, branchId);
  }

  forkSession(sessionId: string, fromId: string, anchorId: string, operation: BranchOperation, requestId: string): SessionBranchView {
    if (!this.deps.store.fork) throw new Error("当前会话存储不支持分支");
    return this.deps.store.fork(sessionId, fromId, anchorId, operation, requestId);
  }

  async getSession(id: SessionId): Promise<Session | null> {
    return this.deps.store.get(id);
  }

  /** 显式切换当前会话的助手；已有运行保持已经固定的设置。 */
  async setAssistantModel(sessionId: SessionId, setting: ModelRoleSetting): Promise<ModelRoleSetting> {
    const session = await this.deps.store.get(sessionId);
    if (!session || session.deletedAt) throw new Error("会话不可用");
    if (this.deps.runStore?.findActiveBySession(sessionId)) throw new Error("请等待本轮结束再切换模型");
    await this.deps.store.setAssistantModel(sessionId, setting);
    return setting;
  }

  /** v2.2 §10.1：审核档位从下一轮起生效。 */
  async setReviewLevel(sessionId: SessionId, level: unknown): Promise<{ sessionId: SessionId; reviewLevel: Session["reviewLevel"] }> {
    const checked = validateReviewLevel(level);
    if (!checked.ok) throw new Error(checked.reason);
    const session = await this.deps.store.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    await this.deps.store.setReviewLevel(sessionId, checked.level);
    return { sessionId, reviewLevel: checked.level };
  }

  /**
   * v2.16 §11.3：设置会话默认运行预算档位。只影响之后入列的 Run（运行中的 Run 固定原预算）。
   * 非法档位或会话不存在时抛错（桥接层转为结构化错误）。
   */
  async setBudgetTier(sessionId: SessionId, tier: unknown): Promise<{ sessionId: SessionId; budgetTier: BudgetTier }> {
    const checked = validateBudgetTier(tier);
    if (!checked.ok) throw new Error(checked.reason);
    const session = await this.deps.store.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    if (!this.deps.store.setBudgetTier) throw new Error("当前会话存储不支持预算档位");
    await this.deps.store.setBudgetTier(sessionId, checked.tier);
    return { sessionId, budgetTier: checked.tier };
  }

  async sendMessage(sessionId: SessionId, requestId: string, input: string, options: SendMessageOptions = {}): Promise<AgentTurnResult> {
    const mutex = this.locks.get(sessionId) ?? this.locks.set(sessionId, new Mutex()).get(sessionId) as Mutex;
    return mutex.run(() => this.turn(sessionId, requestId, input, options, false));
  }

  /**
   * v2.4 §11.1：继续生成——复用同一会话发起新 Run，不追加用户消息。
   * 已有终结结果的工具经 argsHash/终结结果幂等复用，不重复执行；悬空调用走恢复路径。
   */
  async continueTurn(sessionId: SessionId, requestId: string, options: SendMessageOptions = {}): Promise<AgentTurnResult> {
    const mutex = this.locks.get(sessionId) ?? this.locks.set(sessionId, new Mutex()).get(sessionId) as Mutex;
    return mutex.run(() => this.turn(sessionId, requestId, null, options, true));
  }

  /** v2.4 §13.1：会话摘要列表（不加载消息体）；query 非空时按标题/首条用户消息匹配。 */
  async listSessionSummaries(limit: number, query?: string) {
    return this.deps.store.listSummaries(Math.max(1, Math.min(200, Math.floor(limit))), query);
  }

  /** v2.4 §13.1：重命名会话（标题校验 1..128 字符）。 */
  async renameSession(sessionId: SessionId, title: unknown): Promise<Session> {
    const checked = validateSessionTitle(title);
    if (!checked.ok) throw new Error(checked.reason);
    const session = await this.deps.store.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    await this.deps.store.rename(sessionId, checked.title);
    return (await this.deps.store.get(sessionId)) as Session;
  }

  /** v2.4 §13.1：软删除会话（幂等；消息/运行/审计/证据行保留）。已删除会话静默成功。 */
  async deleteSession(sessionId: SessionId): Promise<void> {
    const session = await this.deps.store.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    await this.deps.store.softDelete(sessionId);
  }

  /**
   * v2.4 §13.1 补强：彻底删除会话——物理清除消息、运行、工具调用、审计与证据行。
   * 与软删除互为补充：软删除仍可审计回溯，彻底删除不可恢复（UI 需二次确认）。
   * 会话不存在时同样视为成功（幂等）。
   */
  async purgeSession(sessionId: SessionId): Promise<void> {
    await this.deps.store.purge(sessionId);
  }

  /**
   * v2.4 §13.1：会话导出为用户可读 Markdown（BRIDGE-03）。
   * - 引用链接重写为纯标题（card:/stat: 与标记全部剔除）；
   * - 已知标题的裸 recordId 一并标题化（旧会话兼容；无标题的 ID 保留原串——它是唯一可读指代）；
   * - 不导出工具结果 JSON、审计参数与密钥（工具明细以引用/来源清单承载）。
   */
  async exportSessionMarkdown(sessionId: SessionId): Promise<{ title: string; markdown: string }> {
    const session = await this.deps.store.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);

    // 收集正文中出现的 recordId（含 card: 链接 payload 与旧式裸 ID），解析真实标题。
    const ids = new Set<string>();
    for (const message of session.messages) {
      if (message.type !== "assistant") continue;
      for (const match of message.text.matchAll(/\]\(card:([^)]+)\)/g)) ids.add(match[1]);
      for (const candidate of extractRecordIdCandidates(message.text)) ids.add(candidate);
    }
    const titleMap = new Map<string, string>();
    for (const id of ids) {
      const record = await this.deps.repository.getById(id, { notebookIds: [] });
      if (record?.sourceTitle) titleMap.set(id, record.sourceTitle);
    }
    const clean = (text: string): string =>
      text
        .replace(/\[(《[^》]*》|[^\]]+)\]\(card:[^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\(stat:[^)]+\)/g, "（统计来源）")
        .replace(/\{\{(?:card|stat):ref_\d+\|[^}]+\}\}/g, "（引用）")
        .replace(/\[([^\]]+)\]\(card:([^)]+)\)/g, "$1")
        // 已知标题的裸 recordId → 标题（避免导出泄露内部标识）
        .replace(/[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}:[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}/g, (token) => titleMap.get(token) ?? token);

    const lines: string[] = [
      "# CardLink AI 分析会话",
      "",
      `- 会话：${session.title || "未命名会话"}`,
      `- 导出时间：${new Date().toISOString()}`,
      `- 消息数：${session.messages.filter((m) => m.type === "user" || m.type === "assistant").length}`,
      "",
      "---",
      "",
    ];
    for (const message of session.messages) {
      const time = new Date(message.createdAt).toLocaleString();
      if (message.type === "user") {
        lines.push(`## 用户 · ${time}`, "", message.text, "");
      } else if (message.type === "assistant") {
        lines.push(`## AI 分析 · ${time}`, "", clean(message.text), "");
      }
      // tool_result 不导出（用户可读导出；来源以正文引用承载）
    }
    return { title: session.title || "未命名会话", markdown: lines.join("\n") };
  }

  private argsHashOf(call: { name: string; arguments?: unknown }): string {
    return stableHashHex(canonicalJson({ name: call.name, args: call.arguments ?? null }));
  }

  /** §5.1.5：角色配置优先于默认装配；effort 缺省沿用基础装配（不静默改档）。 */
  private resolveSetting(base: ModelSetting, override?: ModelRoleSetting | null): ModelSetting {
    if (!override) return base;
    return {
      ...base,
      provider: override.providerId || base.provider,
      model: override.model || base.model,
      effort: override.effort ?? base.effort,
      timeoutMs: override.timeoutMs || base.timeoutMs,
      maxOutputTokens: override.maxOutputTokens || base.maxOutputTokens,
      providerId: override.providerId,
      credentialRef: override.credentialRef,
    };
  }

  private async turn(
    sessionId: SessionId,
    requestId: string,
    input: string | null,
    options: SendMessageOptions,
    continuation: boolean,
  ): Promise<AgentTurnResult> {
    const { store, runStore } = this.deps;
    const cancelled = () => options.signal?.aborted || options.cancelCheck?.();
    let canContinue = continuation;
    const runId = options.runId ?? (runStore ? randomUUID() : undefined);
    const phase = (p: RunPhase, iteration?: number, lastError?: string): void => {
      if (runStore && runId) runStore.setPhase(runId, p, iteration, lastError);
    };
    const failRun = (status: RunStatus, message: string, finishReason?: FinishReason): void => {
      if (runStore && runId) runStore.finish(runId, status, "interrupted", undefined, message.slice(0, 300), finishReason);
    };

    // v2.4 §13.1：已删除会话拒绝任何对话（软删除后不可复活；审计可经 getSession 回溯）。
    const existingSession = await store.get(sessionId);
    if (!existingSession) {
      if (continuation) throw new Error(`会话不存在: ${sessionId}`);
      return { status: "error", error: { code: "session_not_found", message: `会话不存在: ${sessionId}` } };
    }
    if (existingSession.deletedAt) {
      throw new Error(`会话已删除，无法继续对话: ${sessionId}`);
    }

    const assistantChoice = existingSession.assistantModel ?? this.deps.roleConfigStore?.get("assistant");
    if (!existingSession.assistantModel && assistantChoice) {
      await store.bindInitialAssistant(sessionId, assistantChoice);
    }
    const reviewerChoice = this.deps.roleConfigStore?.get("reviewer");
    const resumed = options.resumeQuestion;
    const checkpoint = resumed?.checkpoint;
    const reviewerSetting = checkpoint?.reviewerSetting ?? this.resolveSetting(this.deps.reviewerSetting, reviewerChoice);
    const activeAssistantSetting = checkpoint?.assistantSetting ?? this.resolveSetting(this.deps.assistantSetting, assistantChoice);

    // v2.5 §11.1：该会话最近一次持久化压缩（跨重启复用；本轮内新压缩会更新此引用）。
    let priorCompaction: CompactionRecord | null = this.deps.compactions?.latest(sessionId) ?? null;
    // v2.14 §22：本轮的遥测基线——runId 缺失时用 requestId 兜底，保证幂等键稳定。
    const telemetryRunId = runId ?? `req:${requestId}`;
    let requestSeq = checkpoint?.requestSeq ?? 0;
    let currentStep = 0;
    const stepAttempts = new Map<number, number>();
    // v2.5 §5.2：本轮累计用量与最近一次预算计划（结果/运行记录回传 UI）。
    const turnUsage: { current: TokenUsage | null } = { current: checkpoint?.usage ?? null };
    let lastPlan: ContextPlan | null = null;
    let compactedThisTurn = false;
    let budgetInsufficient = false;
    // v2.16 §11.3：本 Run 预算在入口解析后固定（不随迭代/工具变化）。
    const budget: RunBudget = options.budget ?? this.legacyBudget();
    const deadlineAt = Date.now() + (checkpoint?.remainingMs ?? budget.maxDurationMs);
    // v2.16 §11.3：正常循环与崩溃恢复共用同一已执行工具计数（拒绝/非法不增加）。
    const progress = { executed: checkpoint?.usedToolCalls ?? 0 };
    const timedOut = (): boolean => Date.now() >= deadlineAt;
    const budgetSummary = (): NonNullable<AgentTurnResult["budget"]> => ({
      ...(budget.tier ? { tier: budget.tier } : {}),
      maxIterations: budget.maxIterations,
      maxToolCalls: budget.maxToolCalls,
      maxDurationMs: budget.maxDurationMs,
      usedToolCalls: progress.executed,
    });
    const contextSummary = (): AgentTurnResult["context"] =>
      lastPlan
        ? {
            inputBudgetTokens: lastPlan.inputBudgetTokens,
            estimatedInputTokens: lastPlan.estimatedInputTokens,
            compactionTriggerTokens: compactionTriggerTokens(lastPlan.inputBudgetTokens),
            compactionStatus: budgetInsufficient ? "insufficient"
              : compactedThisTurn ? "compacted"
              : lastPlan.compactionId ? "reused" : "none",
            outputBudgetTokens: lastPlan.outputBudgetTokens,
            reservedTokens: lastPlan.reservedTokens,
            compactionCount: this.deps.compactions?.count(sessionId) ?? 0,
          }
        : undefined;
    const withTelemetry = (result: AgentTurnResult): AgentTurnResult => {
      const usage = turnUsage.current ?? undefined;
      const context = contextSummary();
      return { ...result, ...(usage ? { usage } : {}), ...(context ? { context } : {}), budget: budgetSummary() };
    };
    /** 落库与返回同源：turn_results 中保存的结果与返回给 UI 的完全一致。 */
    const saveAndReturn = async (result: AgentTurnResult): Promise<AgentTurnResult> => {
      const enriched = withTelemetry(result);
      await this.saveTurnResult(sessionId, requestId, enriched);
      if (runStore && runId) {
        const record = runStore.get(runId);
        if (record && record.status !== "active" && !record.resultJson) {
          runStore.finish(runId, record.status, record.phase, JSON.stringify(enriched), undefined, enriched.finishReason);
        }
      }
      return enriched;
    };
    const finishCancelled = async (): Promise<AgentTurnResult> => {
      await store.setStatus(sessionId, "interrupted");
      failRun("cancelled", "用户取消", "cancelled");
      return saveAndReturn({
        status: "error", error: { code: "cancelled", message: "运行已被取消" },
        runId, finishReason: "cancelled", continuable: canContinue,
      });
    };

    const finishTimedOut = async (): Promise<AgentTurnResult> => {
      // v2.16 §11.3：本 Run 总时限到达——协作式检查点（不依赖 JSB 定时器精度），
      // 先于后续模型/工具请求，保留已生成内容并允许续答。
      await store.setStatus(sessionId, "interrupted");
      failRun("interrupted", `达到本 Run 总时限（${Math.round(budget.maxDurationMs / 1000)}s）`, "timeout");
      return saveAndReturn({
        status: "limit_reached", runId, finishReason: "timeout", continuable: canContinue,
      });
    };
    const finishToolBudgetExhausted = async (): Promise<AgentTurnResult> => {
      // v2.16 §11.3：本 Run 工具总量到上限（含恢复路径消耗）→ 停止，不再请求工具；
      // 终止语义与循环上限一致（iteration_limit），运行可续答。
      await store.setStatus(sessionId, "interrupted");
      failRun("interrupted", `达到本 Run 工具调用上限 ${budget.maxToolCalls}`, "iteration_limit");
      return saveAndReturn({
        status: "limit_reached", runId, finishReason: "iteration_limit", continuable: canContinue,
      });
    };
    const textCheck: { ok: true; text: string } | { ok: false; reason: string } = continuation
      ? { ok: true, text: "" }
      : validateUserText(input ?? "");
    if (!textCheck.ok) {
      return { status: "error", error: { code: "invalid_message", message: textCheck.reason } };
    }
    if (!requestId.trim() || requestId.length > 128) {
      return { status: "error", error: { code: "invalid_request", message: "requestId 非法" } };
    }

    // T12：requestId 幂等——重复请求返回既有结果，不重复执行。
    const cached = await (store as { loadTurnResult?: (s: string, r: string) => Promise<unknown> }).loadTurnResult?.(sessionId, requestId);
    if (cached !== null && cached !== undefined) {
      return cached as AgentTurnResult;
    }

    const meta = await this.snapshotForTurn(sessionId, continuation, options.snapshot);
    const snapshotId = meta?.snapshotId ?? "none";
    if (runStore && runId) {
      const previous = runStore.findByRequest(sessionId, requestId);
      const reservation = previous ?? runStore.startRun(runId, sessionId, snapshotId, requestId, budget.tier);
      const reservedForThisCall = options.snapshot !== undefined && reservation.runId === runId;
      if (!reservedForThisCall && (previous || reservation.runId !== runId)) {
        if (reservation.resultJson) return JSON.parse(reservation.resultJson) as AgentTurnResult;
        return {
          status: "error", runId: reservation.runId, continuable: true,
          error: { code: "run_interrupted", message: "此请求已有运行记录，请从会话继续。" },
        };
      }
    }
    let session = existingSession;
    if (session.status !== "active") {
      await store.setStatus(sessionId, "active");
    }
    const evidence: TurnEvidence = {
      snapshotId,
      dataAsOf: meta?.dataAsOf ?? meta?.importedAt ?? new Date().toISOString(),
      recordIds: [],
      statistics: [],
    };

    const currentToolEvidence = new Map<string, ToolEnvelope>();
    const readVerifiedEvidence = (id: string): ToolEnvelope | undefined => {
      const current = currentToolEvidence.get(id);
      if (current) return current;
      const row = this.deps.evidenceStore?.get(id);
      if (!row || row.snapshotId !== snapshotId) return undefined;
      for (const message of existingSession.messages) {
        if (message.type !== "tool_result" || message.status !== "ok" || message.toolCallId !== row.sourceRef) continue;
        const owner = existingSession.sharedMessageOwners?.[message.id] ?? sessionId;
        const call = runStore?.getToolCall(owner, message.toolCallId);
        if (call?.runId !== row.runId || call.executionStatus !== "executed") continue;
        const envelope = message.content as ToolEnvelope;
        const hash = row.resultHash.length === 16 ? stableHashHex : sha256Hex;
        if (envelope?.ok && envelope.evidence?.snapshotId === snapshotId &&
          envelope.evidence.dataAsOf === evidence.dataAsOf && hash(canonicalJson(message.content)) === row.resultHash) return envelope;
      }
      return undefined;
    };
    if (resumed && runStore && runId) {
      for (const call of runStore.listToolCalls(runId)) {
        if (!call.evidenceJson || call.executionStatus !== "executed") continue;
        const { evidenceId } = JSON.parse(call.evidenceJson) as { evidenceId?: string };
        if (!evidenceId) continue;
        const source = readVerifiedEvidence(evidenceId);
        if (!source) continue;
        currentToolEvidence.set(evidenceId, source);
        evidence.recordIds.push(...(source.evidence.recordIds ?? []));
        if (supportsStatisticEvidence(call.toolName)) evidence.statistics.push({
          evidenceId, ref: `s${evidence.statistics.length + 1}`, toolCallId: call.toolCallId,
          toolName: call.toolName, data: source.data,
        });
      }
    }
    const toolContext = { sessionId, scope: session.scope, snapshotId, dataAsOf: evidence.dataAsOf, readVerifiedEvidence };

    const persistAuditAndResult = async (
      audit: ToolAudit,
      result: ToolResult,
      call?: { name: string; arguments?: unknown },
    ): Promise<void> => {
      if (isTransactionalAuditLog(this.deps.auditLog)) {
        await (this.deps.auditLog as TransactionalAuditLog).recordAndAppend(audit, sessionId, result);
      } else {
        await this.deps.auditLog.record(audit);
        await store.append(sessionId, result);
      }
      // v2.1 §7：执行成功的只读结果落证据行（G5 可回溯引用）。
      let evidenceId: string | undefined;
      const envelope = result.content as ToolEnvelope | undefined;
      const verified = audit.executionStatus === "executed" && result.status === "ok" &&
        envelope?.ok === true && envelope.evidence?.snapshotId === snapshotId &&
        (snapshotId === "none" || envelope.evidence.dataAsOf === evidence.dataAsOf);
      if (verified) evidence.recordIds.push(...(envelope.evidence.recordIds ?? []));
      if (verified && runStore && runId && this.deps.evidenceStore) {
        const resultHash = sha256Hex(canonicalJson(result.content ?? null));
        evidenceId = newEvidenceId(runId, audit.toolCallId, resultHash);
        const row: EvidenceRow = {
          evidenceId,
          runId,
          snapshotId,
          sourceType: "tool_result",
          sourceRef: audit.toolCallId,
          resultHash,
          generatedAt: new Date().toISOString(),
        };
        this.deps.evidenceStore.save(row);
        if (this.deps.executor.has("renderVisualization") && audit.toolName !== "renderVisualization") {
          currentToolEvidence.set(evidenceId, envelope);
        }
        if (supportsStatisticEvidence(audit.toolName)) {
          evidence.statistics.push({
            evidenceId, ref: `s${evidence.statistics.length + 1}`, messageId: result.id,
            toolCallId: audit.toolCallId, toolName: audit.toolName, data: envelope.data,
          });
        }
      }
      if (runStore && runId) {
        runStore.recordToolCall({
          sessionId,
          toolCallId: audit.toolCallId,
          runId,
          toolName: audit.toolName,
          argsHash: call
            ? stableHashHex(canonicalJson({ name: call.name, args: call.arguments ?? null }))
            : stableHashHex(canonicalJson({ name: audit.toolName, args: null })),
          policyStatus: audit.policyStatus,
          reviewerApproved: audit.reviewerApproved,
          reviewerReason: audit.reviewerReason,
          executionStatus: audit.executionStatus,
          resultJson: JSON.stringify(result.content ?? null),
          evidenceJson: evidenceId ? JSON.stringify({ evidenceId, snapshotId }) : undefined,
          updatedAt: new Date().toISOString(),
        });
      }
    };

    // v2.4 §5：detailed 能力探测——适配器实现 generateDetailed 时读取 finish_reason 与用量；
    // 未实现时按 completed 如实降级（不伪造截断信息）。
    const replayView = new Map<string, { message: AssistantMessage; results: ToolResult[] }>();
    const callAssistant = async (
      current: Session,
      contextLimitError?: unknown,
    ): Promise<{ message: AssistantMessage; finishReason: FinishReason; usage: TokenUsage }> => {
      const setting = activeAssistantSetting;
      const providerId = setting.providerId ?? setting.provider;
      const resolved = this.deps.capabilities?.resolve(providerId, setting.model) ?? {
        capabilities: defaultCapabilities(providerId, setting.model),
        calibrationRatio: undefined,
      };
      const budget: AssistantBudget = {
        statisticEvidenceInstruction: [
          statisticEvidenceInstruction(evidence.statistics),
          this.deps.interactions ? PUBLIC_INTERACTION_INSTRUCTION : "",
          currentToolEvidence.size ? "可传给 renderVisualization 的本轮已验证证据：" +
            [...currentToolEvidence].map(([id, source]) => `${id} (${source.tool})`).join("，") : "",
        ].filter(Boolean).join("\n"),
        statisticEvidence: evidence.statistics,
        capabilities: resolved.capabilities,
        requestedOutputTokens: setting.maxOutputTokens,
        calibrationRatio: resolved.calibrationRatio,
        forceCompaction: contextLimitError !== undefined,
        priorCompaction,
      };
      const input = replayView.size ? {
        ...current,
        messages: current.messages.flatMap((message) => {
          const replay = replayView.get(message.id);
          return replay ? [replay.message, ...replay.results] : [message];
        }),
      } : current;
      const context = this.deps.assistant.context(input, continuation, budget);
      const plan = this.deps.assistant.plan;
      const compression = this.deps.assistant.compression;
      const breakdown = this.deps.assistant.breakdown ?? EMPTY_BREAKDOWN;
      budgetInsufficient = this.deps.assistant.budgetError !== null;
      lastPlan = plan;
      // v2.14 §22：本次请求的遥测基线（分项来自实际发送视图；不含任何正文）。
      const telemetryKey = { sessionId, runId: telemetryRunId, requestSeq: ++requestSeq };
      const attempt = (stepAttempts.get(currentStep) ?? 0) + 1;
      stepAttempts.set(currentStep, attempt);
      const telemetryBase = {
        sessionId,
        runId: telemetryRunId,
        requestSeq: telemetryKey.requestSeq,
        attempt,
        providerId,
        modelId: setting.model,
        breakdown,
        budget: {
          inputBudgetTokens: plan?.inputBudgetTokens ?? 0,
          outputBudgetTokens: plan?.outputBudgetTokens ?? 0,
          reservedTokens: plan?.reservedTokens ?? 0,
          compactionTriggerTokens: plan ? compactionTriggerTokens(plan.inputBudgetTokens) : 0,
        },
      };
      const compactionLink = plan?.compactionId
        ? { id: plan.compactionId, applied: false, triggerReason: priorCompaction?.triggerReason }
        : null;
      if (budgetInsufficient || (contextLimitError !== undefined && !compression)) {
        budgetInsufficient = true;
        // 本地预算拦截（或超限重试时压缩仍未腾出空间）：已构建上下文但未向服务商发送，
        // 不计任何用量与费用；错误原因区分"本地预算"与"服务商超限后仍失败"。
        this.deps.telemetry?.beginCall({
          ...telemetryBase,
          outcome: "not_sent",
          compaction: compactionLink,
          errorCode: contextLimitError !== undefined ? "context_limit" : "context_budget_insufficient",
        });
        const summary = contextSummary();
        if (summary) options.onContext?.(summary);
        if (contextLimitError !== undefined) throw contextLimitError;
        throw new Error(`context_budget_insufficient: 模型 ${setting.model} 的可用输入预算不足`);
      }

      let computedCompression = Boolean(compression);
      if (compression?.summary && compression.firstKeptMessageId && this.deps.compactions) {
        try {
          const saved = this.deps.compactions.record({
            sessionId,
            firstKeptMessageId: compression.firstKeptMessageId,
            summary: compression.summary,
            snapshotId,
            tokensBefore: compression.tokensBefore,
            tokensAfter: compression.tokensAfter,
            modelId: compression.modelId,
            coveredMessageCount: compression.coveredMessageCount,
            triggerReason: compression.triggeredBy,
          });
          priorCompaction = saved.record;
          if (plan) plan.compactionId = saved.record.id;
          computedCompression = saved.inserted;
        } catch {
          /* 本次请求仍使用已构建的摘要；下一次构建可重新尝试落库。 */
        }
      }
      compactedThisTurn ||= computedCompression;
      const summary = contextSummary();
      if (summary) options.onContext?.(summary);
      if (compression && computedCompression) {
        const { compressedTurns, firstKeptMessageId, triggeredBy, tokensBefore, tokensAfter } = compression;
        try {
          await this.deps.auditLog.record({
            auditId: newAuditId(),
            sessionId,
            toolCallId: `compaction-${firstKeptMessageId}`,
            toolName: "context_compaction",
            policyStatus: "pass",
            executionStatus: "not_executed",
            argsSummary: JSON.stringify({ compressedTurns, firstKeptMessageId, triggeredBy, tokensBefore, tokensAfter }),
            createdAt: new Date().toISOString(),
          });
        } catch { /* 审计失败不阻断回答路径 */ }
      }

      const requestSetting = plan ? { ...setting, maxOutputTokens: plan.outputBudgetTokens } : setting;
      // 请求即将发出：记录 sent 行（收到响应/错误后再更新同一行，不产生第二行）。
      this.deps.telemetry?.beginCall({
        ...telemetryBase,
        outcome: "sent",
        compaction: plan?.compactionId
          ? {
              id: plan.compactionId,
              applied: computedCompression,
              triggerReason: priorCompaction?.triggerReason,
            }
          : null,
      });
      let reply;
      try {
        reply = await requestModel(this.deps.model, context, requestSetting, options.signal, true);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        // 取消/失败也如实落状态：失败请求可能已被服务商计入，但用量未知 → 不推算费用。
        this.deps.telemetry?.completeCall(telemetryKey, cancelled()
          ? { outcome: "cancelled", errorCode: "cancelled" }
          : { outcome: "failed", errorCode: classifyModelError(rawMessage) });
        throw error;
      }
      const { value: message, finishReason, usage: reportedUsage } = reply;

      // v2.5 §5.2：服务商返回用量则如实标注；否则本地估算并标注 estimated。
      const estimatedPrompt = plan?.estimatedInputTokens ?? 0;
      const actualPrompt = reportedUsage?.promptTokens;
      const actualCompletion = reportedUsage?.completionTokens;
      const usage =
        actualPrompt !== undefined
          ? makeUsage(actualPrompt, actualCompletion, false)
          : makeUsage(
              estimatedPrompt || undefined,
              DEFAULT_TOKEN_ESTIMATOR.estimate(message.text),
              true,
            );
      // v2.14 §22：遥测行区分"服务商实报（含 0）/ 本地估算 / 缺失"，缺失分量用估算补齐并标记。
      const telemetryPrompt = usage.promptTokens ?? (breakdown.totalTokens || undefined);
      const telemetryCompletion = usage.completionTokens ?? DEFAULT_TOKEN_ESTIMATOR.estimate(message.text);
      const promptSource = actualPrompt !== undefined ? "provider" as const : "estimated" as const;
      const completionSource = actualCompletion !== undefined ? "provider" as const : "estimated" as const;
      this.deps.telemetry?.completeCall(telemetryKey, {
        outcome: "delivered",
        finishReason,
        promptTokens: telemetryPrompt,
        promptSource,
        completionTokens: telemetryCompletion,
        completionSource,
        reportedPromptTokens: actualPrompt,
        reportedCompletionTokens: actualCompletion,
        usageEstimated: promptSource === "estimated" || completionSource === "estimated",
      });
      this.deps.capabilities?.observeUsage(providerId, setting.model, estimatedPrompt, actualPrompt);
      turnUsage.current = addUsage(turnUsage.current, usage);
      if (runStore && runId && turnUsage.current) runStore.setUsage(runId, turnUsage.current);
      return { message, finishReason, usage };
    };

    // §11.1：所有 Assistant 迭代共用一次服务商超限重试额度。
    let contextRetryUsed = false;
    const callAssistantWithContextRetry = async (current: Session) => {
      try {
        return await callAssistant(current);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        if (cancelled() || contextRetryUsed || budgetInsufficient || classifyModelError(rawMessage) !== "context_limit") throw error;
        contextRetryUsed = true;
        return await callAssistant(current, error);
      }
    };

    // v2.1 §11/T24：中断恢复——处理上一轮崩溃遗留的悬空工具调用，不重复执行已完成工具。
    const dangling = collectDanglingCalls({
      ...session,
      messages: session.messages.filter((message) => !session.sharedMessageOwners?.[message.id]),
    });
    if (dangling.length) {
      const reconcileOutcome = await this.reconcile(
        sessionId, session, dangling, evidence, persistAuditAndResult, options, budget, reviewerSetting, deadlineAt, progress, toolContext,
      );
      if (reconcileOutcome === "cancelled") return finishCancelled();
      if (reconcileOutcome === "timeout") return finishTimedOut();
      if (reconcileOutcome === "limit") {
        // 恢复已耗尽本 Run 工具总量：不再发起额外工具/循环；保留用户输入供续答。
        if (!continuation) {
          await store.append(sessionId, newUserMessage(textCheck.text));
          canContinue = true;
        }
        return finishToolBudgetExhausted();
      }
      session = (await store.get(sessionId)) as Session;
    }

    // v2.2 §10.1：审核档位（会话属性，本 turn 内固定）与溯源 recordId 集合（跨轮累计，
    // 本轮新执行的结果在执行点回填）。
    const reviewLevel = checkpoint?.reviewLevel ?? effectiveReviewLevel(session);
    const provenance = collectSessionRecordIds(session.messages);

    if (resumed?.answers) {
      const messageId = "answer-" + resumed.questionId;
      if (!existingSession.messages.some((message) => message.id === messageId)) {
        await store.append(sessionId, { ...newUserMessage(readableAnswers(resumed.question, resumed.answers)), id: messageId });
      }
    } else if (!continuation) {
      await store.append(sessionId, newUserMessage(textCheck.text));
      canContinue = true;
    }

    const seenToolCallIds = new Set<string>();
    let iteration = checkpoint?.iteration ?? 0;
    // v2.4 §11.1：本轮最后一次执行的工具结果是否被截断（tool_result_truncated 判定）。
    let lastToolTruncated = false;

    for (; iteration < budget.maxIterations; iteration++) {
      if (cancelled()) return finishCancelled();
      if (timedOut()) return finishTimedOut();
      phase("assistant_pending", iteration);
      // v2.14 §22：同一迭代内的重试共享步骤号，便于区分"首次/超限重试"。
      currentStep = iteration;
      const current = await store.get(sessionId);
      if (!current) throw new Error(`会话不存在: ${sessionId}`);

      let assistantMessage: AssistantMessage;
      let msgFinishReason: FinishReason;
      try {
        const reply = await callAssistantWithContextRetry(current);
        assistantMessage = reply.message;
        msgFinishReason = reply.finishReason;
      } catch (error) {
        if (cancelled()) return finishCancelled();
        const rawMessage = error instanceof Error ? error.message : String(error);
        // v2.4 §11.1：模型错误分类——超时/上下文超限/服务商错误（§11.1 枚举）。
        const reason = classifyModelError(rawMessage);
        await store.setStatus(sessionId, "interrupted");
        const errorMessage = `Assistant 模型调用失败: ${rawMessage}`;
        const result = withTelemetry({
          status: "error",
          error: { code: rawMessage.startsWith("context_budget_insufficient:") ? "context_budget_insufficient" : "model_error", message: errorMessage.slice(0, 500) },
          runId,
          finishReason: reason,
          continuable: true,
        });
        if (runStore && runId) {
          runStore.finish(runId, "failed", "interrupted", JSON.stringify(result), errorMessage.slice(0, 300), reason);
        }
        return result;
      }
      if (cancelled()) return finishCancelled();
      const interactions = this.deps.interactions;
      const outcome = msgFinishReason === "completed" && interactions ? parsePublicOutcome(assistantMessage.text) : null;
      const declaredPlan = outcome?.plan?.filter((step) => this.deps.executor.has(step.toolName));
      if (runId && declaredPlan && declaredPlan.length >= 2) interactions?.savePlan(runId, declaredPlan);
      if (assistantMessage.toolCalls.length === 0) {
        if (outcome?.question && interactions && runId && runStore && iteration + 1 < budget.maxIterations && !timedOut()) {
          interactions.putQuestion({
            questionId: randomUUID(), sessionId, runId, question: outcome.question,
            checkpoint: {
              iteration: iteration + 1, requestSeq, usedToolCalls: progress.executed, remainingMs: Math.max(1, deadlineAt - Date.now()),
              budget, assistantSetting: activeAssistantSetting, reviewerSetting, reviewLevel, usage: turnUsage.current,
            },
          });
          return withTelemetry({ status: "waiting_input", runId });
        }
        if (outcome) {
          assistantMessage = { ...assistantMessage, text: outcome.text || (outcome.question ? "本轮预算内无法继续，请补充所需条件后重试。" : "") };
        }
        interactions?.saveOutcome(sessionId, assistantMessage.id, {
          plan: runId ? interactions.plan(runId) : undefined,
          followUps: outcome?.followUps,
          model: {
            provider: activeAssistantSetting.providerId ?? activeAssistantSetting.provider,
            name: activeAssistantSetting.model,
            effort: activeAssistantSetting.effort,
          },
        });
        phase("final_pending", iteration);
        // v2.4 §10.1.1：引用协议解析/校验 → 重写为可读标题链接后落库；
        // 原始回答（含标记）随 TurnResult 持久化（turn_results/runs.result_json 审计层）。
        const resolution = this.deps.citationResolver
          ? await this.deps.citationResolver.resolve(assistantMessage.text, { ...evidence }, session.scope)
          : { displayText: assistantMessage.text, citations: [] as Citation[], unresolved: 0, unverifiedStatistics: 0 };
        const check: EvidenceCheck = await this.deps.evidenceValidator.validateFinalMessage(
          assistantMessage.text,
          { ...evidence },
          session.scope,
        );
        if (cancelled()) return finishCancelled();
        const warnings = [...check.warnings];
        if (resolution.unresolved > 0) {
          warnings.push({
            code: "unknown_record_reference",
            detail: `回答中有 ${resolution.unresolved} 处引用未能核验，已按未校验/脱敏方式展示。`,
          });
        }
        if (resolution.unverifiedStatistics > 0) {
          warnings.push({ code: "unverified_statistic", detail: `${resolution.unverifiedStatistics} 处统计数值缺少本轮匹配的工具证据。` });
        }
        const evidenceRefs = [...new Set([...check.evidenceRefs, ...resolution.citations.flatMap((citation) =>
          citation.available ? [citation.type === "stat" ? `stat:${citation.statsId}` : citation.recordId] : [],
        )])];
        // b19-1（§11.1）：纯文本回答同样可能因输出上限被截断——先落库已生成部分，
        // 再把会话与 Run 标为 interrupted，结果按 limit_reached + continuable 返回；
        // 只有真正结束（stop 且无未执行调用）才置 completed。
        const truncated = msgFinishReason === "output_limit";
        await store.append(sessionId, {
          ...assistantMessage,
          text: resolution.displayText,
          evidenceRefs,
          finishReason: msgFinishReason,
        });
        if (truncated) {
          await store.setStatus(sessionId, "interrupted");
          phase("interrupted", iteration, "output_limit");
          const result = await saveAndReturn({
            status: "limit_reached",
            message: resolution.displayText,
            evidenceRefs,
            ...(warnings.length ? { warnings } : {}),
            runId,
            finishReason: msgFinishReason,
            continuable: true,
            ...(resolution.citations.length ? { citations: resolution.citations } : {}),
            rawText: assistantMessage.text,
          });
          if (runStore && runId) {
            runStore.finish(runId, "interrupted", "interrupted", JSON.stringify(result), "输出 token 上限截断（纯文本回答）", msgFinishReason);
          }
          return result;
        }
        await store.setStatus(sessionId, "completed");
        phase("finished", iteration);
        const result = await saveAndReturn({
          status: "completed",
          message: resolution.displayText,
          evidenceRefs,
          ...(warnings.length ? { warnings } : {}),
          runId,
          finishReason: msgFinishReason,
          ...(resolution.citations.length ? { citations: resolution.citations } : {}),
          rawText: assistantMessage.text,
        });
        if (runStore && runId) {
          runStore.finish(runId, "finished", "finished", JSON.stringify(result), undefined, msgFinishReason);
        }
        return result;
      }

      // v2.4（Pi 教训）：截断消息携带的工具调用整体作废——参数 JSON 可能残缺，不执行任何调用。
      if (msgFinishReason === "output_limit") {
        await store.append(sessionId, assistantMessage);
        await store.setStatus(sessionId, "interrupted");
        failRun("interrupted", "输出 token 上限截断（含未执行的工具调用）", "output_limit");
        const result: AgentTurnResult = { status: "limit_reached", runId, finishReason: "output_limit", continuable: true };
        return saveAndReturn(result);
      }

      const priorCalls = new Map(assistantMessage.toolCalls.map((call) => [
        call.id, runStore?.getToolCall(sessionId, call.id) ?? null,
      ]));
      const freshCalls = assistantMessage.toolCalls.filter((call) => {
        const prior = priorCalls.get(call.id);
        return prior?.resultJson === undefined || prior.argsHash !== this.argsHashOf(call);
      });
      const replay = { message: assistantMessage, results: [] as ToolResult[] };
      if (freshCalls.length !== assistantMessage.toolCalls.length) replayView.set(assistantMessage.id, replay);
      await store.append(sessionId, { ...assistantMessage, text: outcome?.text ?? assistantMessage.text, toolCalls: freshCalls });

      phase("tool_pending", iteration);
      for (const call of assistantMessage.toolCalls) {
        if (cancelled()) return finishCancelled();
        if (timedOut()) return finishTimedOut();
        if (seenToolCallIds.has(call.id)) {
          // T12：同一 toolCallId 在本轮重复出现——跳过，不产生第二个终结结果。
          continue;
        }
        seenToolCallIds.add(call.id);

        // v2.1 §5/T18：argsHash 幂等冲突——同 ID 异参不得复用旧结果。
        const argsHash = this.argsHashOf(call);
        const prior = priorCalls.get(call.id);
        if (prior && prior.argsHash !== argsHash) {
          await persistAuditAndResult(
            {
              auditId: newAuditId(),
              sessionId,
              toolCallId: call.id,
              toolName: call.name,
              policyStatus: "invalid_args",
              executionStatus: "not_executed",
              argsSummary: summarizeArgs(call.arguments),
              createdAt: new Date().toISOString(),
            },
            newToolResult(call.id, "error", { code: "idempotency_conflict", message: "同一 toolCallId 在本会话已被不同参数使用，拒绝执行" }),
            call,
          );
          continue;
        }

        const preliminary = this.deps.guard.check(call, session.scope, progress.executed, { maxToolCalls: budget.maxToolCalls });
        if (prior?.resultJson !== undefined) {
          if (!preliminary.ok) {
            replay.results.push(preliminary.toolResult);
            continue;
          }
          let cached: ToolEnvelope | undefined;
          try { cached = JSON.parse(prior.resultJson) as ToolEnvelope; } catch { /* 存档不可用时要求新 ID。 */ }
          const currentSnapshot = prior.runId === runId || runStore?.get(prior.runId)?.snapshotId === snapshotId;
          if (cached != null && currentSnapshot &&
              (!cached.ok || (cached.evidence?.snapshotId === snapshotId && cached.evidence.dataAsOf === evidence.dataAsOf))) {
            replay.results.push(newToolResult(call.id, cached.ok ? "ok" : "error", {
              cachedResult: cached,
              note: "复用了存档结果。它不是本轮新证据；如需核验，请使用新的调用 ID 查询。",
            }));
          } else {
            replay.results.push(newToolResult(call.id, "error", {
              code: "cached_result_unavailable",
              message: "存档结果无法在当前快照复用，请使用新的调用 ID 查询。",
            }));
          }
          continue;
        }
        if (!preliminary.ok) {
          await persistAuditAndResult(
            {
              auditId: newAuditId(),
              sessionId,
              toolCallId: call.id,
              toolName: call.name,
              policyStatus: preliminary.policyStatus,
              executionStatus: preliminary.policyStatus === "invalid_args" ? "not_executed" : "denied",
              argsSummary: summarizeArgs(call.arguments),
              createdAt: new Date().toISOString(),
            },
            preliminary.toolResult,
            call,
          );
          continue;
        }

        // v2.2 §10.1：按会话审核档位决定是否经独立 Reviewer。免审调用不走模型审核；
        // 确定性拒绝路径（上方）与档位无关，任何档位都不把无界内容传给 Reviewer。
        const requirement = shouldReview(call, provenance, reviewLevel);
        let reviewerApproved: boolean | undefined;
        let reviewerReason: string | undefined;
        if (requirement.review) {
          // Reviewer 第二次模型调用；失败按拒绝处理（失败关闭，T13/T16）。
          phase("review_pending", iteration);
          const chain: ReviewChainContext = {
            executedCalls: summarizeCallChain(current.messages),
            provenanceHit: provenanceHitOf(call, provenance),
          };
          let decision;
          try {
            decision = (await requestModel(
              this.deps.model,
              this.deps.reviewer.context(current, call, session.scope, chain),
              reviewerSetting,
              options.signal,
            )).value;
          } catch (error) {
            if (cancelled()) return finishCancelled();
            decision = {
              approved: false,
              reason: `reviewer_failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
            };
          }

          if (cancelled()) return finishCancelled();
          if (!decision.approved) {
            await persistAuditAndResult(
              {
                auditId: newAuditId(),
                sessionId,
                toolCallId: call.id,
                toolName: call.name,
                policyStatus: "pass",
                reviewerApproved: false,
                reviewerReason: decision.reason,
                executionStatus: "denied",
                argsSummary: preliminary.argsSummary,
                createdAt: new Date().toISOString(),
              },
              newToolResult(call.id, "denied", { code: "denied", message: decision.reason }),
              call,
            );
            continue;
          }
          reviewerApproved = true;
          reviewerReason = decision.reason;
        } else {
          // 免审：审计如实标注档位跳过，不冒充已审核。
          reviewerReason = requirement.skipReason;
        }

        // Reviewer 批准后（或免审调用执行前）再次执行确定性权限检查（§10 步骤 6，防 TOCTOU，T04/T17）。
        const recheck = this.deps.guard.check(call, session.scope, progress.executed, { maxToolCalls: budget.maxToolCalls });
        if (!recheck.ok) {
          await persistAuditAndResult(
            {
              auditId: newAuditId(),
              sessionId,
              toolCallId: call.id,
              toolName: call.name,
              policyStatus: recheck.policyStatus,
              reviewerApproved,
              reviewerReason: reviewerApproved === true ? `${reviewerReason}（复核否决）` : `${reviewerReason}（复核否决: ${recheck.reason}）`,
              executionStatus: "denied",
              argsSummary: summarizeArgs(call.arguments),
              createdAt: new Date().toISOString(),
            },
            recheck.toolResult,
            call,
          );
          continue;
        }

        phase("tool_pending", iteration);
        const outcome = await this.deps.executor.execute(call, toolContext);
        await persistAuditAndResult(
          {
            auditId: newAuditId(),
            sessionId,
            toolCallId: call.id,
            toolName: call.name,
            policyStatus: "pass",
            reviewerApproved,
            reviewerReason,
            executionStatus: outcome.result.status === "ok" ? "executed" : outcome.result.status === "timeout" ? "timeout" : "error",
            argsSummary: preliminary.argsSummary,
            createdAt: new Date().toISOString(),
          },
          outcome.result,
          call,
        );
        progress.executed++;
        phase("tool_completed", iteration);

        const env = outcome.envelope as { truncated?: boolean } | undefined;
        // v2.4 §11.1：记录最后一次工具结果截断状态（iteration_limit 时用于 tool_result_truncated 判定）。
        lastToolTruncated = env?.truncated === true;
        for (const id of evidence.recordIds) provenance.add(id);
      }
    }

    if (cancelled()) return finishCancelled();
    await store.setStatus(sessionId, "interrupted");
    // v2.4 §11.1：迭代上限时区分"最后一次工具结果被截断"（更具体的终止原因）。
    const limitReason: FinishReason = lastToolTruncated ? "tool_result_truncated" : "iteration_limit";
    failRun("interrupted", "达到最大迭代", limitReason);
    const result: AgentTurnResult = { status: "limit_reached", runId, finishReason: limitReason, continuable: true };
    return saveAndReturn(result);
  }

  /**
   * v2.1 §11/T24：崩溃恢复。悬空工具调用逐个走 guard→（按档位 reviewer）→execute；
   * 已有终结结果的调用不重复执行。恢复完成后流程继续本轮正常循环。
   */
  private async reconcile(
    sessionId: SessionId,
    session: Session,
    dangling: Array<{ id: string; name: string; arguments: unknown }>,
    evidence: TurnEvidence,
    persistAuditAndResult: (audit: ToolAudit, result: ToolResult, call?: { name: string; arguments?: unknown }) => Promise<void>,
    options: SendMessageOptions,
    budget: RunBudget,
    reviewerSetting: ModelSetting,
    deadlineAt: number,
    progress: { executed: number },
    toolContext: Parameters<ToolExecutor["execute"]>[1],
  ): Promise<"cancelled" | "timeout" | "limit" | null> {
    // v2.2 §10.1：恢复路径与主循环同一档位与溯源口径。
    const reviewLevel = effectiveReviewLevel(session);
    const provenance = collectSessionRecordIds(session.messages);
    const cancelled = () => options.signal?.aborted || options.cancelCheck?.();
    for (const call of dangling) {
      if (cancelled()) return "cancelled";
      if (Date.now() >= deadlineAt) return "timeout";
      const callShape = { id: call.id, name: call.name, arguments: call.arguments };
      const preliminary = this.deps.guard.check(callShape, session.scope, progress.executed, { maxToolCalls: budget.maxToolCalls });
      if (!preliminary.ok) {
        await persistAuditAndResult(
          {
            auditId: newAuditId(),
            sessionId,
            toolCallId: call.id,
            toolName: call.name,
            policyStatus: preliminary.policyStatus,
            executionStatus: preliminary.policyStatus === "invalid_args" ? "not_executed" : "denied",
            argsSummary: summarizeArgs(call.arguments),
            createdAt: new Date().toISOString(),
          },
          preliminary.toolResult,
          call,
        );
        continue;
      }
      const requirement = shouldReview(call, provenance, reviewLevel);
      let reviewerApproved: boolean | undefined;
      let reviewerReason: string | undefined;
      if (requirement.review) {
        let decision;
        try {
          decision = (await requestModel(
            this.deps.model,
            this.deps.reviewer.context(
              session,
              callShape,
              session.scope,
              {
                executedCalls: summarizeCallChain(session.messages),
                provenanceHit: provenanceHitOf(call, provenance),
              },
            ),
            reviewerSetting,
            options.signal,
          )).value;
        } catch (error) {
          if (cancelled()) return "cancelled";
          decision = { approved: false, reason: `reviewer_failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
        }
        if (cancelled()) return "cancelled";
        // v2.16 §11.3：Reviewer await 之后再次检查共享总时限，超时不再执行工具。
        if (Date.now() >= deadlineAt) return "timeout";
        if (!decision.approved) {
          await persistAuditAndResult(
            {
              auditId: newAuditId(),
              sessionId,
              toolCallId: call.id,
              toolName: call.name,
              policyStatus: "pass",
              reviewerApproved: false,
              reviewerReason: `恢复：${decision.reason}`,
              executionStatus: "denied",
              argsSummary: summarizeArgs(call.arguments),
              createdAt: new Date().toISOString(),
            },
            newToolResult(call.id, "denied", { code: "denied", message: decision.reason }),
            call,
          );
          continue;
        }
        reviewerApproved = true;
        reviewerReason = `恢复：${decision.reason}`;
      } else {
        reviewerReason = `恢复（${requirement.skipReason}）`;
      }
      const recheck = this.deps.guard.check(callShape, session.scope, progress.executed, { maxToolCalls: budget.maxToolCalls });
      if (!recheck.ok) {
        await persistAuditAndResult(
          {
            auditId: newAuditId(),
            sessionId,
            toolCallId: call.id,
            toolName: call.name,
            policyStatus: recheck.policyStatus,
            reviewerApproved,
            reviewerReason: `恢复复核否决`,
            executionStatus: "denied",
            argsSummary: summarizeArgs(call.arguments),
            createdAt: new Date().toISOString(),
          },
          recheck.toolResult,
          call,
        );
        continue;
      }
      // v2.16 §11.3：工具执行前（Reviewer await 之后）再检查取消与共享总时限。
      if (cancelled()) return "cancelled";
      if (Date.now() >= deadlineAt) return "timeout";
      const outcome = await this.deps.executor.execute(
        callShape,
        toolContext,
      );
      await persistAuditAndResult(
        {
          auditId: newAuditId(),
          sessionId,
          toolCallId: call.id,
          toolName: call.name,
          policyStatus: "pass",
          reviewerApproved,
          reviewerReason,
          executionStatus: outcome.result.status === "ok" ? "executed" : outcome.result.status === "timeout" ? "timeout" : "error",
          argsSummary: summarizeArgs(call.arguments),
          createdAt: new Date().toISOString(),
        },
        outcome.result,
        call,
      );
      // 与正常循环同一计数口径：执行成功/失败/超时都计入已执行工具，拒绝与非法参数不计。
      progress.executed++;
      for (const id of evidence.recordIds) provenance.add(id);
    }
    // 恢复完成后继续正常流程（新用户消息随后追加）；工具总量用尽时停止并留给续答。
    if (cancelled()) return "cancelled";
    return progress.executed >= budget.maxToolCalls ? "limit" : null;
  }

  private async saveTurnResult(sessionId: SessionId, requestId: string, result: AgentTurnResult): Promise<void> {
    const savable = this.deps.store as unknown as {
      saveTurnResult?: (s: string, r: string, x: unknown) => Promise<void>;
    };
    await savable.saveTurnResult?.(sessionId, requestId, result);
  }
}

/** 悬空工具调用：assistant.toolCalls 中没有对应终结 ToolResult 的调用（按消息序）。 */
function collectDanglingCalls(session: Session): Array<{ id: string; name: string; arguments: unknown }> {
  const terminated = new Set(
    session.messages
      .filter((m) => m.type === "tool_result")
      .map((m) => (m as { toolCallId: string }).toolCallId),
  );
  const dangling: Array<{ id: string; name: string; arguments: unknown }> = [];
  for (const m of session.messages) {
    if (m.type === "assistant") {
      for (const c of m.toolCalls) {
        if (!terminated.has(c.id)) dangling.push({ id: c.id, name: c.name, arguments: c.arguments });
      }
    }
  }
  return dangling;
}
