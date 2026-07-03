import type { AssemblyTorqueInputSource, Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assemblyTemplateDetailInclude, type AssemblyTemplateDetail } from './assembly-template.service.js';

export const assemblyWorkSessionDetailInclude = {
  template: {
    include: assemblyTemplateDetailInclude
  },
  torqueRecords: {
    orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }],
    include: {
      templateBolt: {
        include: {
          area: true
        }
      }
    }
  },
  restartLogs: {
    orderBy: { createdAt: 'asc' }
  }
} satisfies Prisma.AssemblyWorkSessionInclude;

export type AssemblyWorkSessionDetail = Prisma.AssemblyWorkSessionGetPayload<{
  include: typeof assemblyWorkSessionDetailInclude;
}>;

export type AssemblyStartInput = {
  templateId: string;
  productNo: string;
  serialNo: string;
  nameplateNo: string;
  operatorEmployeeId?: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
  clientDeviceId?: string | null;
  clientDeviceNameSnapshot?: string | null;
};

export type AssemblyTorqueRecordOutcome = {
  kind: 'accepted_ok' | 'recorded_ng' | 'ignored_duplicate';
  movedToBoltId: string | null;
  areaCompleted: boolean;
  allBoltsCompleted: boolean;
  requiresAreaRestart: boolean;
};

const DUPLICATE_SUPPRESSION_MS = 1000;

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(400, `${label}が必要です`);
  return trimmed;
}

