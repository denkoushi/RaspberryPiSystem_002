import type { PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ScawStFutekigoReadService } from '../scaw-stfutekigo/scaw-stfutekigo-read.service.js';
import { normalizeWorkInstructionPartNumber, normalizeWorkInstructionShootingTarget } from '../work-instructions/domain/normalization.js';
import type { WorkInstructionGroupSummaryView, WorkInstructionGroupView, WorkInstructionStepView } from '../work-instructions/domain/types.js';
import { WorkInstructionReadService } from '../work-instructions/work-instruction-read.service.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';

export const BUSINESS_HERMES_MCP_TOOL_NAMES = [
  'business_hermes_describe_sources',
  'business_hermes_search',
  'business_hermes_get_detail'
] as const;

export type BusinessHermesMcpToolName = (typeof BUSINESS_HERMES_MCP_TOOL_NAMES)[number];

export type BusinessHermesMcpTool = {
  name: BusinessHermesMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type BusinessHermesMcpResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type MpcDeps = {
  db?: PrismaClient;
  nonconformities?: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  workInstructions?: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup' | 'searchPublishedGroups'>;
};

const MAX_LIMIT = 20;
const MAX_QUERY_CHARS = 200;

const TOOLS: ReadonlyArray<BusinessHermesMcpTool> = [
  {
    name: 'business_hermes_describe_sources',
    description: 'Describe the authorized read-only business sources and their bounded result semantics.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'business_hermes_search',
    description: 'Search active latest nonconformities and PUBLIC work-instruction text using literal case-insensitive substring matching across the selected fields. Spaces are literal characters, not AND keywords; start with one concise term and refine with identifiers, dates, or a narrower term. Results never include private paths or case history.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: MAX_QUERY_CHARS },
        partNumber: { type: 'string', maxLength: 200 },
        shootingTarget: { type: 'string', maxLength: 200 },
        nonconformityNo: { type: 'string', maxLength: 120 },
        condition: { type: 'string', maxLength: MAX_QUERY_CHARS },
        dateFrom: { type: 'string', maxLength: 10 },
        dateTo: { type: 'string', maxLength: 10 },
        kind: { type: 'string', enum: ['nonconformity', 'work_instruction', 'both'] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        nonconformityOffset: { type: 'integer', minimum: 0, maximum: 100_000 },
        workInstructionOffset: { type: 'integer', minimum: 0, maximum: 100_000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'business_hermes_get_detail',
    description: 'Get bounded detail for one active nonconformity or PUBLIC work-instruction record.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['nonconformity', 'work_instruction'] },
        id: { type: 'string', minLength: 1, maxLength: 200 },
        partNumber: { type: 'string', maxLength: 200 },
        shootingTarget: { type: 'string', maxLength: 200 }
      },
      required: ['kind'],
      additionalProperties: false
    }
  }
];

function text(value: unknown, max = MAX_QUERY_CHARS): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return normalized || null;
}

function safeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 10;
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

function safeOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(100_000, value);
}

function parseDateBound(value: string | null, endOfDay: boolean): Date | null | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function jsonText(value: unknown): BusinessHermesMcpResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function publicStep(
  step: WorkInstructionStepView,
  sourceModified: Date,
  source: { system: string; list: string; itemId: number },
  partNumber: string,
  shootingTarget: string,
  publication?: WorkInstructionGroupView['rows'][number]['publication']
) {
  // memoOverride is an effective public edited memo. Do not concatenate it
  // with the immutable import text; an empty override is meaningful.
  const effectiveText = step.memoOverride !== undefined ? step.memoOverride : step.text;
  return {
    id: step.id,
    step: step.step,
    effectiveText,
    publicEdited: step.memoOverride !== undefined,
    sourceVersionDate: sourceModified.toISOString(),
    source,
    sourceUrl: `/kiosk/part-measurement/self-inspection?partNumber=${encodeURIComponent(partNumber)}&shootingTarget=${encodeURIComponent(shootingTarget)}`,
    ...(publication ? {
      publication: {
        publishedVersionId: publication.publishedVersionId,
        publishedVersionCreatedAt: publication.publishedVersionCreatedAt.toISOString(),
        publishedRevisionId: publication.publishedRevisionId,
        publishedRevisionCreatedAt: publication.publishedRevisionCreatedAt?.toISOString() ?? null
      },
      publishedVersionId: publication.publishedVersionId,
      publishedVersionCreatedAt: publication.publishedVersionCreatedAt.toISOString(),
      publishedRevisionId: publication.publishedRevisionId,
      publishedRevisionCreatedAt: publication.publishedRevisionCreatedAt?.toISOString() ?? null
    } : {}),
    imageAssetId: step.imageAssetId,
    imageMimeType: step.imageMimeType,
    imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
    rawImageLabel: step.imageAssetId ? '元写真（公開作業要領）' : null,
    overlays: step.overlays ?? []
  };
}

