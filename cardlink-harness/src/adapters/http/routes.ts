import * as http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessApp } from "../../bootstrap.ts";
import type { HarnessConfig } from "../../config.ts";
import { isSyncImportFailure } from "../../application/sync-service.ts";

const BODY_LIMIT = 2 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

type JsonResponder = (status: number, payload: unknown) => void;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function webDistRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "../../../web/dist");
  return existsSync(candidate) ? candidate : null;
}

function sendJson(responder: JsonResponder, status: number, payload: unknown): void {
  responder(status, payload);
}

/**
 * §13 外部 API（稳定边界）+ 受限静态资源。
 * 安全（§3/§11）：仅回环绑定（config 校验）、除健康检查外 Bearer 令牌、
 * 固定允许来源、请求体上限；日志不记录消息正文与密钥。
 */
export function createHttpServer(app: HarnessApp): http.Server {
  const config = app.config;
  const webRoot = webDistRoot();

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const responder: JsonResponder = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
      console.error(`[h1] ${req.method} ${req.url} -> ${status} (${Date.now() - startedAt}ms)`);
    };

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const path = url.pathname;

      // Origin 校验：非允许来源的跨源请求直接拒绝（写端点尤其重要，§13）。
      const origin = req.headers.origin;
      if (origin && config.corsOrigin && origin !== config.corsOrigin) {
        sendJson(responder, 403, { error: { code: "origin_denied", message: "Origin 不在允许列表" } });
        return;
      }

      if (req.method === "GET" && path === "/h1/health") {
        const meta = await app.repository.getLatestSnapshotMeta();
        sendJson(responder, 200, { ok: true, snapshotId: meta?.snapshotId ?? "none", version: "h1-0.1.0" });
        return;
      }

      // 静态资源（web/dist）：不含错题数据，免令牌以让浏览器加载 UI；
      // 之下所有 /h1/* 数据端点仍要求会话令牌（§3.3/§11）。
      if (req.method === "GET" && webRoot && !path.startsWith("/h1/")) {
        const rel = normalize(path).replace(/^([/\\])+/, "");
        const target = rel ? join(webRoot, rel) : join(webRoot, "index.html");
        if (target.startsWith(webRoot) && existsSync(target) && statSync(target).isFile()) {
          const body = readFileSync(target);
          res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" });
          res.end(body);
          console.error(`[h1] GET ${path} -> 200 (static, ${Date.now() - startedAt}ms)`);
          return;
        }
        const indexFile = join(webRoot, "index.html");
        if (existsSync(indexFile)) {
          const body = readFileSync(indexFile);
          res.writeHead(200, { "Content-Type": MIME[".html"], "X-Content-Type-Options": "nosniff" });
          res.end(body);
          console.error(`[h1] GET ${path} -> 200 (spa, ${Date.now() - startedAt}ms)`);
          return;
        }
      }

      // 令牌认证（除健康检查与静态资源外的所有端点，§3.3）。
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${config.httpToken}`) {
        sendJson(responder, 401, { error: { code: "unauthorized", message: "缺少或错误的会话令牌" } });
        return;
      }

      if (req.method === "POST" && path === "/h1/sessions") {
        let body: { scope?: unknown };
        try {
          body = JSON.parse((await readBody(req)) || "{}") as { scope?: unknown };
        } catch (error) {
          sendJson(responder, 400, { error: { code: "invalid_json", message: `请求体不是合法 JSON: ${(error as Error).message}` } });
          return;
        }
        try {
          const session = await app.service.createSession(body.scope ?? { notebookIds: [] });
          sendJson(responder, 200, { sessionId: session.id });
        } catch (error) {
          sendJson(responder, 400, { error: { code: "invalid_scope", message: (error as Error).message } });
        }
        return;
      }

      const sessionsMatch = path.match(/^\/h1\/sessions\/([^/]+)$/);
      if (req.method === "GET" && sessionsMatch) {
        const session = await app.service.getSession(decodeURIComponent(sessionsMatch[1] as string));
        if (!session) {
          sendJson(responder, 404, { error: { code: "session_not_found", message: "会话不存在" } });
          return;
        }
        sendJson(responder, 200, session);
        return;
      }

      if (req.method === "GET" && path === "/h1/sessions") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20)));
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const sessions = await app.service.listSessions(limit, cursor);
        sendJson(responder, 200, {
          sessions,
          nextCursor: (sessions as typeof sessions & { nextCursor?: string }).nextCursor,
        });
        return;
      }

      const messagesMatch = path.match(/^\/h1\/sessions\/([^/]+)\/messages$/);
      if (req.method === "POST" && messagesMatch) {
        const body = JSON.parse((await readBody(req)) || "{}") as { requestId?: unknown; text?: unknown };
        const result = await app.service.sendMessage(
          decodeURIComponent(messagesMatch[1] as string),
          typeof body.requestId === "string" ? body.requestId : "",
          typeof body.text === "string" ? body.text : "",
        );
        sendJson(responder, 200, result);
        return;
      }

      if (req.method === "POST" && path === "/h1/import/cardlink-snapshot") {
        let payload: unknown;
        try {
          payload = JSON.parse((await readBody(req)) || "{}");
        } catch {
          sendJson(responder, 400, { error: { code: "invalid_json", message: "请求体不是合法 JSON" } });
          return;
        }
        try {
          const result = await app.syncService.importSnapshot(payload);
          sendJson(responder, 200, result);
        } catch (error) {
          if (isSyncImportFailure(error)) {
            sendJson(responder, 422, { error: { code: "snapshot_invalid", message: error.message, diagnostics: error.diagnostics } });
            return;
          }
          throw error;
        }
        return;
      }

      // 静态资源分支已在鉴权前处理；此处仅剩数据端点。

      sendJson(responder, 404, { error: { code: "not_found", message: "未知端点" } });
    } catch (error) {
      if ((error as Error).message === "body_too_large") {
        sendJson(responder, 413, { error: { code: "body_too_large", message: `请求体超过 ${BODY_LIMIT} 字节` } });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(responder, 500, { error: { code: "internal_error", message: message.slice(0, 300) } });
    }
  });

  server.maxHeadersCount = 64;
  server.headersTimeout = 15000;
  server.requestTimeout = 180000;
  return server;
}

export function listenHttp(app: HarnessApp, onReady?: (address: string) => void): http.Server {
  const server = createHttpServer(app);
  const config: HarnessConfig = app.config;
  server.listen(config.port, config.bind, () => {
    onReady?.(`http://${config.bind}:${config.port}`);
  });
  return server;
}
