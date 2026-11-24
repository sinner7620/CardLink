import MNBridge from "./mnBridge"

/**
 * P4-3：Harness 命令面客户端（§13）。
 * 统一经 MNBridge harnessCall 走原生（快照同步在 JSB 侧完成，记录数据不出原生层）。
 */

export function harnessSend(command, data = {}) {
  return MNBridge.send("harnessCall", { command, data })
}

/** 生成请求幂等 ID（UI 刷新不重复提交由 requestId 保证，§13）。 */
export function newRequestId() {
  const random = Math.random().toString(36).slice(2, 10)
  return `ui-${Date.now().toString(36)}-${random}`
}

/** 轮询 run 到终态；onTick 每次收到最新状态。返回终态数据。 */
export async function pollRunStatus(runId, { onTick, intervalMs = 800, maxAttempts = 300 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await harnessSend("harness.getRunStatus", { runId })
    if (!res?.ok) throw new Error(res?.error?.message || "运行状态查询失败")
    const data = res.data
    if (onTick) onTick(data)
    if (data.status && data.status !== "active") return data
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error("运行状态轮询超时")
}
