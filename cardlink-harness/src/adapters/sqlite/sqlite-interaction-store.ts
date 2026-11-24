import type { SqlDriver } from "./db.ts";
import { validateQuestionAnswers, type InteractionStore, type PendingQuestion, type PublicOutcome } from "../../application/public-interaction.ts";

type Outcome = Omit<PublicOutcome, "question" | "text">;
type Row = { payload_json: string; submission_id: string | null; answers_json: string | null; draft_json: string | null };

function read(row: Row | undefined): PendingQuestion | null {
  if (!row) return null;
  const question = JSON.parse(row.payload_json) as PendingQuestion;
  return {
    ...question, ...(row.draft_json ? { draft: JSON.parse(row.draft_json) as Record<string, string[]> } : {}),
    ...(row.submission_id && row.answers_json ? {
      submissionId: row.submission_id, answers: JSON.parse(row.answers_json) as Record<string, string[]>,
    } : {}),
  };
}

export class SqliteInteractionStore implements InteractionStore {
  constructor(private readonly driver: SqlDriver) {}

  putQuestion(question: PendingQuestion): void {
    this.driver.transaction(() => {
      this.closeRun(question.runId);
      this.driver.exec("INSERT INTO run_questions(question_id, run_id, session_id, payload_json, closed) VALUES(?,?,?,?,0)",
        [question.questionId, question.runId, question.sessionId, JSON.stringify(question)]);
    });
  }

  pendingForRun(runId: string): PendingQuestion | null {
    return read(this.driver.rows("SELECT payload_json, submission_id, answers_json, draft_json FROM run_questions WHERE run_id = ? AND closed = 0", [runId])[0] as Row | undefined);
  }

  pendingForSession(sessionId: string): PendingQuestion | null {
    return read(this.driver.rows("SELECT payload_json, submission_id, answers_json, draft_json FROM run_questions WHERE session_id = ? AND closed = 0 ORDER BY rowid DESC LIMIT 1", [sessionId])[0] as Row | undefined);
  }

  accept(questionId: string, submissionId: string, rawAnswers: unknown, runId: string, sessionId: string): PendingQuestion {
    return this.driver.transaction(() => {
      const result = this.driver.rows("SELECT payload_json, submission_id, answers_json, closed FROM run_questions WHERE question_id = ?", [questionId])[0];
      const question = read(result as Row | undefined);
      if (!question || question.runId !== runId || question.sessionId !== sessionId) throw new Error("问题不可用");
      const answers = validateQuestionAnswers(question.question, rawAnswers);
      const serialized = JSON.stringify(answers);
      if (question.submissionId) {
        if (question.submissionId !== submissionId || JSON.stringify(question.answers) !== serialized) throw new Error("此问题已经回答");
        return question;
      }
      if (Number(result?.closed) === 1) throw new Error("运行已经结束");
      this.driver.exec("UPDATE run_questions SET submission_id = ?, answers_json = ? WHERE question_id = ? AND closed = 0",
        [submissionId, serialized, questionId]);
      return { ...question, submissionId, answers };
    });
  }

  saveDraft(questionId: string, runId: string, sessionId: string, rawAnswers: unknown): void {
    const pending = this.pendingForRun(runId);
    if (!pending || pending.questionId !== questionId || pending.sessionId !== sessionId || pending.submissionId) throw new Error("问题已结束或已提交");
    const answers = validateQuestionAnswers(pending.question, rawAnswers, true);
    this.driver.exec("UPDATE run_questions SET draft_json = ? WHERE question_id = ? AND closed = 0 AND submission_id IS NULL",
      [JSON.stringify(answers), questionId]);
  }

  closeRun(runId: string): void {
    this.driver.exec("UPDATE run_questions SET closed = 1 WHERE run_id = ? AND closed = 0", [runId]);
  }

  savePlan(runId: string, plan: NonNullable<PublicOutcome["plan"]>): void {
    this.driver.exec("INSERT OR REPLACE INTO run_public_plans(run_id, payload_json) VALUES(?,?)", [runId, JSON.stringify(plan)]);
  }

  plan(runId: string): PublicOutcome["plan"] {
    const row = this.driver.rows("SELECT payload_json FROM run_public_plans WHERE run_id = ?", [runId])[0];
    return typeof row?.payload_json === "string" ? JSON.parse(row.payload_json) as PublicOutcome["plan"] : undefined;
  }

  saveOutcome(sessionId: string, messageId: string, outcome: Outcome): void {
    this.driver.exec("INSERT OR REPLACE INTO public_assistant_outcomes(session_id, message_id, payload_json) VALUES(?,?,?)",
      [sessionId, messageId, JSON.stringify(outcome)]);
  }

  outcomes(sessionId: string): Record<string, Outcome> {
    return Object.fromEntries(this.driver.rows("SELECT message_id,payload_json FROM public_assistant_outcomes WHERE session_id = ?", [sessionId])
      .map((item) => [String(item.message_id), JSON.parse(String(item.payload_json)) as Outcome]));
  }
}
