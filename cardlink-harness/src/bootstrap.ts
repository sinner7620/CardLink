import type { HarnessConfig } from "./config.ts";
import { AgentService } from "./application/agent-service.ts";
import { AssistantRole } from "./application/assistant-role.ts";
import { ContextBuilder, CONTEXT_MAX_MESSAGES_DEFAULT, TOOL_CONTENT_BUDGET_DEFAULT } from "./application/context-builder.ts";
import { EvidenceValidator } from "./application/evidence-validator.ts";
import { CitationResolver } from "./application/citation-resolver.ts";
import { PolicyGuard } from "./application/policy-guard.ts";
import { ReviewerRole } from "./application/reviewer-role.ts";
import { StatisticsEngine } from "./application/statistics-engine.ts";
import { SyncService } from "./application/sync-service.ts";
import { SqliteInteractionStore } from "./adapters/sqlite/sqlite-interaction-store.ts";
import { ToolRegistry } from "./application/tool-registry.ts";
import { ToolExecutor, type ToolTimer } from "./application/tool-executor.ts";
import { createCardLinkBridge } from "./adapters/cardlink/cardlink-bridge.ts";
import type { SqlDriver } from "./adapters/sqlite/db.ts";
import { SqliteRunStore } from "./adapters/sqlite/sqlite-run-store.ts";
import { SqliteAuditLog } from "./adapters/sqlite/sqlite-audit-log.ts";
import { VersionedSqliteMistakeRepository } from "./adapters/sqlite/versioned-mistake-repository.ts";
import { VersionedBackedMistakeRepository } from "./adapters/sqlite/versioned-legacy-repository.ts";
import { SqliteEvidenceStore } from "./adapters/sqlite/sqlite-evidence-store.ts";
import type { RoleConfigStore } from "./application/ports/role-config-store.ts";
import { SqliteSessionStore } from "./adapters/sqlite/sqlite-session-store.ts";
import { SqliteModelCapabilitiesStore } from "./adapters/sqlite/sqlite-model-capabilities-store.ts";
import { SqliteCompactionStore } from "./adapters/sqlite/sqlite-compaction-store.ts";
import { SqliteRequestTelemetryStore } from "./adapters/sqlite/sqlite-request-telemetry.ts";
import { SqliteModelRateStore } from "./adapters/sqlite/sqlite-model-rate-store.ts";
import { SqliteSourceBaselineStore } from "./adapters/sqlite/sqlite-source-baseline.ts";
import { ModelCapabilitiesRegistry } from "./application/model-capabilities-registry.ts";
import { DEFAULT_BUDGET_CAPS } from "./domain/run-budget.ts";
import { CompactionService } from "./application/compaction-service.ts";
import { RequestTelemetryService } from "./application/request-telemetry-service.ts";
import { OpenAiCompatibleModelClient } from "./adapters/model/provider-client.ts";
import type { ModelClient } from "./application/ports/model-client.ts";

/**
 * Composition Root（§4/§15）：唯一了解具体适配器实现的装配入口。
 * 业务层不得直接 new 某厂商客户端。
 *
 * 存储层（§6.2/§21.2）：版本化投影为唯一事实源；旧端口经
 * VersionedBackedMistakeRepository 提供（latest 视图 + forSnapshot 运行锁定）。
 */
export type HarnessApp = {
  config: HarnessConfig;
  db: SqlDriver;
  store: SqliteSessionStore;
  auditLog: SqliteAuditLog;
  /** 旧端口视图（latest + forSnapshot），工具/AgentService/桥使用。 */
  repository: VersionedBackedMistakeRepository;
  /** 版本化投影仓储（v2.1 §6.2），同步服务与 P4 原生路径使用。 */
  repositoryV2: VersionedSqliteMistakeRepository;
  evidenceStore: SqliteEvidenceStore;
  statisticsEngine: StatisticsEngine;
  registry: ToolRegistry;
  interactions: SqliteInteractionStore;
  service: AgentService;
  syncService: SyncService;
  runStore: SqliteRunStore;
  model: ModelClient;
  /** v2.5 §5.2：模型能力登记（预算/校准）。 */
  capabilities: ModelCapabilitiesRegistry;
  /** v2.5 §11.1：压缩服务（持久化摘要视图）。 */
  compactions: CompactionService;
  compactionStore: SqliteCompactionStore;
  /** v2.14 §22：请求用量遥测（按真实 Assistant 调用记录；不含正文）。 */
  telemetry: RequestTelemetryService;
  telemetryStore: SqliteRequestTelemetryStore;
  /** v2.14 §22：手动费率（与密钥分离的 H1 元数据）。 */
  modelRates: SqliteModelRateStore;
  /** v2.16 §6.3：本地源指纹基线（成功导入后写入）。 */
  sourceBaseline: SqliteSourceBaselineStore;
};

