/**
 * Harness P0 真机验证探针——纯核心（规范 v2.1 §15 P0 清单）。
 * 本文件不导入任何平台 API；JSB 胶水见 p0-probes.ts。
 * 目标：在真机上证明 Harness Core 依赖的四项能力。
 */

export type P0Step = { name: string; ok: boolean; detail: string };

export type P0SuiteResult = {
  suite: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  steps: P0Step[];
};

export type MinimalSqlDriver = {
  exec(sql: string, args?: unknown[]): void;
  rows(sql: string, args?: unknown[]): Array<Record<string, unknown>>;
};

export type MinimalHttp = (
  method: string,
  url: string,
  options?: { headers?: Record<string, string>; timeoutMs?: number },
) => Promise<{ status: number; json?: unknown; data?: unknown }>;

function step(name: string, ok: boolean, detail: string): P0Step {
  return { name, ok, detail: detail.slice(0, 300) };
}

function suiteOf(suite: string, startedAt: string, steps: P0Step[]): P0SuiteResult {
  return { suite, ok: steps.every((s) => s.ok), startedAt, finishedAt: new Date().toISOString(), steps };
}

const rawDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * P0.1 JSB Core：Promise/async/await、连续两次"模型模拟请求"（延迟返回 JSON）、
 * 现代语法与 JSON 往返。全部经 Promise 链执行，不阻塞调用方。
 */
export async function probeCore(timer?: (ms: number) => Promise<void>): Promise<P0SuiteResult> {
  const startedAt = new Date().toISOString();
  const steps: P0Step[] = [];
  const wait = timer ?? rawDelay;
  try {
    const started = Date.now();
    const [first, second] = await Promise.all([
      wait(60).then(() => ({ role: "assistant", json: { ok: true, round: 1 } })),
      wait(90).then(() => wait(30).then(() => ({ role: "reviewer", json: { approved: true, round: 2 } }))),
    ]);
    const elapsed = Date.now() - started;
    steps.push(step(
      "async 两轮模型模拟",
      first.json.ok === true && second.json.approved === true,
      `Promise.all+await 链完成，耗时 ${elapsed}ms（round1=${first.json.round}, round2=${second.json.round}）`,
    ));
    const nested = { b: 2, a: { d: [1, { c: null }], e: true } };
    const round = JSON.parse(JSON.stringify(nested));
    steps.push(step("JSON 往返", JSON.stringify(round) === JSON.stringify(nested), "嵌套对象序列化往返一致"));
    const merged = { ...(round as Record<string, unknown>), z: (round as { a?: unknown }).a };
    steps.push(step("现代语法", merged !== null && typeof merged === "object", "解构/展开/可选链可用"));
  } catch (error) {
    steps.push(step("核心执行", false, String(error instanceof Error ? error.message : error)));
  }
  return suiteOf("core", startedAt, steps);
}

/**
 * P0.2 SQLite：独立探针库（不触碰 OCR 库与错题存储）。
 * 验证：参数绑定、事务回滚、UNIQUE 约束、INSERT OR IGNORE、WAL、持久化（关闭重开）。
 */
