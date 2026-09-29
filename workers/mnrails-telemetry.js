export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 简单健康检查
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "mnrails-telemetry",
      });
    }

    // 只允许 POST /ping
    if (request.method !== "POST" || url.pathname !== "/ping") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.json();

      const {
        schema,
        install_id,
        version,
        channel,
      } = body ?? {};

      // 协议版本
      if (schema !== 1) {
        return new Response("Invalid schema", { status: 400 });
      }

      // UUID 校验
      if (
        typeof install_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          install_id
        )
      ) {
        return new Response("Invalid install_id", { status: 400 });
      }

      // 版本号只允许合理长度
      if (
        typeof version !== "string" ||
        version.length < 1 ||
        version.length > 40
      ) {
        return new Response("Invalid version", { status: 400 });
      }

      // 只接受 stable / beta
      if (channel !== "stable" && channel !== "beta") {
        return new Response("Invalid channel", { status: 400 });
      }

      const now = Date.now();

      await env.DB.prepare(`
        INSERT INTO installations (
          install_id,
          first_seen,
          last_seen,
          version,
          channel
        )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(install_id)
        DO UPDATE SET
          last_seen = excluded.last_seen,
          version = excluded.version,
          channel = excluded.channel
      `)
        .bind(
          install_id,
          now,
          now,
          version,
          channel
        )
        .run();

      return new Response(null, { status: 204 });
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
  },
};