function workInstructionResult(group: WorkInstructionGroupView) {
  return {
    kind: 'work_instruction' as const,
    id: group.rows[0]?.id ?? null,
    partNumber: group.partNumber,
    shootingTarget: group.shootingTarget,
    public: true,
    rows: group.rows.map((row) => ({
      id: row.id,
      source: row.source,
      sourceVersionDate: row.source.modified.toISOString(),
      ...(row.publication ? {
        publication: {
          publishedVersionId: row.publication.publishedVersionId,
          publishedVersionCreatedAt: row.publication.publishedVersionCreatedAt.toISOString(),
          publishedRevisionId: row.publication.publishedRevisionId,
          publishedRevisionCreatedAt: row.publication.publishedRevisionCreatedAt?.toISOString() ?? null
        }
      } : {}),
      steps: row.steps.map((step) => publicStep(step, row.source.modified, row.source, group.partNumber, group.shootingTarget, row.publication))
    }))
  };
}

export class BusinessHermesMcpService {
  private readonly db: PrismaClient;
  private readonly nonconformities: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
  private readonly workInstructions: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup' | 'searchPublishedGroups'>;

  constructor(deps: MpcDeps = {}) {
    this.db = deps.db ?? prisma;
    this.nonconformities = deps.nonconformities ?? new ScawStFutekigoReadService();
    this.workInstructions = deps.workInstructions ?? getWorkInstructionServices().read;
  }

  listTools(): ReadonlyArray<BusinessHermesMcpTool> {
    return TOOLS;
  }

  async call(name: string, rawArgs: unknown): Promise<BusinessHermesMcpResult> {
    if (!BUSINESS_HERMES_MCP_TOOL_NAMES.includes(name as BusinessHermesMcpToolName)) {
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    }
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs as Record<string, unknown> : {};
    if (name === 'business_hermes_describe_sources') return jsonText(this.describeSources());
    if (name === 'business_hermes_search') return jsonText(await this.search(args));
    return jsonText(await this.detail(args));
  }

  private describeSources() {
    return {
      sources: [
        {
          kind: 'nonconformity',
          description: 'Historical nonconformity records present in the latest import (isPresentInLatestSnapshot=true). These are not published work instructions or evidence of a defect in the current consultation.',
          fields: ['id', 'nonconformityNo', 'partNumber', 'partName', 'machineName', 'condition', 'remarks', 'disposition', 'correctiveContent', 'discoveredOn', 'sourceVersionDate', 'provenance'],
          fieldMeanings: { condition: '不適合内容', correctiveContent: '個別是正内容1・2。処置内容欄とは別項目', disposition: '処置内容。空欄は未記録であり処置未実施を意味しない', remarks: '備考', discoveredOn: '発見日。dateFrom/dateToはこの日を絞る', sourceVersionDate: '元データ更新日', machineName: '記録された機械名。要領書の対象工程とは同一とは限らない' }
        },
        {
          kind: 'work_instruction',
          description: 'PUBLIC WorkInstructionSourcePublication pointer and its effective published revision.',
          fields: ['id', 'partNumber', 'shootingTarget', 'source', 'sourceVersionDate', 'publishedVersionId', 'publishedVersionCreatedAt', 'publishedRevisionId', 'publishedRevisionCreatedAt', 'steps.effectiveText', 'steps.imageAssetId', 'steps.imageUrl'],
          rules: ['latest imported drafts are excluded', 'sourceVersionDate is the immutable source modified date; publishedVersionCreatedAt and publishedRevisionCreatedAt identify public publication provenance', 'memoOverride replaces source text, including an empty override', 'only ACTIVE image assets are exposed']
        }
      ],
      limits: { maxResults: MAX_LIMIT, maxQueryChars: MAX_QUERY_CHARS },
      searchSemantics: 'query and condition use literal case-insensitive substring matching; spaces are literal characters, not AND keywords. Start with one concise term, then refine with identifiers, dates, or a narrower term.',
      authorization: 'Existing API read visibility and publication/active-asset rules remain authoritative.'
    };
  }