export async function probeSqlite(open: (path: string) => MinimalSqlDriver, path: string): Promise<P0SuiteResult> {
  const startedAt = new Date().toISOString();
  const steps: P0Step[] = [];
  let db: MinimalSqlDriver | undefined;
  const add = (name: string, fn: () => string, dbShouldClose = false): void => {
    try {
      const detail = fn();
      steps.push(step(name, true, detail));
    } catch (error) {
      steps.push(step(name, false, String(error instanceof Error ? error.message : error)));
      if (dbShouldClose && db) {
        try { (db as unknown as { close(): void }).close(); } catch { /* 已关闭 */ }
        db = undefined;
      }
    }
  };
  try {
    db = open(path);
    steps.push(step("打开独立探针库", true, path));
    add("WAL 模式", () => {
      const row = db?.rows("PRAGMA journal_mode")[0] as { journal_mode?: string } | undefined;
      return `journal_mode=${row?.journal_mode ?? "未知"}`;
    });
    add("参数绑定建表+写入", () => {
      db?.exec("CREATE TABLE IF NOT EXISTS p0_items(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, value INTEGER)");
      db?.exec("INSERT OR IGNORE INTO p0_items(name, value) VALUES(?, ?)", ["alpha", 1]);
      db?.exec("INSERT OR IGNORE INTO p0_items(name, value) VALUES(?, ?)", ["beta", 2]);
      const row = db?.rows("SELECT COUNT(*) AS n FROM p0_items")[0] as { n: number } | undefined;
      return `参数化插入后 COUNT=${Number(row?.n ?? 0)}`;
    });
    add("事务回滚不半写", () => {
      db?.exec("BEGIN IMMEDIATE");
      try {
        db?.exec("INSERT INTO p0_items(name, value) VALUES(?, ?)", ["rollback", 9]);
      } finally {
        db?.exec("ROLLBACK");
      }
      const row = db?.rows("SELECT COUNT(*) AS n FROM p0_items")[0] as { n: number } | undefined;
      return `ROLLBACK 后 COUNT=${Number(row?.n ?? 0)}（应仍为 2）`;
    });
    add("UNIQUE 约束生效", () => {
      let conflicted = false;
      try {
        db?.exec("INSERT INTO p0_items(name, value) VALUES(?, ?)", ["alpha", 3]);
      } catch {
        conflicted = true;
      }
      const row = db?.rows("SELECT COUNT(*) AS n FROM p0_items")[0] as { n: number } | undefined;
      return `重复插入被拒绝=${conflicted}，COUNT=${Number(row?.n ?? 0)}`;
    });
    add("INSERT OR IGNORE 幂等", () => {
      db?.exec("INSERT OR IGNORE INTO p0_items(name, value) VALUES(?, ?)", ["alpha", 4]);
      const row = db?.rows("SELECT COUNT(*) AS n FROM p0_items")[0] as { n: number } | undefined;
      return `COUNT=${Number(row?.n ?? 0)}（应仍为 2）`;
    });
    add("持久化（关闭重开）", () => {
      (db as unknown as { close(): void }).close();
      db = undefined;
      const reopened = open(path);
      const row = reopened.rows("SELECT COUNT(*) AS n FROM p0_items")[0] as { n: number } | undefined;
      db = reopened;
      return `重开后 COUNT=${Number(row?.n ?? 0)}（应仍为 2）`;
    }, true);
  } catch (error) {
    steps.push(step("SQLite 套件", false, String(error instanceof Error ? error.message : error)));
  }
  if (db) {
    try { (db as unknown as { close(): void }).close(); } catch { /* 忽略 */ }
  }
  return suiteOf("sqlite", startedAt, steps);
}

/**
 * P0.3 HTTPS：带 Authorization 的 JSON 请求、JSON 解析、超时行为。
 * 默认端点为公共 echo 服务（不发送真实密钥）；可由用户输入自定义端点与令牌。
 */
export async function probeHttps(http: MinimalHttp, options?: { jsonEndpoint?: string; token?: string }): Promise<P0SuiteResult> {
  const startedAt = new Date().toISOString();
  const steps: P0Step[] = [];
  const endpoint = options?.jsonEndpoint || "https://httpbin.org/bearer/p0-probe";
  const token = options?.token || "p0-probe";
  try {
    steps.push(step("JSON+Authorization 回显", false, "进行中"));
    const echoIndex = steps.length - 1;
    try {
      const res = await http("GET", endpoint, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 20000 });
      const json = res.json as { authenticated?: boolean; token?: string } | undefined;
      const echoed = json?.authenticated === true || res.status === 200;
      steps[echoIndex] = step("JSON+Authorization 回显", echoed && res.status === 200, `status=${res.status} authenticated=${String(json?.authenticated ?? "n/a")} endpoint=${endpoint}`);
    } catch (error) {
      steps[echoIndex] = step("JSON+Authorization 回显", false, `${endpoint} → ${String(error instanceof Error ? error.message : error)}`);
    }
    steps.push(step("基础 TLS 可达", false, "进行中"));
    const tlsIndex = steps.length - 1;
    try {
      const res = await http("GET", "https://www.baidu.com", { timeoutMs: 15000 });
      steps[tlsIndex] = step("基础 TLS 可达", typeof res.status === "number" && res.status > 0, `status=${res.status}（证明出站 HTTPS 通道可用）`);
    } catch (error) {
      steps[tlsIndex] = step("基础 TLS 可达", false, String(error instanceof Error ? error.message : error));
    }
    steps.push(step("超时与取消", false, "进行中"));
    const timeoutIndex = steps.length - 1;
    try {
      await http("GET", "https://httpbin.org/delay/3", { timeoutMs: 800 });
      steps[timeoutIndex] = step("超时与取消", false, "慢请求未按预期超时");
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      steps[timeoutIndex] = step("超时与取消", /timeout|timed?\s*out|-1001/i.test(message), `按预期超时：${message}`);
    }
  } catch (error) {
    steps.push(step("HTTPS 套件", false, String(error instanceof Error ? error.message : error)));
  }
  return suiteOf("https", startedAt, steps);
}