function sortedAreas(template: AssemblyTemplateDetail) {
  return [...template.areas].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sortedBoltsForArea(area: AssemblyTemplateDetail['areas'][number]) {
  return [...area.bolts].sort((a, b) => a.sortOrder - b.sortOrder);
}

function flattenBolts(template: AssemblyTemplateDetail) {
  return sortedAreas(template).flatMap((area) => sortedBoltsForArea(area).map((bolt) => ({ area, bolt })));
}

function firstPosition(template: AssemblyTemplateDetail): { areaId: string; boltId: string } {
  const first = flattenBolts(template)[0];
  if (!first) {
    throw new ApiError(409, 'テンプレートに締付箇所がありません');
  }
  return { areaId: first.area.id, boltId: first.bolt.id };
}

function findBoltPosition(template: AssemblyTemplateDetail, boltId: string) {
  return flattenBolts(template).find((entry) => entry.bolt.id === boltId) ?? null;
}

function nextBoltInSameArea(template: AssemblyTemplateDetail, currentBoltId: string): string | null {
  const current = findBoltPosition(template, currentBoltId);
  if (!current) return null;
  const bolts = sortedBoltsForArea(current.area);
  const index = bolts.findIndex((bolt) => bolt.id === currentBoltId);
  return index >= 0 ? (bolts[index + 1]?.id ?? null) : null;
}

function nextAreaFirstBolt(template: AssemblyTemplateDetail, currentAreaId: string): { areaId: string; boltId: string } | null {
  const areas = sortedAreas(template);
  const index = areas.findIndex((area) => area.id === currentAreaId);
  const nextArea = index >= 0 ? areas[index + 1] : null;
  if (!nextArea) return null;
  const firstBolt = sortedBoltsForArea(nextArea)[0];
  return firstBolt ? { areaId: nextArea.id, boltId: firstBolt.id } : null;
}

function hasAcceptedOkForBolt(session: AssemblyWorkSessionDetail, boltId: string): boolean {
  return session.torqueRecords.some((record) => record.templateBoltId === boltId && record.accepted && record.judgement === 'OK');
}

function areaIsComplete(session: AssemblyWorkSessionDetail, areaId: string): boolean {
  const area = session.template.areas.find((candidate) => candidate.id === areaId);
  if (!area) return false;
  return sortedBoltsForArea(area).every((bolt) => hasAcceptedOkForBolt(session, bolt.id));
}

function allBoltsComplete(session: AssemblyWorkSessionDetail): boolean {
  return flattenBolts(session.template).every(({ bolt }) => hasAcceptedOkForBolt(session, bolt.id));
}

function nextAttempt(session: AssemblyWorkSessionDetail, boltId: string): number {
  return session.torqueRecords.filter((record) => record.templateBoltId === boltId).length + 1;
}

function countUpperLimitNgAttempts(session: AssemblyWorkSessionDetail, boltId: string, value: number, upperLimit: number): number {
  const previous = session.torqueRecords.filter(
    (record) =>
      record.templateBoltId === boltId &&
      record.judgement === 'NG' &&
      record.value !== null &&
      Number(record.value) > upperLimit
  ).length;
  return previous + (value > upperLimit ? 1 : 0);
}

function recentlyAcceptedDuplicate(session: AssemblyWorkSessionDetail, now: Date): boolean {
  const last = [...session.torqueRecords]
    .reverse()
    .find((record) => record.accepted && record.judgement === 'OK');
  if (!last) return false;
  return now.getTime() - last.recordedAt.getTime() < DUPLICATE_SUPPRESSION_MS;
}

export class AssemblyWorkSessionService {
  async start(input: AssemblyStartInput): Promise<AssemblyWorkSessionDetail> {
    const template = await prisma.assemblyTemplate.findFirst({
      where: { id: input.templateId, isActive: true },
      include: assemblyTemplateDetailInclude
    });
    if (!template) throw new ApiError(404, '有効な組立テンプレートが見つかりません');
    const first = firstPosition(template);
    return prisma.assemblyWorkSession.create({
      data: {
        templateId: template.id,
        productNo: required(input.productNo, '製番/M番号').slice(0, 120),
        serialNo: required(input.serialNo, 'シリアルNo.').slice(0, 120),
        nameplateNo: required(input.nameplateNo, '銘板No.').slice(0, 120),
        operatorEmployeeId: input.operatorEmployeeId?.trim() || null,
        operatorNameSnapshot: required(input.operatorNameSnapshot, '作業者名').slice(0, 120),
        targetUnit: required(input.targetUnit, '対象ユニット').slice(0, 120),
        torqueWrenchId: required(input.torqueWrenchId, '使用トルクレンチ').slice(0, 120),
        clientDeviceId: input.clientDeviceId ?? null,
        clientDeviceNameSnapshot: input.clientDeviceNameSnapshot ?? null,
        currentAreaId: first.areaId,
        currentBoltId: first.boltId
      },
      include: assemblyWorkSessionDetailInclude
    });
  }

  async getDetail(id: string): Promise<AssemblyWorkSessionDetail | null> {
    return prisma.assemblyWorkSession.findUnique({
      where: { id },
      include: assemblyWorkSessionDetailInclude
    });
  }

  async recordTorque(input: {
    sessionId: string;
    value: number;
    inputSource: AssemblyTorqueInputSource;
    rawPayload?: unknown;
  }): Promise<{ session: AssemblyWorkSessionDetail; outcome: AssemblyTorqueRecordOutcome }> {
    if (!Number.isFinite(input.value)) {
      throw new ApiError(400, 'トルク値が不正です');
    }
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.assemblyWorkSession.findUnique({
        where: { id: input.sessionId },
        include: assemblyWorkSessionDetailInclude
      });
      if (!session) throw new ApiError(404, '作業セッションが見つかりません');
      if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は入力できない状態です');
      if (!session.currentAreaId || !session.currentBoltId) {
        throw new ApiError(409, '現在のエリアは完了しています。次工程へ進むか作業完了してください。');
      }
      const current = findBoltPosition(session.template, session.currentBoltId);
      if (!current) throw new ApiError(409, '現在の締付箇所がテンプレートに存在しません');
      const attempt = nextAttempt(session, current.bolt.id);

      if (recentlyAcceptedDuplicate(session, now)) {
        await tx.assemblyTorqueRecord.create({
          data: {
            sessionId: session.id,
            templateBoltId: current.bolt.id,
            attempt,
            inputSource: input.inputSource,
            rawPayload: input.rawPayload as Prisma.InputJsonValue | undefined,
            value: input.value,
            judgement: 'IGNORED',
            accepted: false,
            ignoredReason: 'DUPLICATE_WITHIN_1S',
            recordedAt: now
          }
        });
        return {
          outcome: {
            kind: 'ignored_duplicate' as const,
            movedToBoltId: current.bolt.id,
            areaCompleted: false,
            allBoltsCompleted: allBoltsComplete(session),
            requiresAreaRestart: false
          }
        };
      }

      const lower = Number(current.bolt.lowerLimit);
      const upper = Number(current.bolt.upperLimit);
      const lo = Math.min(lower, upper);
      const hi = Math.max(lower, upper);
      const judgement = input.value >= lo && input.value <= hi ? 'OK' : 'NG';
      const accepted = judgement === 'OK';
      await tx.assemblyTorqueRecord.create({
        data: {
          sessionId: session.id,
          templateBoltId: current.bolt.id,
          attempt,
          inputSource: input.inputSource,
          rawPayload: input.rawPayload as Prisma.InputJsonValue | undefined,
          value: input.value,
          judgement,
          accepted,
          recordedAt: now
        }
      });

      if (!accepted) {
        const requiresAreaRestart = countUpperLimitNgAttempts(session, current.bolt.id, input.value, hi) >= 3;
        return {
          outcome: {
            kind: 'recorded_ng' as const,
            movedToBoltId: current.bolt.id,
            areaCompleted: false,
            allBoltsCompleted: false,
            requiresAreaRestart
          }
        };
      }

      const nextBoltId = nextBoltInSameArea(session.template, current.bolt.id);
      await tx.assemblyWorkSession.update({
        where: { id: session.id },
        data: {
          currentAreaId: current.area.id,
          currentBoltId: nextBoltId
        }
      });
      return {
        outcome: {
          kind: 'accepted_ok' as const,
          movedToBoltId: nextBoltId,
          areaCompleted: nextBoltId === null,
          allBoltsCompleted: false,
          requiresAreaRestart: false
        }
      };
    });

    const nextSession = await this.getDetail(input.sessionId);
    if (!nextSession) throw new ApiError(404, '作業セッションが見つかりません');
    return {
      session: nextSession,
      outcome: {
        ...result.outcome,
        allBoltsCompleted: allBoltsComplete(nextSession)
      }
    };
  }

  async advanceArea(sessionId: string): Promise<AssemblyWorkSessionDetail> {
    const session = await this.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は進行中ではありません');
    if (!session.currentAreaId) throw new ApiError(409, '次の工程はありません。作業完了してください。');
    if (session.currentBoltId) throw new ApiError(409, '現在のエリアに未完了の締付箇所があります');
    if (!areaIsComplete(session, session.currentAreaId)) {
      throw new ApiError(409, '現在のエリアが完了していません');
    }
    const next = nextAreaFirstBolt(session.template, session.currentAreaId);
    const updated = await prisma.assemblyWorkSession.update({
      where: { id: session.id },
      data: {
        currentAreaId: next?.areaId ?? null,
        currentBoltId: next?.boltId ?? null
      },
      include: assemblyWorkSessionDetailInclude
    });
    return updated;
  }

  async restartArea(sessionId: string, params: { areaId?: string | null; reason?: string | null }): Promise<AssemblyWorkSessionDetail> {
    const session = await this.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は進行中ではありません');
    const areaId = params.areaId?.trim() || session.currentAreaId;
    if (!areaId) throw new ApiError(400, 'やり直すエリアがありません');
    const area = session.template.areas.find((candidate) => candidate.id === areaId);
    if (!area) throw new ApiError(404, 'エリアが見つかりません');
    const firstBolt = sortedBoltsForArea(area)[0];
    if (!firstBolt) throw new ApiError(409, 'エリアに締付箇所がありません');
    const reason = params.reason?.trim() || 'エリアやり直し';
    const updated = await prisma.$transaction(async (tx) => {
      await tx.assemblyAreaRestartLog.create({
        data: { sessionId: session.id, areaId, reason: reason.slice(0, 500) }
      });
      return tx.assemblyWorkSession.update({
        where: { id: session.id },
        data: {
          currentAreaId: areaId,
          currentBoltId: firstBolt.id
        },
        include: assemblyWorkSessionDetailInclude
      });
    });
    return updated;
  }

  async complete(sessionId: string): Promise<AssemblyWorkSessionDetail> {
    const session = await this.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は進行中ではありません');
    if (!allBoltsComplete(session)) throw new ApiError(409, '未完了の締付箇所があります');
    return prisma.assemblyWorkSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        currentAreaId: null,
        currentBoltId: null
      },
      include: assemblyWorkSessionDetailInclude
    });
  }

  async cancel(sessionId: string, reason?: string | null): Promise<AssemblyWorkSessionDetail> {
    const session = await this.getDetail(sessionId);
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は進行中ではありません');
    return prisma.assemblyWorkSession.update({
      where: { id: session.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || null
      },
      include: assemblyWorkSessionDetailInclude
    });
  }
}
