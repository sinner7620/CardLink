import type { ModelSetting } from "../domain/model-setting.ts";
import type { ReviewLevel } from "../domain/session.ts";
import type { TokenUsage } from "../domain/token-usage.ts";
import type { RunBudget } from "../domain/run-budget.ts";

export const PUBLIC_INTERACTION_PREFIX = "CARDLINK_PUBLIC_V1\n";
export const PUBLIC_INTERACTION_INSTRUCTION = `如继续前确实缺少用户条件，文本只输出 ${PUBLIC_INTERACTION_PREFIX.trim()} 后换行和 JSON：
{"text":"","question":{"steps":[{"id":"scope","question":"要分析哪类题？","options":[{"id":"due","label":"到期题"},{"id":"all","label":"所有题"}],"selectionMode":"single"}]}}
问题只在缺少关键条件时需要。steps 最多 3 项，selectionMode 为 single 或 multiple。已可作答时照常回答。
确实需要用户选择后续动作时可用同一格式给出最终 text 和最多 2 条 followUps。普通回答省略 followUps。
公开计划只用于多阶段任务。可附 plan 数组，每项有 label 和实际相关的 toolName。禁止发送私有推理。`;

type QuestionStep = {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  selectionMode: "single" | "multiple";
  minSelections: number;
  maxSelections: number;
};
export type PublicQuestion = { steps: QuestionStep[] };
export type PublicOutcome = {
  text: string;
  question?: PublicQuestion;
  followUps?: string[];
  plan?: { label: string; toolName: string }[];
  model?: { provider: string; name: string; effort: string };
};
export type QuestionCheckpoint = {
  iteration: number;
  requestSeq: number;
  usedToolCalls: number;
  remainingMs: number;
  budget: RunBudget;
  assistantSetting: ModelSetting;
  reviewerSetting: ModelSetting;
  reviewLevel: ReviewLevel;
  usage: TokenUsage | null;
};
export type PendingQuestion = {
  questionId: string;
  sessionId: string;
  runId: string;
  question: PublicQuestion;
  checkpoint: QuestionCheckpoint;
  submissionId?: string;
  answers?: Record<string, string[]>;
  draft?: Record<string, string[]>;
};
export interface InteractionStore {
  putQuestion(question: PendingQuestion): void;
  pendingForRun(runId: string): PendingQuestion | null;
  pendingForSession(sessionId: string): PendingQuestion | null;
  accept(questionId: string, submissionId: string, answers: unknown, runId: string, sessionId: string): PendingQuestion;
  saveDraft(questionId: string, runId: string, sessionId: string, answers: unknown): void;
  closeRun(runId: string): void;
  savePlan(runId: string, plan: NonNullable<PublicOutcome["plan"]>): void;
  plan(runId: string): PublicOutcome["plan"];
  saveOutcome(sessionId: string, messageId: string, outcome: Omit<PublicOutcome, "question" | "text">): void;
  outcomes(sessionId: string): Record<string, Omit<PublicOutcome, "question" | "text">>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bounded(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}
function identifier(value: unknown): string | null {
  const id = bounded(value, 40);
  return id && /^[a-zA-Z0-9_-]+$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id) ? id : null;
}

export function parsePublicOutcome(text: string): PublicOutcome | null {
  if (!text.startsWith(PUBLIC_INTERACTION_PREFIX) || text.length > 32_000) return null;
  let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(text.slice(PUBLIC_INTERACTION_PREFIX.length))); } catch { return null; }
  if (typeof raw.text !== "string") return null;
  const stepsRaw = record(raw.question).steps;
  const outcome: PublicOutcome = { text: raw.text };
  if (Array.isArray(stepsRaw) && stepsRaw.length > 0 && stepsRaw.length <= 3) {
    const steps: QuestionStep[] = [];
    const ids = new Set<string>();
    for (const item of stepsRaw) {
      const step = record(item);
      const id = identifier(step.id);
      const question = bounded(step.question, 240);
      if (!id || ids.has(id) || !question || !Array.isArray(step.options) || step.options.length < 2 || step.options.length > 8 ||
        (step.selectionMode !== "single" && step.selectionMode !== "multiple")) return null;
      const options: QuestionStep["options"] = [];
      for (const value of step.options) {
        const rawOption = record(value);
        const optionId = identifier(rawOption.id);
        const label = bounded(rawOption.label, 100);
        if (!optionId || !label || options.some((option) => option.id === optionId)) return null;
        options.push({ id: optionId, label });
      }
      const selectionMode = step.selectionMode;
      const minSelections = step.minSelections ?? 1;
      const maxSelections = step.maxSelections ?? (selectionMode === "single" ? 1 : options.length);
      if (typeof minSelections !== "number" || typeof maxSelections !== "number" ||
        !Number.isInteger(minSelections) || !Number.isInteger(maxSelections) || minSelections < 1 ||
        maxSelections < minSelections || maxSelections > (selectionMode === "single" ? 1 : options.length)) return null;
      ids.add(id);
      steps.push({ id, question, options, selectionMode, minSelections, maxSelections });
    }
    outcome.question = { steps };
  } else if (raw.question !== undefined) return null;
  if (!outcome.question && Array.isArray(raw.followUps)) {
    outcome.followUps = [...new Set(raw.followUps.map((item) => bounded(item, 150)).filter((item): item is string => item !== null))].slice(0, 2);
  }
  if (Array.isArray(raw.plan) && raw.plan.length >= 2 && raw.plan.length <= 6) {
    const plan = raw.plan.flatMap((item) => {
      const step = record(item);
      const label = bounded(step.label, 120);
      const toolName = identifier(step.toolName);
      return label && toolName ? [{ label, toolName }] : [];
    });
    if (plan.length === raw.plan.length) outcome.plan = plan;
  }
  return outcome;
}

export function validateQuestionAnswers(question: PublicQuestion, value: unknown, partial = false): Record<string, string[]> {
  const input = record(value);
  const known = new Set(question.steps.map((step) => step.id));
  if (Object.keys(input).some((id) => !known.has(id)) || (!partial && Object.keys(input).length !== known.size)) throw new Error("请选择当前问题的选项");
  const answers: Record<string, string[]> = {};
  for (const step of question.steps) {
    const choices = input[step.id];
    if (partial && choices === undefined) continue;
    if (!Array.isArray(choices) || choices.length < step.minSelections || choices.length > step.maxSelections ||
      new Set(choices).size !== choices.length || choices.some((choice) => !step.options.some((option) => option.id === choice))) {
      throw new Error("答案与当前问题不匹配");
    }
    answers[step.id] = step.options.filter((item) => choices.includes(item.id)).map((item) => item.id);
  }
  return answers;
}

export function readableAnswers(question: PublicQuestion, answers: Record<string, string[]>): string {
  return question.steps.map((step) => step.question + "：" +
    step.options.filter((option) => answers[step.id]?.includes(option.id)).map((option) => option.label).join("、")).join("\n");
}