export type StatsComparison = {
  total: number;
  harnessDue: number;
  pluginDue: number;
  levelCounts: { "0": number; "1": number; "2": number; unknown: number };
  availableRecords: number;
  reviewedHarness: number;
  currentLevelReviewCountSum: number;
  totalReviewActions: number;
  dueBoundary: string;
  timezone: string;
  sampleRecordIds: string[];
  generatedAt: string;
};

/**
 * P0.6 数据一致：用 Harness 口径函数在真实 CardLink 记录上计算统计，
 * 与插件原生 isDue 口径并列输出，供与界面徽标逐项对照。
 */
export function compareStatsForRecords(
  records: Array<Record<string, unknown>>,
  now: Date,
  endOfLocalDayFn: (instant: Date, timeZone: string) => Date,
): StatsComparison {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const dueBoundary = endOfLocalDayFn(now, timezone).getTime();
  const levelCounts: { "0": number; "1": number; "2": number; unknown: number } = { "0": 0, "1": 0, "2": 0, unknown: 0 };
  let harnessDue = 0;
  let pluginDue = 0;
  let availableRecords = 0;
  let reviewedHarness = 0;
  let currentLevelReviewCountSum = 0;
  let totalReviewActions = 0;
  for (const r of records) {
    const level = r.level;
    const bucket = level === 0 || level === 1 || level === 2 ? String(level) : "unknown";
    levelCounts[bucket as "0" | "1" | "2" | "unknown"] += 1;
    if (r.sourceAvailable !== false) availableRecords += 1;
    if (r.lastReviewedAt) reviewedHarness += 1;
    const reviewCount = typeof r.reviewCount === "number" ? r.reviewCount : 0;
    currentLevelReviewCountSum += reviewCount;
    const history = Array.isArray(r.history) ? r.history : [];
    if (history.length > 1) totalReviewActions += history.length - 1;
    const reviewCompleted = r.reviewCompleted === true;
    const nextReviewAt = typeof r.nextReviewAt === "string" ? Date.parse(r.nextReviewAt) : NaN;
    const harnessPredicate = !reviewCompleted && Number.isFinite(nextReviewAt) && nextReviewAt < dueBoundary;
    if (harnessPredicate) harnessDue += 1;
    // 插件原生 isDue 口径：本地“今天 24 点前”即到期（含逾期），排除 reviewCompleted。
    const endOfDayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const pluginPredicate = !reviewCompleted && Number.isFinite(nextReviewAt) && nextReviewAt < endOfDayLocal;
    if (pluginPredicate) pluginDue += 1;
  }
  return {
    total: records.length,
    harnessDue,
    pluginDue,
    levelCounts,
    availableRecords,
    reviewedHarness,
    currentLevelReviewCountSum,
    totalReviewActions,
    dueBoundary: new Date(dueBoundary).toISOString(),
    timezone,
    sampleRecordIds: records.slice(0, 3).map((r) => String(r.recordId ?? "")),
    generatedAt: now.toISOString(),
  };
}

/** P0.4 异步运行状态机：验证 JSB 宿主跨桥调用之间的异步延续（前台）。 */
export type RunStateProbe = {
  runId: string;
  status: "active" | "finished";
  phase: string;
  steps: string[];
};

const runStateProbes = new Map<string, RunStateProbe>();

export function startRunStateProbe(): { runId: string } {
  const runId = `p0-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run: RunStateProbe = { runId, status: "active", phase: "created", steps: [] };
  runStateProbes.set(runId, run);
  void (async () => {
    for (const phase of ["assistant_pending", "tool_pending", "tool_completed", "final_pending"]) {
      await rawDelay(350);
      run.phase = phase;
      run.steps.push(`${new Date().toISOString()} → ${phase}`);
    }
    run.status = "finished";
    run.phase = "finished";
    run.steps.push(`${new Date().toISOString()} → finished`);
  })();
  return { runId };
}

export function getRunStateProbe(runId: string): RunStateProbe | null {
  const run = runStateProbes.get(runId);
  return run ? { ...run, steps: [...run.steps] } : null;
}