  private async search(args: Record<string, unknown>) {
    const query = text(args.query);
    const partNumber = normalizeWorkInstructionPartNumber(text(args.partNumber, 200));
    const shootingTarget = normalizeWorkInstructionShootingTarget(text(args.shootingTarget, 200));
    const nonconformityNo = text(args.nonconformityNo, 120);
    const condition = text(args.condition);
    const dateFrom = text(args.dateFrom, 10);
    const dateTo = text(args.dateTo, 10);
    const dateFromBound = parseDateBound(dateFrom, false);
    const dateToBound = parseDateBound(dateTo, true);
    if (dateFrom !== null && dateFromBound === null) return { error: 'dateFrom must be a valid YYYY-MM-DD date' };
    if (dateTo !== null && dateToBound === null) return { error: 'dateTo must be a valid YYYY-MM-DD date' };
    if (dateFromBound && dateToBound && dateFromBound > dateToBound) return { error: 'dateFrom must be on or before dateTo' };
    const kind = args.kind === 'nonconformity' || args.kind === 'work_instruction' ? args.kind : 'both';
    const limit = safeLimit(args.limit);
    const nonconformityOffset = safeOffset(args.nonconformityOffset);
    const workInstructionOffset = safeOffset(args.workInstructionOffset);
    const results: unknown[] = [];
    let nonconformityTotal = 0;

    if (kind === 'nonconformity' || kind === 'both') {
      const where: Record<string, unknown> = {
        isPresentInLatestSnapshot: true,
        ...(partNumber ? { partNumber } : {}),
        ...(nonconformityNo ? { nonconformityNo } : {}),
        ...(dateFromBound || dateToBound ? { discoveredOn: { ...(dateFromBound ? { gte: dateFromBound } : {}), ...(dateToBound ? { lte: dateToBound } : {}) } } : {}),
        ...(query ? {
          OR: [
            { nonconformityNo: { contains: query, mode: 'insensitive' } },
            { partNumber: { contains: query, mode: 'insensitive' } },
            { nonconformityContent: { contains: query, mode: 'insensitive' } },
            { remarks: { contains: query, mode: 'insensitive' } },
            { correctiveContent1: { contains: query, mode: 'insensitive' } },
            { correctiveContent2: { contains: query, mode: 'insensitive' } },
            { dispositionContent: { contains: query, mode: 'insensitive' } },
            { partName: { contains: query, mode: 'insensitive' } },
            { machineName: { contains: query, mode: 'insensitive' } }
          ]
        } : {}),
        ...(condition ? { nonconformityContent: { contains: condition, mode: 'insensitive' } } : {})
      };
      const rows = await this.db.scawStfutekigoCurrent.findMany({
        where,
        orderBy: [{ discoveredOn: 'desc' }, { nonconformityNo: 'desc' }],
        skip: nonconformityOffset,
        take: limit,
        select: {
          id: true,
          nonconformityNo: true,
          partNumber: true,
          partName: true,
          machineName: true,
          discoveredOn: true,
          nonconformityContent: true,
          remarks: true,
          correctiveContent1: true,
          correctiveContent2: true,
          dispositionContent: true,
          sourceUpdatedOn: true
        }
      });
      nonconformityTotal = await this.db.scawStfutekigoCurrent.count({ where });
      results.push(...rows.map((row) => ({
        kind: 'nonconformity' as const,
        id: row.id,
        nonconformityNo: row.nonconformityNo,
        partNumber: row.partNumber,
        partName: row.partName,
        machineName: row.machineName,
        condition: row.nonconformityContent,
        remarks: row.remarks,
        correctiveContent: [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null,
        disposition: row.dispositionContent,
        discoveredOn: row.discoveredOn?.toISOString().slice(0, 10) ?? null,
        sourceVersionDate: row.sourceUpdatedOn?.toISOString().slice(0, 10) ?? null,
        provenance: { source: 'ScawStfutekigoCurrent', activeLatest: true, meaning: '不適合の発生状況と記録済みの対処を確認する情報源。' }
      })));
    }

    let truncated = false;
    const workInstructionResults: unknown[] = [];
    const workInstructionResultOffsets: number[] = [];
    let workInstructionTotal = 0;
    let workInstructionTotalKnown = false;
    let workInstructionPageSize = 0;
    if (kind === 'work_instruction' || kind === 'both') {
      const summaries: Array<{ summary: WorkInstructionGroupSummaryView; offset: number }> = [];
      if (query) {
        const page = await this.workInstructions.searchPublishedGroups({
          query,
          partNumber: partNumber ?? undefined,
          shootingTarget: shootingTarget ?? undefined,
          limit,
          offset: workInstructionOffset
        });
        summaries.push(...page.groups.map((summary, index) => ({ summary, offset: workInstructionOffset + index })));
        workInstructionTotal = page.total;
        workInstructionTotalKnown = true;
        truncated = page.hasMore;
      } else {
        // Empty query is a bounded catalog page. It must not scan every group
        // just to discover that a user has not yet supplied search text.
        const page = await this.workInstructions.readPublishedGroups({
          partNumber: partNumber ?? undefined,
          shootingTarget: shootingTarget ?? undefined,
          limit: limit + 1,
          offset: workInstructionOffset
        });
        summaries.push(...page.slice(0, limit).map((summary, index) => ({ summary, offset: workInstructionOffset + index })));
        truncated = page.length > limit;
      }
      workInstructionPageSize = summaries.length;
      for (const { summary, offset: summaryOffset } of summaries) {
        const group = await this.workInstructions.readPublishedGroup({ partNumber: summary.partNumber, shootingTarget: summary.shootingTarget });
        if (!group) continue;
        workInstructionResults.push(workInstructionResult(group));
        workInstructionResultOffsets.push(summaryOffset);
      }
    }
    if (!workInstructionTotalKnown) workInstructionTotal = workInstructionResults.length;
    const visibleResults: unknown[] = [];
    if (kind === 'both') {
      // Keep both sources visible when one source has many matches instead of
      // letting the first source consume the entire bounded response.
      for (let index = 0; visibleResults.length < limit && (index < results.length || index < workInstructionResults.length); index += 1) {
        if (results[index] !== undefined && visibleResults.length < limit) visibleResults.push(results[index]);
        if (workInstructionResults[index] !== undefined && visibleResults.length < limit) visibleResults.push(workInstructionResults[index]);
      }
    } else {
      visibleResults.push(...(kind === 'nonconformity' ? results : workInstructionResults).slice(0, limit));
    }
    const visibleNonconformityCount = visibleResults.filter((result) => (result as { kind?: string }).kind === 'nonconformity').length;
    const visibleWorkInstructionCount = visibleResults.filter((result) => (result as { kind?: string }).kind === 'work_instruction').length;
    const nonconformityHasMore = nonconformityTotal > nonconformityOffset + visibleNonconformityCount;
    const workInstructionHasMore = truncated || (workInstructionTotalKnown
      ? workInstructionTotal > workInstructionOffset + visibleWorkInstructionCount
      : workInstructionResults.length > visibleWorkInstructionCount);
    // Text-search pages have a global count; bounded catalog pages expose
    // only the count loaded for this page and therefore keep total unknown.
    const totalKnown = workInstructionTotalKnown || (!truncated && workInstructionOffset === 0);
    const total = totalKnown
      ? kind === 'both' ? nonconformityTotal + workInstructionTotal : kind === 'nonconformity' ? nonconformityTotal : workInstructionTotal
      : null;
    // Cursor points at the first matching group not returned in this page.
    // This matters when `both` fills the page with NC rows first.
    const nextWorkInstructionResultOffset = workInstructionResultOffsets[visibleWorkInstructionCount];
    const workInstructionCursor = workInstructionHasMore
      ? nextWorkInstructionResultOffset === undefined
        ? workInstructionOffset + workInstructionPageSize
        : nextWorkInstructionResultOffset
      : null;
    return {
      results: visibleResults,
      total,
      limit,
      truncated: Boolean(truncated || nonconformityHasMore || workInstructionHasMore),
      hasMore: {
        nonconformity: kind !== 'work_instruction' && nonconformityHasMore,
        workInstruction: kind !== 'nonconformity' && workInstructionHasMore
      },
      nextCursor: {
        nonconformityOffset: nonconformityHasMore ? nonconformityOffset + visibleNonconformityCount : null,
        workInstructionOffset: workInstructionCursor
      },
      ...(kind !== 'nonconformity' && (!totalKnown || workInstructionOffset > 0) ? {
        scannedMatches: { workInstruction: workInstructionTotal }
      } : {})
    };
  }

  private async detail(args: Record<string, unknown>) {
    const kind = args.kind === 'work_instruction' ? args.kind : args.kind === 'nonconformity' ? args.kind : null;
    if (!kind) return { error: 'kind must be nonconformity or work_instruction' };
    const id = text(args.id, 200);
    if (kind === 'nonconformity') {
      if (!id) return { error: 'id is required for nonconformity detail' };
      const row = await this.db.scawStfutekigoCurrent.findFirst({
        where: { isPresentInLatestSnapshot: true, ...(id ? { OR: [{ id }, { nonconformityNo: id }] } : {}) },
        select: {
          id: true,
          nonconformityNo: true,
          partNumber: true,
          partName: true,
          machineName: true,
          discoveredOn: true,
          nonconformityContent: true,
          remarks: true,
          correctiveContent1: true,
          correctiveContent2: true,
          dispositionContent: true,
          sourceUpdatedOn: true
        }
      });
      return row ? {
        kind,
        id: row.id,
        nonconformityNo: row.nonconformityNo,
        partNumber: row.partNumber,
        partName: row.partName,
        machineName: row.machineName,
        condition: row.nonconformityContent,
        remarks: row.remarks,
        correctiveContent: [row.correctiveContent1, row.correctiveContent2].filter(Boolean).join('\n') || null,
        disposition: row.dispositionContent,
        discoveredOn: row.discoveredOn?.toISOString().slice(0, 10) ?? null,
        sourceVersionDate: row.sourceUpdatedOn?.toISOString().slice(0, 10) ?? null,
        provenance: { source: 'ScawStfutekigoCurrent', activeLatest: true, meaning: '不適合の発生状況と記録済みの対処を確認する情報源。' }
      } : { result: null };
    }

    let partNumber = normalizeWorkInstructionPartNumber(text(args.partNumber, 200));
    let shootingTarget = normalizeWorkInstructionShootingTarget(text(args.shootingTarget, 200));
    if ((!partNumber || !shootingTarget) && id) {
      const publication = await this.db.workInstructionSourcePublication.findUnique({ where: { rowId: id }, select: { publishedVersion: { select: { partNumber: true, shootingTarget: true } } } });
      const row = publication?.publishedVersion;
      partNumber = normalizeWorkInstructionPartNumber(row?.partNumber ?? null);
      shootingTarget = normalizeWorkInstructionShootingTarget(row?.shootingTarget ?? null);
    }
    if (!partNumber || !shootingTarget) return { error: 'partNumber and shootingTarget are required for work_instruction detail' };
    const group = await this.workInstructions.readPublishedGroup({ partNumber, shootingTarget });
    if (!group || (id && !group.rows.some((row) => row.id === id))) return { result: null };
    return workInstructionResult(group);
  }
}
