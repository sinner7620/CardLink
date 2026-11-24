import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadDotEnv } from "./config.ts";
import { createHarnessApp } from "./bootstrap.ts";
import { openDatabase } from "./adapters/sqlite/node-driver.ts";
import { listenHttp } from "./adapters/http/routes.ts";
import { runCli } from "./cli/commands.ts";

function ensureEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../../.env"), resolve(process.cwd(), ".env")]) {
    try {
      loadDotEnv(readFileSync(candidate, "utf8"), process.env);
      break;
    } catch {
      // 无 .env 时依赖真实环境变量（§14）。
    }
  }
}

async function main(): Promise<void> {
  ensureEnv();
  const argv = process.argv.slice(2);
  if (argv[0] === "serve") {
    const config = loadConfig(process.env);
    const app = createHarnessApp(config, { driver: openDatabase(config.storage.database) });
    listenHttp(app, (address) => {
      console.error(`CardLink Harness H1 已启动: ${address}（仅回环；令牌已从 H1_HTTP_TOKEN 加载）`);
    });
    return;
  }
  const exitCode = await runCli(argv, process.env);
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`[h1] 启动失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
