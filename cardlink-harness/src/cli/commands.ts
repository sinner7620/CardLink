import { readFileSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { createHarnessApp } from "../bootstrap.ts";
import { openDatabase } from "../adapters/sqlite/node-driver.ts";

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

/**
 * CLI 入口（§15 adapters/cli）：serve 之外的运维命令。
 * ask/new-session/stats 输出均为受控 JSON，不打印模型密钥与完整正文。
 */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const command = argv[0] ?? "help";
  const args = argv.slice(1);

  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    }
  }
  const positional = args.filter((a) => !a.startsWith("--") && !args[(args.indexOf(a) ?? -1) - 1]?.startsWith("--"));

  try {
    switch (command) {
      case "init-db": {
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        app.db.close?.();
        print({ ok: true, database: config.storage.database });
        return 0;
      }
      case "import": {
        const file = positional[0];
        if (!file) throw new Error("用法: h1 import <snapshot.json> [--full]");
        const payload = JSON.parse(readFileSync(file, "utf8"));
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const result = await app.syncService.importSnapshot(payload);
        print(result);
        return 0;
      }
      case "sessions": {
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const sessions = await app.service.listSessions(Number(flags.get("limit") ?? 20));
        print(sessions.map((s) => ({ id: s.id, status: s.status, createdAt: s.createdAt, messages: s.messages.length })));
        return 0;
      }
      case "session": {
        const id = positional[0];
        if (!id) throw new Error("用法: h1 session <sessionId>");
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const session = await app.service.getSession(id);
        if (!session) throw new Error(`会话不存在: ${id}`);
        print(session);
        return 0;
      }
      case "new-session": {
        const notebookIds = (flags.get("notebooks") ?? "")
          .split(",").map((x) => x.trim()).filter(Boolean);
        const subject = flags.get("subject");
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const session = await app.service.createSession({ notebookIds, ...(subject ? { subject } : {}) });
        print({ sessionId: session.id });
        return 0;
      }
      case "ask": {
        const id = positional[0];
        const text = positional.slice(1).join(" ");
        if (!id || !text) throw new Error("用法: h1 ask <sessionId> <消息>");
        const config = loadConfig(env);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const result = await app.service.sendMessage(id, `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text);
        print(result);
        return result.status === "error" ? 1 : 0;
      }
      case "stats": {
        const config = loadConfig(env, false);
        const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
        const levelRaw = flags.get("level");
        const stats = await app.statisticsEngine.getStats({
          filter: {
            subject: flags.get("subject"),
            notebookIds: (flags.get("notebooks") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
            ...(levelRaw === "0" || levelRaw === "1" || levelRaw === "2" ? { level: Number(levelRaw) as 0 | 1 | 2 } : {}),
          },
          scope: { notebookIds: [] },
          statsTime: flags.get("stats-time"),
          timezone: flags.get("timezone"),
        });
        print(stats);
        return 0;
      }
      case "help":
      default:
        console.log(`CardLink Harness H1 CLI
  h1 serve                          启动 HTTP 服务（需完整配置）
  h1 init-db                        初始化数据库 Schema
  h1 import <file> [--full]         导入快照（备份文件或导出契约）
  h1 sessions [--limit N]           列出会话
  h1 session <id>                   查看会话
  h1 new-session [--notebooks a,b] [--subject s]   新建会话
  h1 ask <sessionId> <消息>          发送消息并等待回答
  h1 stats [--subject] [--notebooks] [--level] [--stats-time] [--timezone]  直接统计`);
        return 0;
    }
  } catch (error) {
    console.error(`[h1] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