export type HarnessAppOptions = {
  model?: ModelClient;
  /**
   * P4-0（依赖倒置，§4）：驱动由调用方注入——开发/回归传 node:sqlite 驱动
   * （adapters/sqlite/node-driver），设备传 JsbSqliteDriver（adapters/jsb）。
   * 本文件因此不进入 node:sqlite 依赖图，JSB 打包门禁可强制扫描。
   */
  driver: SqlDriver;
  /** P4-2（§5.1.5）：可选角色配置存储；提供时 AgentService 每次调用前解析覆盖。 */
  roleConfigStore?: RoleConfigStore;
  /** b17：工具超时定时器（设备注入 MN Utils delay；缺省 setTimeout）。 */
  toolTimer?: ToolTimer;
  toolProtocolVersion?: 1 | 2;
};

export function createHarnessApp(config: HarnessConfig, options: HarnessAppOptions): HarnessApp {
  const db = options.driver;
  const store = new SqliteSessionStore(db);
  const auditLog = new SqliteAuditLog(db);
  const interactions = new SqliteInteractionStore(db);
  const repositoryV2 = new VersionedSqliteMistakeRepository(db);
  const repository = new VersionedBackedMistakeRepository(repositoryV2, undefined, db);
  const evidenceStore = new SqliteEvidenceStore(db);
  const statisticsEngine = new StatisticsEngine(repository);
  const registry = new ToolRegistry(options.toolProtocolVersion).registerDefaults({ repository, statisticsEngine });
  // v2.4 §11.1：上下文压缩预算（config.limits.contextBudgetChars；0 禁用）。
  const builder = new ContextBuilder(CONTEXT_MAX_MESSAGES_DEFAULT, TOOL_CONTENT_BUDGET_DEFAULT, config.limits.contextBudgetChars);
  const assistant = new AssistantRole(builder, registry.definitions());
  const reviewer = new ReviewerRole(builder, registry);
  const guard = new PolicyGuard(registry, config.limits.maxToolCallsPerTurn);
  const executor = new ToolExecutor(registry, config.limits.toolTimeoutMs, options.toolTimer);
  const evidenceValidator = new EvidenceValidator(repository);
  // v2.4 §10.1.1：引用协议解析器（真实卡片标题来自版本化投影；标题不得由模型编造）。
  const citationResolver = new CitationResolver(repository);
  const runStore = new SqliteRunStore(db);
  // v2.5 §5.2/§11.1：模型能力登记与持久化压缩。
  const capabilities = new ModelCapabilitiesRegistry(new SqliteModelCapabilitiesStore(db));
  const compactionStore = new SqliteCompactionStore(db);
  const compactions = new CompactionService(compactionStore);
  // v2.14 §22：请求用量遥测与手动费率（H1 自有表；只读 CardLink 数据）。
  const telemetryStore = new SqliteRequestTelemetryStore(db);
  const modelRates = new SqliteModelRateStore(db);
  const telemetry = new RequestTelemetryService({ store: telemetryStore, rates: modelRates });
  const sourceBaseline = new SqliteSourceBaselineStore(db);
  const model = options.model ?? new OpenAiCompatibleModelClient({
    baseUrl: config.model.baseUrl,
    apiKey: config.model.apiKey,
    provider: config.model.provider,
  });
  const service = new AgentService({
    store,
    model,
    assistant,
    reviewer,
    guard,
    executor,
    evidenceValidator,
    citationResolver,
    auditLog,
    repository,
    evidenceStore,
    runStore,
    capabilities,
    compactions,
    telemetry,
    roleConfigStore: options.roleConfigStore,
    interactions: options.toolProtocolVersion === 2 ? interactions : undefined,
    config: {
      maxIterations: config.limits.maxIterations,
      maxToolCallsPerTurn: config.limits.maxToolCallsPerTurn,
      hardLimits: config.limits.hardLimits
        ? {
            maxIterations: config.limits.hardLimits.maxIterations,
            maxToolCalls: config.limits.hardLimits.maxToolCalls,
            maxDurationMs: config.limits.hardLimits.maxRunDurationMs,
          }
        : DEFAULT_BUDGET_CAPS,
    },
    assistantSetting: {
      provider: config.model.provider,
      model: config.model.name,
      effort: config.model.effortAssistant,
      timeoutMs: config.model.timeoutMs,
      maxOutputTokens: config.model.maxOutputTokens,
      providerId: config.model.providerId,
      credentialRef: config.model.credentialRef,
    },
    reviewerSetting: {
      provider: config.model.provider,
      model: config.model.reviewerName || config.model.name,
      effort: config.model.effortReviewer,
      timeoutMs: config.model.timeoutMs,
      maxOutputTokens: config.model.maxOutputTokens,
      providerId: config.model.providerId,
      credentialRef: config.model.credentialRef,
    },
  });
  const syncService = new SyncService(repositoryV2);
  // CardLinkBridge 显式未启用（§19.1）：调用即抛错，防止未经 P0 验证的在线路径。
  void createCardLinkBridge;
  return { config, db, store, auditLog, repository, repositoryV2, evidenceStore, statisticsEngine, registry, interactions, service, syncService, runStore, model, capabilities, compactions, compactionStore, telemetry, telemetryStore, modelRates, sourceBaseline };
}
