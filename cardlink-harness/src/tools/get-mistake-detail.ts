import { errorEnvelope, OCR_TEXT_MAX_LENGTH, okEnvelope } from "../domain/evidence.ts";
import type { Tool } from "../domain/tool.ts";
import type { MistakeRecord } from "../domain/mistake.ts";
import { objectSchema, readOptionalBool, readOptionalInt, readRecordId, resolveRepo, sliceCodePoints, snapshotContext, type ToolDeps } from "./shared.ts";

type ContentField = "question" | "answer";

type ContentRequest = { field: ContentField; offset: number; limit: number };

/** v2.13 §9.2：分段请求的运行时校验（PolicyGuard 已按 Schema 校验字段与枚举）。 */
function readContentRequest(raw: unknown): ContentRequest | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("content 必须是对象");
  const value = raw as { field?: unknown; offset?: unknown; limit?: unknown };
  if (value.field !== "question" && value.field !== "answer") throw new Error("content.field 必须是 question 或 answer");
  const offset = readOptionalInt(value.offset, "content.offset", 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const limit = readOptionalInt(value.limit, "content.limit", 1, OCR_TEXT_MAX_LENGTH) ?? OCR_TEXT_MAX_LENGTH;
  return { field: value.field, offset, limit };
}

/**
 * 分字段来源 ID：只返回确实存在的那部分，不伪造手写/批注或现成关联笔记之外的来源。
 *
 * v2.13 §9.2：答案必须可定位（旧导入口径：`answerNotebookId` + `answerRootNodeId`）。
 * v2.16 §6.1/§12.8：设备投影的答案（`answerTextOrigin='answer_card'`）必须使用**实际匹配的
 * 答案笔记**身份 `answerSourceNotebookId`/`answerSourceNoteId`，绑定根不再充当答案笔记；
 * 且答案来源学习集必须在会话 scope 内，否则不返回正文。
 */
type AnswerSourceCheck =
  | { source: { notebookId: string; noteId: string } }
  | { reason: "answer_source_unlocatable" | "answer_source_out_of_scope" };

function answerSource(record: MistakeRecord, scope: { notebookIds: string[] }): AnswerSourceCheck {
  const deviceProjected = record.answerTextOrigin === "answer_card";
  const notebookId = deviceProjected ? record.answerSourceNotebookId : record.answerNotebookId;
  const noteId = deviceProjected ? record.answerSourceNoteId : record.answerRootNodeId;
  if (!notebookId || !noteId) return { reason: "answer_source_unlocatable" };
  if (scope.notebookIds.length && !scope.notebookIds.includes(notebookId)) {
    return { reason: "answer_source_out_of_scope" };
  }
  return { source: { notebookId, noteId } };
}

function fieldSource(field: ContentField, record: MistakeRecord, scope: { notebookIds: string[] }): AnswerSourceCheck {
  if (field === "question") {
    return { source: { notebookId: record.sourceNotebookId, noteId: record.sourceNoteId } };
  }
  return answerSource(record, scope);
}

/**
 * v2.13 §9.2：单字段有界片段。三种情况可区分——
 * 有正文（available:true）、未投影/无正文（available:false + reason）、offset 越过末尾（outOfRange）。
 * 答案另有：存在正文但缺少可定位来源 → `answer_source_unlocatable`；来源不在 scope →
 * `answer_source_out_of_scope`；设备投影不可用原因（多候选/索引不可用/空文等）原样透传。
 * offset/limit 单位是 Unicode 码点，不切断代理对。
 */
function buildContentSegment(request: ContentRequest, record: MistakeRecord, scope: { notebookIds: string[] }): Record<string, unknown> {
  const base = { field: request.field, offset: request.offset, limit: request.limit };
  const sourceCheck = fieldSource(request.field, record, scope);
  const text = request.field === "question" ? record.questionText : record.answerText;
  if (text === undefined) {
    const reason = request.field === "answer"
      ? record.answerReason ?? "answer_not_projected"
      : "question_text_unavailable";
    return {
      ...base,
      available: false,
      reason,
      totalLength: 0,
      hasMore: false,
      ...("source" in sourceCheck ? { source: sourceCheck.source } : {}),
      ...(request.field === "answer" && record.answerStatus ? { answerStatus: record.answerStatus } : {}),
    };
  }
  if (!("source" in sourceCheck)) {
    return {
      ...base,
      available: false,
      reason: sourceCheck.reason,
      totalLength: 0,
      hasMore: false,
    };
  }
  const source = sourceCheck.source;
  const sliced = sliceCodePoints(text, request.offset, request.limit);
  const outOfRange = request.offset > sliced.totalLength;
  return {
    ...base,
    available: true,
    totalLength: sliced.totalLength,
    text: outOfRange ? "" : sliced.text,
    ...(outOfRange ? { outOfRange: true } : {}),
    ...(!outOfRange && sliced.nextOffset !== undefined ? { nextOffset: sliced.nextOffset } : {}),
    hasMore: !outOfRange && sliced.nextOffset !== undefined,
    source,
  };
}

