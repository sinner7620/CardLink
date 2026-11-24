import type { ISODateTime } from "../domain/message.ts";
import type { MistakeFilter, MistakeReport, MistakeReportFilter, MistakeStats } from "../domain/mistake.ts";
import type { SessionScope } from "../domain/session.ts";
import type { MistakeRepository } from "./ports/mistake-repository.ts";

/**
 * 到期口径（§12，与插件统一）：统计时区下“本地今天 24:00”前的到期（含逾期）
 * 计入，reviewCompleted 除外。本函数计算该时区的当日 24:00（= 次日本地零点）。
 */
export function endOfLocalDay(instant: Date, timeZone: string): Date {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = dayFmt.format(instant).split("-").map(Number);
  if (!y || !m || !d) throw new Error(`时区时间解析失败: ${timeZone}`);
  const offsetAt = (utcGuess: number): number => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(utcGuess));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - utcGuess;
  };
  const localMidnightGuess = Date.UTC(y, m - 1, d);
  const offset = offsetAt(localMidnightGuess);
  // 次日本地零点（= 当日 24:00）；两遍校正跨 DST 偏移。
  const nextGuess = Date.UTC(y, m - 1, d + 1);
  const nextOffset = offsetAt(nextGuess);
  return new Date(nextGuess - nextOffset);
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error(`非法时区: ${timeZone}`);
  }
}

export type StatsRequest = {
  filter: MistakeFilter;
  scope: SessionScope;
  /** 缺省为当前时刻；必须回传（§12）。 */
  statsTime?: ISODateTime;
  /** 缺省为服务本地时区。 */
  timezone?: string;
};

/**
 * 统计只由本引擎与 SQL 产生（§12）；口径参数固定并回传：
 * params = { statsTime, timezone, dueBoundary }。
 */
export class StatisticsEngine {
  constructor(private readonly repository: MistakeRepository) {}

  async getStats(request: StatsRequest): Promise<MistakeStats> {
    const statsTime = request.statsTime ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(statsTime))) throw new Error("statsTime 时间非法");
    const timezone = request.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    assertTimeZone(timezone);
    const dueBoundary = endOfLocalDay(new Date(statsTime), timezone).toISOString();
    const stats = await this.repository.getStats(request.filter, request.scope, dueBoundary);
    return { ...stats, params: { statsTime, timezone, dueBoundary } };
  }

  async getReport(request: Omit<StatsRequest, "filter"> & { filter: MistakeReportFilter }): Promise<
    MistakeReport & { filter: MistakeReportFilter; params: { statsTime: ISODateTime; timezone: string } }
  > {
    const { filter, scope } = request;
    const statsTime = request.statsTime ?? new Date().toISOString();
    const timezone = request.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    assertTimeZone(timezone);
    if (!this.repository.getReport) throw new Error("当前仓储不支持快照报表");
    const result = await this.repository.getReport(filter, scope);
    return { ...result, filter, params: { statsTime, timezone } };
  }
}
