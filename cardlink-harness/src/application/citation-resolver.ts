import type { TurnEvidence } from "../domain/evidence.ts";
import type { SessionScope } from "../domain/session.ts";
import { RECORD_ID_PATTERN, extractRecordIdCandidates } from "../domain/mistake.ts";
import type { MistakeRecord } from "../domain/mistake.ts";
import type { MistakeRepository } from "./ports/mistake-repository.ts";
import { statisticValue } from "./statistic-evidence.ts";

/**
 * v2.4 §10.1.1（冻结）：用户可读引用协议解析与校验。
 *
 * 模型在回答正文用临时引用标记标注事实来源：
 * - `{{card:ref_N|recordId}}`——错题记录引用；
 * - `{{stat:ref_N|evidenceId|fieldPath}}`——从本轮证据读取并渲染数值。
 *
 * 校验链（全部确定性，无模型参与）：
 * 1. recordId 必须出现在本轮 TurnEvidence.recordIds（本 Run 已执行工具返回的证据）；
 * 2. 目标记录必须在本轮锁定快照中可解析（getById）且在会话授权范围内；
 * 3. evidenceId 必须命中本轮成功结果，数字字段必须在白名单内。
 *
 * 产出：
 * - CardCitation/StatCitation DTO（含真实卡片标题/分类/等级——标题只来自 CardLink 数据，
 *   不得由模型编造）；校验失败的引用 available:false，正文降级为「引用不可用」占位，
 *   不泄露内部 ID。
 * - displayText：标记重写为 Markdown 链接 `[《标题》](card:recordId)` / `[统计](stat:statsId)`，
 *   供前端 Markdown 渲染为可点击引用（urlTransform 已放行 card:/stat: 前缀）。
 *
 * b19-2（§10.1.1 加固）：
 * - 标题按 Markdown 链接文本转义（`\`/`[`/`]` 与换行），避免真实标题破坏链接结构；
 * - 裸 recordId 二次处理：正文里直接写出的内部 ID 不再原样透出——
 *   本轮证据内 → 重写为可点击标题引用；范围内可解析但未经本轮证据 → 标题 +「未校验来源」；
 *   无法解析 → 脱敏占位。代码块与行内代码不改写（示例文本保持原样）。
 */

export type CardCitation = {
  type: "card";
  ref: string;
  recordId: string;
  snapshotId: string;
  title: string;
  notebookTitle?: string;
  categoryPath?: string[];
  level?: number | null;
  reviewCompleted?: boolean;
  available: boolean;
  /** false = 正文提及但未经本轮工具证据（仅标题可读，不可点击打开）。 */
  verified?: boolean;
};

export type StatCitation = {
  type: "stat";
  ref: string;
  statsId: string;
  label: string;
  value?: number;
  available: boolean;
};

export type Citation = CardCitation | StatCitation;

export type CitationResolution = {
  /** 重写后的展示文本（标记 → 标题链接/降级占位）。 */
  displayText: string;
  citations: Citation[];
  /** 正文中被脱敏或降级的引用数量（裸 ID 未校验、伪造标记）；0 = 全部可核验。 */
  unresolved: number;
  unverifiedStatistics: number;
};

const MARKER_PATTERN = /\{\{(card|stat):((?:ref|link)_\d+)([^{}\r\n]*)\}\}/g;
const CARD_LINK_PATTERN = /\[(?:\\.|[^\[\]\\\n])*\]\(<?card:([0-9A-Za-z_.:-]+)>?\)/g;
/** 降级占位：不携带任何内部 ID（CR2 契约）。 */
const CARD_UNAVAILABLE = "（引用不可用）";
const STAT_UNAVAILABLE = "（统计来源不可用）";
const UNBOUND_STATISTIC = /(?:[+-]?(?:[0-9０-９]+(?:[.,，．][0-9０-９]+)*)|[零〇一二两三四五六七八九十百千万亿]+)\s*(?:道(?:错?题)?|条(?:错题|记录)|次(?:复习)?|(?:个)?百分点|[%％]|题)/g;
/** 裸 recordId 脱敏占位（无法解析为任何已授权记录）。 */
const BARE_UNRESOLVED = "（无法识别的卡片引用）";
/** 可解析但未经本轮证据的提醒后缀。 */
const UNVERIFIED_SUFFIX = "（未校验来源）";

/** 正文里的疑似 recordId（与 extractRecordIdCandidates 同口径，但保留位置信息）。 */
const BARE_ID_PATTERN = /[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}:[0-9A-Za-z][0-9A-Za-z_.:-]{5,127}/g;
/**
 * 裸 ID 不改写区域：围栏代码块、行内代码（示例文本）、引用标记本身（由标记替换处理）、
 * Markdown 链接目标（`](…)` 内的地址不属于正文）。
 */