/** §9：getMistakeDetail —— 单记录；includeText=true 时返回题干（截断至 4000 字符）。 */
export function createGetMistakeDetail(deps: ToolDeps): Tool {
  return {
    definition: {
      name: "getMistakeDetail",
      description: "读取一条错题的完整元数据（标题体系、分类、用户自定义标签、错因、复习状态、答案绑定）。includeText=true 时附带题干正文（OCR 用户修订优先，超长截断）。读长正文用 content 分段：{ field: 'question'|'answer', offset?, limit?(1..4000) }，offset/limit 以 Unicode 码点计，返回片段与 nextOffset。",
      parameters: objectSchema(
        {
          recordId: { type: "string", description: "错题 ID（笔记本ID:笔记ID）" },
          includeText: { type: "boolean", description: "是否一次性附带题干正文，默认 false" },
          content: {
            type: "object",
            properties: {
              field: { type: "string", enum: ["question", "answer"], description: "分段读取的字段：题干或答案" },
              offset: { type: "integer", minimum: 0, description: "起始码点偏移，默认 0" },
              limit: { type: "integer", minimum: 1, maximum: OCR_TEXT_MAX_LENGTH, description: `本段最大码点数，默认 ${OCR_TEXT_MAX_LENGTH}` },
            },
            required: ["field"],
            additionalProperties: false,
          },
        },
        ["recordId"],
      ),
      resultSchema: { type: "object" },
      permission: "mistakes:read",
    },
    async run(args, ctx) {
      const a = args as { recordId: string; includeText?: boolean; content?: ContentRequest };
      const recordId = readRecordId(a.recordId, "recordId");
      const includeText = readOptionalBool(a.includeText, "includeText") ?? false;
      const content = readContentRequest(a.content);
      const repo = resolveRepo(ctx, deps);
      const snap = await snapshotContext(ctx, repo);
      const record = await repo.getById(recordId, ctx.scope);
      if (!record) {
        return errorEnvelope("getMistakeDetail", "not_found", `错题不存在或不在授权范围: ${recordId}`, snap.snapshotId, snap.dataAsOf);
      }
      const evidence = { recordIds: [recordId], snapshotId: snap.snapshotId, dataAsOf: snap.dataAsOf };
      if (content) {
        // 分段模式只发送所请求字段的片段：record 元数据不带任何字段正文。
        const { questionText, answerText, ...meta } = record;
        const data = {
          record: {
            ...meta,
            questionTextOmitted: questionText === undefined ? undefined : questionText.length,
            answerTextOmitted: answerText === undefined ? undefined : answerText.length,
          },
          textStatus: record.textStatus,
          contentSegment: buildContentSegment(content, record, ctx.scope),
          snapshotId: snap.snapshotId,
        };
        return okEnvelope("getMistakeDetail", data, evidence);
      }
      let questionText: string | undefined;
      let truncated = false;
      if (includeText) {
        if (record.questionText === undefined) {
          questionText = undefined;
        } else if (record.questionText.length > OCR_TEXT_MAX_LENGTH) {
          questionText = record.questionText.slice(0, OCR_TEXT_MAX_LENGTH);
          truncated = true;
        } else {
          questionText = record.questionText;
        }
      }
      // v2.16 §9.2：设备同步新增的答案正文只经显式 content:{field:'answer'} 分段发送；
      // 默认详情与旧 includeText 路径保持旧导入响应行为（旧导入记录仍带 answerText）。
      const deviceAnswer = record.answerTextOrigin === "answer_card";
      const { answerText: projectedAnswerText, ...rest } = record;
      const data = {
        record: {
          ...rest,
          ...(deviceAnswer || projectedAnswerText === undefined ? {} : { answerText: projectedAnswerText }),
          ...(deviceAnswer && projectedAnswerText !== undefined ? { answerTextOmitted: projectedAnswerText.length } : {}),
          questionText,
          questionTextOmitted: includeText ? undefined : record.questionText === undefined ? undefined : record.questionText.length,
        },
        textStatus: record.textStatus,
        snapshotId: snap.snapshotId,
      };
      return okEnvelope("getMistakeDetail", data, evidence, truncated);
    },
  };
}
