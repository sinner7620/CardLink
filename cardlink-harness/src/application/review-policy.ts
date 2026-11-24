import type { AgentMessage } from "../domain/message.ts";
import { DEFAULT_REVIEW_LEVEL, type ReviewLevel, type Session } from "../domain/session.ts";

/**
 * v2.2 §10.1 审核档位判定（纯确定性，无模型参与）。
 * - strict：所有进入执行候选集的调用都经 Reviewer；
 * - provenance：recordId 可溯源（本会话已执行工具结果证据中出现过）的 detail/history 下钻调用免审；
 * - full_allow：Reviewer 不参与，仅确定性 PolicyGuard。
 * 免审只改变 Reviewer 是否参与；PolicyGuard 恒定先行（含执行前复核）。
 */

/** 下钻类只读工具：以单个 recordId 读取已获取记录的详情/历史。 */
const DRILLDOWN_TOOLS = new Set(["getMistakeDetail", "getReviewHistory"]);

export type ReviewRequirement =
  | { review: false; skipReason: string }
  | { review: true };

/** Reviewer 上下文的调用链补充（v2.2 §10 步骤 5，最小必要、不含 OCR/题干正文）。 */
export type ReviewChainContext = {
  /** 本会话已执行调用摘要（工具名 + 结果）。 */
  executedCalls: string[];
  /** 待审 recordId 是否溯源命中；调用不针对单一记录时为 undefined。 */
  provenanceHit: boolean | undefined;
};

/** 从会话消息收集溯源 recordId 集合：tool_result 包络证据字段（跨轮累计）。 */
export function collectSessionRecordIds(messages: Session["messages"]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.type !== "tool_result") continue;
    const content = message.content as
      | { evidence?: { recordIds?: unknown } }
      | null
      | undefined;
    const recordIds = content?.evidence?.recordIds;
    if (!Array.isArray(recordIds)) continue;
    for (const id of recordIds) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return ids;
}

export function effectiveReviewLevel(session: Pick<Session, "reviewLevel">): ReviewLevel {
  return session.reviewLevel ?? DEFAULT_REVIEW_LEVEL;
}

/** 待审调用是否携带可溯源 recordId；不针对单一记录的调用返回 undefined。 */
export function provenanceHitOf(
  call: { name: string; arguments?: unknown },
  provenance: Set<string>,
): boolean | undefined {
  const recordId = (call.arguments as { recordId?: unknown } | undefined)?.recordId;
  if (typeof recordId !== "string" || !recordId) return undefined;
  return provenance.has(recordId);
}

/**
 * 档位判定：该调用是否需要 Reviewer。
 * 仅在 PolicyGuard 通过后调用；参数不合法等确定性拒绝与档位无关（不进 Reviewer）。
 */
export function shouldReview(
  call: { name: string; arguments?: unknown },
  provenance: Set<string>,
  level: ReviewLevel,
): ReviewRequirement {
  if (level === "strict") return { review: true };
  if (level === "full_allow") return { review: false, skipReason: "tier_skip: full_allow" };
  // provenance：仅下钻工具且 recordId 溯源于本会话已执行结果时免审。
  if (!DRILLDOWN_TOOLS.has(call.name)) return { review: true };
  const recordId = (call.arguments as { recordId?: unknown } | undefined)?.recordId;
  if (typeof recordId === "string" && recordId && provenance.has(recordId)) {
    return { review: false, skipReason: "tier_skip: provenance" };
  }
  return { review: true };
}

/** 会话消息的调用链摘要（Reviewer 上下文补充，v2.2 §10 步骤 5）：工具名 + 参数结构，不含 OCR/题干。 */
export function summarizeCallChain(messages: Session["messages"], limit = 8): string[] {
  const chain: string[] = [];
  for (const message of messages) {
    if (message.type !== "tool_result") continue;
    const content = message.content as { tool?: string; ok?: boolean; error?: { code?: string } } | null;
    if (!content?.tool) continue;
    const outcome = content.ok === true ? "ok" : content.error?.code ?? "error";
    chain.push(`${content.tool}(${outcome})`);
  }
  return chain.slice(-limit);
}