const PROTECTED_PATTERN = /```[\s\S]*?```|`[^`\n]*`|\{\{[^{}]*\}\}|\]\([^)\s]*\)/g;

function excludedRanges(text: string, pattern = PROTECTED_PATTERN): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

function insideRanges(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([from, to]) => start < to && end > from);
}

/** Markdown 链接文本转义：反斜杠、方括号与换行。 */
export function escapeLinkText(text: string): string {
  return String(text ?? "").replace(/[\\\[\]|]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, " ");
}

function markerPayload(tail: string, kind: "card" | "stat"): string[] {
  if (/^\s*\\?\|/.test(tail)) {
    return tail.replace(/^\s*\\?\|/, "").split(/\\?\|/).map((part) => part.trim());
  }
  if (!/^\s/.test(tail) || !tail.trim()) return [];
  return kind === "card" ? [tail.trim()] : tail.trim().split(/\s+/);
}

function normalizedTitle(title: string): string {
  return title.normalize("NFKC").trim().replace(/^《(.+)》$/, "$1").replace(/\s+/g, " ");
}

/**
 * 裸 recordId 是否值得处理：形态合法、非纯数字时间戳、非 URL。
 * 与 extractRecordIdCandidates 的过滤条件一致。
 */
function isBareIdCandidate(token: string): boolean {
  return RECORD_ID_PATTERN.test(token) && !/^[0-9.]+:[0-9.]+$/.test(token) && !token.includes("://");
}

function cardLink(citation: CardCitation): string {
  return `[《${escapeLinkText(citation.title)}》](card:${citation.recordId})`;
}

export class CitationResolver {
  constructor(private readonly repository: MistakeRepository) {}

  async resolve(text: string, evidence: TurnEvidence, scope: SessionScope): Promise<CitationResolution> {
    // Only the resolver can emit a clickable stat target. Raw model links can copy a valid evidence ID.
    const modelText = String(text ?? "").replace(/stat:/gi, (part: string, offset: number, input: string) =>
      input.slice(Math.max(0, offset - 2), offset) === "{{" ? part : "stat：",
    );
    const codeRanges = excludedRanges(modelText, /```[\s\S]*?```|`[^`\n]*`/g);
    let linkCount = 0;
    const raw = modelText.replace(CARD_LINK_PATTERN, (link: string, recordId: string, offset: number) =>
      insideRanges(codeRanges, offset, offset + link.length) ? link : `{{card:link_${++linkCount}|${recordId}}}`,
    );
    const protectedRanges = excludedRanges(raw);
    let unverifiedStatistics = 0;
    const source = raw.replace(UNBOUND_STATISTIC, (claim: string, offset: number) => {
      if (insideRanges(protectedRanges, offset, offset + claim.length) || /第\s*$/.test(raw.slice(0, offset))) return claim;
      unverifiedStatistics++;
      return `${claim}（数值未核验）`;
    });
    // 快路径：既无引用标记、也无疑似 recordId → 原样返回（不触发任何查询）。
    if (!source.includes("{{") && extractRecordIdCandidates(source).length === 0) {
      return { displayText: source, citations: [], unresolved: 0, unverifiedStatistics };
    }

    // 临时编号仅供模型排版，证据来源与字段决定唯一性。
    const citations = new Map<string, Citation>();
    const markers = new Map<string, Citation>();
    const byRecordId = new Map<string, CardCitation>();
    const declarations = new Map<string, Map<string, Citation>>();
    const shortcuts = new Map<string, string>();
    const repo = this.repository.forSnapshot?.(evidence.snapshotId) ?? this.repository;
    const readIds = new Set(evidence.recordIds);
    const recordCache = new Map<string, Promise<MistakeRecord | null>>();
    const readRecord = (id: string) => {
      const cached = recordCache.get(id);
      if (cached) return cached;
      const pending = repo.getById(id, scope);
      recordCache.set(id, pending);
      return pending;
    };
    let recordsByTitle: Map<string, MistakeRecord | null> | undefined;
    const resolveRecord = async (target: string): Promise<MistakeRecord | null> => {
      if (!target) return null;
      if (readIds.has(target)) return readRecord(target);
      if (RECORD_ID_PATTERN.test(target)) return null;
      if (!recordsByTitle) {
        recordsByTitle = new Map();
        for (const id of readIds) {
          const record = await readRecord(id);
          if (!record?.sourceTitle) continue;
          const title = normalizedTitle(record.sourceTitle);
          recordsByTitle.set(title, recordsByTitle.has(title) ? null : record);
        }
      }
      return recordsByTitle.get(normalizedTitle(target)) ?? null;
    };
    for (const match of source.matchAll(MARKER_PATTERN)) {
      const kind = match[1] as "card" | "stat";
      const parts = markerPayload(match[3], kind);
      const declaredRef = `${kind}:${match[2]}`;
      if (!match[3].trim() || (parts.length === 1 && /^ref_\d+$/.test(parts[0]))) {
        shortcuts.set(match[0], parts.length ? `${kind}:${parts[0]}` : declaredRef);
        continue;
      }
      const record = kind === "card" && parts.length === 1 ? await resolveRecord(parts[0]) : null;
      const key = JSON.stringify([kind, ...(record ? [record.recordId] : parts)]);
      let citation = citations.get(key);
      if (!citation) {
        const ref = `ref_${citations.size + 1}`;
        citation = kind === "card"
          ? this.cardCitation(ref, record, evidence.snapshotId)
          : this.resolveStat(ref, parts, evidence);
        citations.set(key, citation);
        if (citation.type === "card" && citation.available) byRecordId.set(citation.recordId, citation);
      }
      markers.set(match[0], citation);
      const targets = declarations.get(declaredRef) ?? new Map<string, Citation>();
      targets.set(key, citation);
      declarations.set(declaredRef, targets);
    }
    for (const [marker, shortcut] of shortcuts) {
      const targets = declarations.get(shortcut);
      if (targets?.size !== 1) continue;
      const citation = targets.values().next().value;
      if (citation?.available) markers.set(marker, citation);
    }
    // 第二遍：裸 recordId（代码/标记/链接目标之外）→ 标题化 / 未校验提示 / 脱敏。
    // 先于标记替换执行：此时文本里只有模型原文，不会误伤新生成的标题链接。
    const excluded = excludedRanges(source);
    const bareMatches = [...source.matchAll(BARE_ID_PATTERN)];
    const bareCache = new Map<string, string>();
    let unresolved = 0;
    let bareSeq = 0;
    let rewritten = "";
    let cursor = 0;
    for (const match of bareMatches) {
      const token = match[0];
      const offset = match.index ?? 0;
      if (insideRanges(excluded, offset, offset + token.length)) continue;
      if (!isBareIdCandidate(token)) continue;
      const cached = bareCache.get(token);
      const replacement = cached ?? await this.bareReplacement(
        token,
        evidence,
        scope,
        repo,
        citations,
        byRecordId,
        () => `bare_${++bareSeq}`,
        () => { unresolved += 1; },
      );
      bareCache.set(token, replacement);
      rewritten += source.slice(cursor, offset) + replacement;
      cursor = offset + token.length;
    }
    rewritten += source.slice(cursor);

    // 第三遍：重写引用标记（标记 → 标题链接/降级占位）。
    const displayText = rewritten.replace(MARKER_PATTERN, (raw, kind: string) => {
      const citation = markers.get(raw);
      if (kind === "card") {
        if (citation?.type === "card" && citation.available) return cardLink(citation);
        unresolved++;
        return CARD_UNAVAILABLE;
      }
      if (citation?.type === "stat" && citation.available) return `[${citation.value}](stat:${citation.statsId})`;
      unverifiedStatistics++;
      return STAT_UNAVAILABLE;
    });
    return {
      displayText,
      citations: [...citations.values()],
      unresolved,
      unverifiedStatistics,
    };
  }

  /** 单个裸 recordId 的展示替换（并登记可点击引用）。 */
  private async bareReplacement(
    token: string,
    evidence: TurnEvidence,
    scope: SessionScope,
    repo: MistakeRepository,
    citations: Map<string, Citation>,
    byRecordId: Map<string, CardCitation>,
    nextRef: () => string,
    markUnresolved: () => void,
  ): Promise<string> {
    const known = byRecordId.get(token);
    if (known) return cardLink(known);
    const record = await repo.getById(token, scope);
    if (!record) {
      markUnresolved();
      return BARE_UNRESOLVED;
    }
    const title = record.sourceTitle || "未命名错题";
    // 授权范围内存在，但不是本轮工具证据：标题可读、不可作为来源点击。
    if (!evidence.recordIds.includes(token)) {
      markUnresolved();
      return `《${escapeLinkText(title)}》${UNVERIFIED_SUFFIX}`;
    }
    const citation: CardCitation = {
      type: "card",
      ref: nextRef(),
      recordId: token,
      snapshotId: evidence.snapshotId,
      title: record.sourceTitle || token,
      notebookTitle: record.sourceNotebookTitle || undefined,
      categoryPath: record.categoryPath?.length ? record.categoryPath : undefined,
      level: record.level ?? null,
      reviewCompleted: record.reviewCompleted,
      available: true,
      verified: true,
    };
    citations.set(citation.ref, citation);
    byRecordId.set(token, citation);
    return cardLink(citation);
  }

  private resolveStat(ref: string, parts: string[], evidence: TurnEvidence): StatCitation {
    const [statsId, path] = parts;
    const result = evidence.statistics.find((item) => item.evidenceId === statsId || item.ref === statsId);
    if (result && path && parts.length === 2) {
      const resolved = statisticValue(result, path);
      if (resolved) return { type: "stat", ref, statsId: result.evidenceId, ...resolved, available: true };
    }
    return { type: "stat", ref, statsId: "", label: "统计来源不可用", available: false };
  }

  private cardCitation(ref: string, record: MistakeRecord | null, snapshotId: string): CardCitation {
    if (!record) {
      return {
        type: "card",
        ref,
        recordId: "",
        snapshotId,
        title: "",
        available: false,
      };
    }
    return {
      type: "card",
      ref,
      recordId: record.recordId,
      snapshotId,
      title: record.sourceTitle || record.recordId,
      notebookTitle: record.sourceNotebookTitle || undefined,
      categoryPath: record.categoryPath?.length ? record.categoryPath : undefined,
      level: record.level ?? null,
      reviewCompleted: record.reviewCompleted,
      available: true,
      verified: true,
    };
  }
}
