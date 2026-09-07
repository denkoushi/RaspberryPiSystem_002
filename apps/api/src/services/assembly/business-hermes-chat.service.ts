import {
  BusinessHermesService,
  type BusinessHermesChatIntent,
  type BusinessHermesChatMessage,
  type BusinessHermesChatResult
} from './business-hermes.service.js';
import { ScawStFutekigoReadService, type ScawStFutekigoReadItem } from '../scaw-stfutekigo/scaw-stfutekigo-read.service.js';
import { normalizeWorkInstructionPartNumber, normalizeWorkInstructionShootingTarget } from '../work-instructions/domain/normalization.js';
import type { WorkInstructionGroupView, WorkInstructionGroupSummaryView } from '../work-instructions/domain/types.js';
import { WorkInstructionReadService } from '../work-instructions/work-instruction-read.service.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';

export const BUSINESS_HERMES_CHAT_SCOPES = ['nonconformity', 'work_instruction', 'both'] as const;
export type BusinessHermesChatScope = (typeof BUSINESS_HERMES_CHAT_SCOPES)[number];

export type BusinessHermesChatUserMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type BusinessHermesChatEvidence = {
  kind: 'nonconformity' | 'work_instruction';
  id: string;
  title: string;
  partNumber: string;
  shootingTarget?: string;
  step?: number;
  text: string;
  imageUrl?: string;
  imageMimeType?: string;
};

export type BusinessHermesChatInput = {
  messages: BusinessHermesChatUserMessage[];
  scope: BusinessHermesChatScope;
  partNumber?: string;
  shootingTarget?: string;
};

export type BusinessHermesChatResponse = BusinessHermesChatResult & {
  evidence: ReadonlyArray<BusinessHermesChatEvidence>;
  partNumber: string | null;
  shootingTarget: string | null;
  needsClarification: boolean;
  clarificationMessage: string | null;
};

type ChatDeps = {
  hermes?: Pick<BusinessHermesService, 'chat' | 'classifyChat'>;
  workInstructions?: Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup'>;
  nonconformities?: Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;
};

const MAX_CHAT_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_NONCONFORMITY_EVIDENCE_ITEMS = 8;
const MAX_WORK_INSTRUCTION_EVIDENCE_ITEMS = 16;
const MAX_EVIDENCE_ITEMS = MAX_NONCONFORMITY_EVIDENCE_ITEMS + MAX_WORK_INSTRUCTION_EVIDENCE_ITEMS;
const MAX_EVIDENCE_TEXT_CHARS = 1_500;
// Keep the complete EVIDENCE JSON below the BusinessHermesService system
// message limit. Items are dropped at object boundaries so JSON is never cut
// in the middle of a protected image reference or evidence record.
const MAX_CHAT_SYSTEM_CONTEXT_CHARS = 30_000;

function cleanEvidenceText(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n').replace(/\s+/g, ' ').trim().slice(0, MAX_EVIDENCE_TEXT_CHARS);
}

function normalizedUserSearchText(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
}

function valueAppearsInUserTurns(value: string | null, messages: ReadonlyArray<BusinessHermesChatUserMessage>, normalize: (value: string | null) => string | null): boolean {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return false;
  const searchValue = normalizedUserSearchText(normalizedValue);
  return messages.some((message) => normalizedUserSearchText(message.content).includes(searchValue));
}

function valueAppearsInLatestUserTurn(value: string | null, messages: ReadonlyArray<BusinessHermesChatUserMessage>, normalize: (value: string | null) => string | null): boolean {
  const latest = messages[messages.length - 1];
  return latest ? valueAppearsInUserTurns(value, [latest], normalize) : false;
}

function hasNewPartNumberInLatestTurn(messages: ReadonlyArray<BusinessHermesChatUserMessage>, partNumber: string | null): boolean {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  if (!normalizedPartNumber || messages.length < 2) return false;
  const expected = normalizedUserSearchText(normalizedPartNumber);
  const partCandidates = (value: string): string[] => value.normalize('NFKC').toUpperCase().match(/[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*/g) ?? [];
  const latestCandidates = partCandidates(messages[messages.length - 1]?.content ?? '');
  if (!latestCandidates.some((candidate) => normalizedUserSearchText(candidate) === expected)) return false;
  const previousCandidates = messages.slice(0, -1).flatMap((message) => partCandidates(message.content));
  return previousCandidates.some((candidate) => normalizedUserSearchText(candidate) !== expected);
}

function latestTurnContainsOtherPartNumber(messages: ReadonlyArray<BusinessHermesChatUserMessage>, partNumber: string | null): boolean {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  if (!normalizedPartNumber || messages.length === 0) return false;
  const expected = normalizedUserSearchText(normalizedPartNumber);
  const candidates = messages[messages.length - 1]?.content.normalize('NFKC').toUpperCase().match(/[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*/g) ?? [];
  return candidates
    .filter((candidate) => candidate.length >= 5 || candidate.includes('-') || candidate.includes('_'))
    .some((candidate) => normalizedUserSearchText(candidate) !== expected);
}

function nonconformityEvidence(item: ScawStFutekigoReadItem, partNumber: string): BusinessHermesChatEvidence {
  return {
    kind: 'nonconformity',
    id: item.id,
    title: '不適合情報',
    partNumber,
    text: cleanEvidenceText([
      item.partName,
      item.machineName,
      item.nonconformityContent,
      item.dispositionContent,
      item.correctiveContent1,
      item.correctiveContent2,
      item.remarks,
      item.originDepartmentName,
      item.discoveredOn
    ])
  };
}

function workInstructionEvidence(group: WorkInstructionGroupView, partNumber: string, shootingTarget: string): BusinessHermesChatEvidence[] {
  return group.steps.map((step) => ({
    kind: 'work_instruction',
    id: step.id,
    title: `作業要領 手順${step.step}`,
    partNumber,
    shootingTarget,
    step: step.step,
    text: cleanEvidenceText([step.memoOverride ?? null, step.text]),
    ...(step.imageAssetId ? {
      imageUrl: `/api/work-instructions/assets/${encodeURIComponent(step.imageAssetId)}`,
      imageMimeType: step.imageMimeType ?? undefined
    } : {})
  }));
}

function targetClarification(partNumber: string, targets: ReadonlyArray<WorkInstructionGroupSummaryView>): string {
  const names = targets.map((target) => target.shootingTarget).filter(Boolean).slice(0, 8);
  if (names.length === 0) return `品番 ${partNumber} の作業要領に対象が見つかりません。対象を指定してください。`;
  return `品番 ${partNumber} の対象を指定してください（${names.join('、')}）。`;
}

function fitEvidenceToSystemBudget(input: {
  prefix: string;
  evidence: ReadonlyArray<BusinessHermesChatEvidence>;
}): ReadonlyArray<BusinessHermesChatEvidence> {
  const selected: BusinessHermesChatEvidence[] = [];
  const fits = (candidate: ReadonlyArray<BusinessHermesChatEvidence>): boolean =>
    `${input.prefix}\nEVIDENCE=${JSON.stringify(candidate)}`.length <= MAX_CHAT_SYSTEM_CONTEXT_CHARS;

  // Both source kinds must remain visible when both were requested. Then fill
  // the remaining budget in read order without slicing serialized JSON.
  for (const kind of ['nonconformity', 'work_instruction'] as const) {
    const first = input.evidence.find((item) => item.kind === kind);
    if (first && fits([...selected, first])) selected.push(first);
  }
  for (const item of input.evidence) {
    if (selected.includes(item)) continue;
    if (!fits([...selected, item])) break;
    selected.push(item);
  }
  return selected;
}

function buildSystemMessage(input: {
  scope: BusinessHermesChatScope;
  partNumber: string | null;
  shootingTarget: string | null;
  clarificationMessage: string | null;
  evidence: ReadonlyArray<BusinessHermesChatEvidence>;
}): string {
  const prefix = [
    'あなたは現場オペレータを支援する業務Hermesです。日本語で短く回答してください。',
    '業務情報については、EVIDENCE に含まれる根拠本文だけを使い、推測・創作・外部検索をしないでください。',
    '品番または対象が不足・曖昧な場合は、回答を作らず clarificationMessage の内容を聞き返してください。',
    '不適合情報と作業要領を混同せず、画像は根拠カードとして別表示されるためURLを創作しないでください。',
    '作業要領の手順番号はEVIDENCEのstep値とtitleを出典どおりに扱い、並べ替え・再採番・連番化しないでください。同じ手順番号の複数レコードは別々の根拠として保持してください。',
    'step値が欠落または不明な場合は番号を補わず、手順番号不明と明示してください。手順本文や条件を再構成せず、詳細は表示される根拠カードを案内してください。',
    '作業要領については本文で手順番号・O番号・数値・条件を要約または列挙せず、「作業要領は表示中の根拠カードを確認してください。」と案内してください。EVIDENCEの複数レコードを結合して別の手順や条件を作らないでください。',
    `scope=${input.scope}; partNumber=${input.partNumber ?? '未特定'}; shootingTarget=${input.shootingTarget ?? '未特定'}`,
    `clarificationMessage=${input.clarificationMessage ?? 'なし'}`
  ].join('\n');
  const evidence = fitEvidenceToSystemBudget({ prefix, evidence: input.evidence });
  return `${prefix}\nEVIDENCE=${JSON.stringify(evidence)}`;
}

export class BusinessHermesChatService {
  constructor(private readonly deps: ChatDeps = {}) {}

  private get hermes(): Pick<BusinessHermesService, 'chat' | 'classifyChat'> {
    return this.deps.hermes ?? new BusinessHermesService();
  }

  private get workInstructions(): Pick<WorkInstructionReadService, 'readPublishedGroups' | 'readPublishedGroup'> {
    return this.deps.workInstructions ?? getWorkInstructionServices().read;
  }

  private get nonconformities(): Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'> {
    return this.deps.nonconformities ?? new ScawStFutekigoReadService();
  }

  private async collectEvidence(input: BusinessHermesChatInput, intent: BusinessHermesChatIntent): Promise<{
    partNumber: string | null;
    shootingTarget: string | null;
    scope: BusinessHermesChatScope;
    evidence: BusinessHermesChatEvidence[];
    clarificationMessage: string | null;
  }> {
    const scope = intent.scope === 'unknown' ? input.scope : intent.scope;
    const partNumber = normalizeWorkInstructionPartNumber(intent.partNumber) ?? normalizeWorkInstructionPartNumber(input.partNumber);
    let shootingTarget = normalizeWorkInstructionShootingTarget(intent.shootingTarget) ?? normalizeWorkInstructionShootingTarget(input.shootingTarget);
    const evidence: BusinessHermesChatEvidence[] = [];
    let clarificationMessage: string | null = intent.scope === 'unknown'
      ? '不適合情報か作業要領（または両方）と品番を指定してください。'
      : intent.clarificationQuestion;

    if (intent.scope === 'unknown') {
      return { partNumber, shootingTarget: null, scope, evidence, clarificationMessage };
    }

    if (!partNumber) {
      clarificationMessage = '品番を指定してください。例: 品番: MD004121632-021';
    } else {
      if (scope === 'nonconformity') clarificationMessage = null;
      if (scope === 'nonconformity' || scope === 'both') {
        const items = await this.nonconformities.readCurrentByPartNumber(partNumber);
        evidence.push(...items.slice(0, MAX_NONCONFORMITY_EVIDENCE_ITEMS).map((item) => nonconformityEvidence(item, partNumber)));
      }
    }

    if ((scope === 'work_instruction' || scope === 'both') && partNumber) {
      if (!shootingTarget) {
        const groups = await this.workInstructions.readPublishedGroups({ partNumber, limit: 20, offset: 0 });
        if (groups.length === 1) {
          shootingTarget = normalizeWorkInstructionShootingTarget(groups[0]?.shootingTarget);
          clarificationMessage = null;
        }
        else clarificationMessage = targetClarification(partNumber, groups);
      }
      if (shootingTarget) {
        const group = await this.workInstructions.readPublishedGroup({ partNumber, shootingTarget });
        if (!group) {
          clarificationMessage = `品番 ${partNumber}・対象 ${shootingTarget} の公開作業要領が見つかりません。`;
        } else {
          clarificationMessage = null;
          evidence.push(...workInstructionEvidence(group, partNumber, shootingTarget).slice(0, MAX_WORK_INSTRUCTION_EVIDENCE_ITEMS));
        }
      }
    }

    return {
      partNumber,
      shootingTarget,
      scope,
      evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS),
      clarificationMessage
    };
  }

  async chat(input: BusinessHermesChatInput): Promise<BusinessHermesChatResponse> {
    const messages = input.messages.slice(-MAX_CHAT_MESSAGES).map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, MAX_MESSAGE_CHARS)
    })).filter((message) => message.content.length > 0);
    if (messages.length === 0) {
      return {
        status: 'unavailable',
        message: null,
        reasonCode: 'HERMES_EMPTY_REQUEST',
        evidence: [],
        partNumber: null,
        shootingTarget: null,
        needsClarification: true,
        clarificationMessage: '質問内容を入力してください。'
      };
    }

    const userMessages = messages.filter((message) => message.role === 'user');
    const classification = await this.hermes.classifyChat({ messages: userMessages });
    if (classification.status !== 'ready' || !classification.intent) {
      return {
        status: 'unavailable',
        message: null,
        reasonCode: classification.reasonCode ?? 'HERMES_INTENT_UNAVAILABLE',
        evidence: [],
        partNumber: null,
        shootingTarget: null,
        needsClarification: false,
        clarificationMessage: null
      };
    }

    const classifiedPartNumber = normalizeWorkInstructionPartNumber(classification.intent.partNumber);
    const classifiedShootingTarget = normalizeWorkInstructionShootingTarget(classification.intent.shootingTarget);
    const hasNewPart = hasNewPartNumberInLatestTurn(userMessages, classifiedPartNumber);
    const partIsExplicitInLatestTurn = valueAppearsInLatestUserTurn(
      classifiedPartNumber,
      userMessages,
      normalizeWorkInstructionPartNumber
    );
    const hasOtherPartInLatestTurn = !partIsExplicitInLatestTurn && latestTurnContainsOtherPartNumber(userMessages, classifiedPartNumber);
    const targetIsExplicitInLatestTurn = valueAppearsInLatestUserTurn(
      classifiedShootingTarget,
      userMessages,
      normalizeWorkInstructionShootingTarget
    );
    const intent: BusinessHermesChatIntent = {
      ...classification.intent,
      // Hermes may only select identifiers that occur in the user turns. This
      // keeps an assistant example or an invented identifier out of DB reads.
      partNumber: hasOtherPartInLatestTurn || !valueAppearsInUserTurns(classifiedPartNumber, userMessages, normalizeWorkInstructionPartNumber)
        ? null
        : classifiedPartNumber,
      shootingTarget: (hasNewPart && !targetIsExplicitInLatestTurn) || hasOtherPartInLatestTurn ||
        !valueAppearsInUserTurns(classifiedShootingTarget, userMessages, normalizeWorkInstructionShootingTarget)
        ? null
        : classifiedShootingTarget
    };

    let context;
    try {
      context = await this.collectEvidence({ ...input, messages: userMessages }, intent);
    } catch {
      return {
        status: 'unavailable',
        message: null,
        reasonCode: 'HERMES_CONTEXT_UNAVAILABLE',
        evidence: [],
        partNumber: normalizeWorkInstructionPartNumber(classification.intent.partNumber),
        shootingTarget: normalizeWorkInstructionShootingTarget(classification.intent.shootingTarget),
        needsClarification: false,
        clarificationMessage: null
      };
    }

    const result = await this.hermes.chat({
      messages: [
        {
          role: 'system',
          content: buildSystemMessage(context)
        },
        ...userMessages as BusinessHermesChatMessage[]
      ]
    });
    return {
      ...result,
      message: context.clarificationMessage ?? result.message,
      evidence: context.evidence,
      partNumber: context.partNumber,
      shootingTarget: context.shootingTarget,
      needsClarification: Boolean(context.clarificationMessage),
      clarificationMessage: context.clarificationMessage
    };
  }
}
