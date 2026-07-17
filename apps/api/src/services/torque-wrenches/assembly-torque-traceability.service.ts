import type { TorqueWrenchRejectionReason } from '@raspi-system/shared-types';
import { Prisma, type AssemblyTemplateBolt } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { lockAssemblyWorkSession } from '../assembly/assembly-work-session-lock.repository.js';
import {
  assemblyWorkSessionDetailInclude,
  type AssemblyWorkSessionDetail
} from '../assembly/assembly-work-session-detail.js';
import { TorqueUnitConverter, UnsupportedTorqueUnitError } from './torque-unit-converter.js';
import {
  TorqueWrenchEligibilityPolicy,
  torqueConditionFingerprint,
  type TorqueCondition,
  type TorqueWrenchCandidate
} from './torque-wrench-eligibility.policy.js';
import { normalizeTorqueWrenchKey } from './torque-wrench-normalization.js';

const profileEligibilityInclude = {
  measuringInstrument: true,
  model: true,
  settingHistories: {
    orderBy: [{ effectiveAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1
  }
} satisfies Prisma.TorqueWrenchProfileInclude;

type EligibilityProfile = Prisma.TorqueWrenchProfileGetPayload<{ include: typeof profileEligibilityInclude }>;

const capabilityGroupEligibilityInclude = {
  models: { select: { modelId: true } }
} satisfies Prisma.TorqueWrenchCapabilityGroupInclude;

type EligibilityCapabilityGroup = Prisma.TorqueWrenchCapabilityGroupGetPayload<{
  include: typeof capabilityGroupEligibilityInclude;
}>;

export type TraceabilityOutcome = {
  kind: 'accepted_ok' | 'recorded_ng' | 'rejected';
  torqueRecordId: string;
  movedToBoltId: string | null;
  areaCompleted: boolean;
  allBoltsCompleted: boolean;
  requiresAreaRestart: boolean;
  rejectionReason?: TorqueWrenchRejectionReason;
};

export type AgentTorqueRecordInput = {
  sessionId: string;
  clientDeviceId: string;
  sourceEventKey: string;
  expectedTemplateBoltId: string;
  confirmationId: string;
  serialNumber: string;
  value: number;
  unit: string;
  rawPayload?: unknown;
  deviceRecordedAt?: Date | null;
  deviceMemoryCounter?: string | null;
  deviceJudgement?: string | null;
};

function conditionFromBolt(bolt: AssemblyTemplateBolt): TorqueCondition {
  return {
    templateBoltId: bolt.id,
    nominalDiameter: bolt.nominalDiameter,
    boltLengthMm: bolt.boltLengthMm,
    material: bolt.material,
    strengthClass: bolt.strengthClass,
    capabilityGroupId: bolt.capabilityGroupId,
    lowerLimit: bolt.lowerLimit,
    nominalTorque: bolt.nominalTorque,
    upperLimit: bolt.upperLimit,
    unit: bolt.unit
  };
}

function candidateFromProfile(
  profile: EligibilityProfile,
  capabilityGroup: EligibilityCapabilityGroup
): TorqueWrenchCandidate {
  const setting = profile.settingHistories[0] ?? null;
  return {
    profileId: profile.id,
    modelId: profile.modelId,
    status: profile.measuringInstrument.status,
    calibrationExpiryDate: profile.measuringInstrument.calibrationExpiryDate,
    modelTorqueMinNm: profile.model.torqueMinNm,
    modelTorqueMaxNm: profile.model.torqueMaxNm,
    capabilityGroupId: capabilityGroup.id,
    capabilityGroupIsActive: capabilityGroup.isActive,
    capabilityGroupNominalDiameter: capabilityGroup.nominalDiameter,
    capabilityGroupBoltLengthMm: capabilityGroup.boltLengthMm,
    capabilityGroupMaterial: capabilityGroup.material,
    capabilityGroupStrengthClass: capabilityGroup.strengthClass,
    capabilityModelIds: capabilityGroup.models.map((link) => link.modelId),
    setting: setting
      ? {
          id: setting.id,
          lowerLimitNm: setting.lowerLimitNm,
          nominalTorqueNm: setting.nominalTorqueNm,
          upperLimitNm: setting.upperLimitNm
        }
      : null
  };
}

function findCurrentBolt(session: AssemblyWorkSessionDetail): AssemblyTemplateBolt {
  if (session.template.traceabilityMode !== 'REQUIRED') {
    throw new ApiError(409, 'この作業は従来方式のテンプレートです', undefined, 'LEGACY_TRACEABILITY_MODE');
  }
  if (!session.currentBoltId) throw new ApiError(409, '現在の締付箇所がありません');
  const bolt = session.template.areas.flatMap((area) => area.bolts).find((candidate) => candidate.id === session.currentBoltId);
  if (!bolt) throw new ApiError(409, '現在の締付箇所がテンプレートに存在しません');
  return bolt;
}

function assertSessionClient(session: AssemblyWorkSessionDetail, clientDeviceId: string): void {
  if (session.clientDeviceId && session.clientDeviceId !== clientDeviceId) {
    throw new ApiError(403, 'この作業は別のクライアント端末に割り当てられています', undefined, 'SESSION_CLIENT_MISMATCH');
  }
}

function nextAttempt(session: AssemblyWorkSessionDetail, boltId: string): number {
  return session.torqueRecords.filter((record) => record.templateBoltId === boltId).length + 1;
}

function nextBoltInArea(session: AssemblyWorkSessionDetail, boltId: string): { areaId: string; nextBoltId: string | null } {
  for (const area of [...session.template.areas].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bolts = [...area.bolts].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = bolts.findIndex((bolt) => bolt.id === boltId);
    if (index >= 0) return { areaId: area.id, nextBoltId: bolts[index + 1]?.id ?? null };
  }
  throw new ApiError(409, '現在の締付箇所が工程内に存在しません');
}

function isAllCompleteAfter(session: AssemblyWorkSessionDetail, newlyAcceptedBoltId?: string): boolean {
  const accepted = new Set(
    session.torqueRecords
      .filter((record) => record.accepted && record.judgement === 'OK')
      .map((record) => record.templateBoltId)
  );
  if (newlyAcceptedBoltId) accepted.add(newlyAcceptedBoltId);
  return session.template.areas.flatMap((area) => area.bolts).every((bolt) => accepted.has(bolt.id));
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

export class AssemblyTorqueTraceabilityService {
  constructor(private readonly policy = new TorqueWrenchEligibilityPolicy()) {}

  private async loadCapabilityGroup(capabilityGroupId: string): Promise<EligibilityCapabilityGroup> {
    const group = await prisma.torqueWrenchCapabilityGroup.findUnique({
      where: { id: capabilityGroupId },
      include: capabilityGroupEligibilityInclude
    });
    if (!group) throw new ApiError(409, '適合グループが見つかりません', undefined, 'WRONG_CAPABILITY_GROUP');
    return group;
  }

  async listCompatible(sessionId: string, clientDeviceId: string) {
    const session = await prisma.assemblyWorkSession.findUnique({
      where: { id: sessionId },
      include: assemblyWorkSessionDetailInclude
    });
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    assertSessionClient(session, clientDeviceId);
    const bolt = findCurrentBolt(session);
    if (!bolt.capabilityGroupId) throw new ApiError(409, '現在の締付箇所に適合グループがありません');
    const capabilityGroup = await this.loadCapabilityGroup(bolt.capabilityGroupId);
    const profiles = await prisma.torqueWrenchProfile.findMany({
      where: { modelId: { in: capabilityGroup.models.map((link) => link.modelId) } },
      include: profileEligibilityInclude,
      orderBy: { serialNumberKey: 'asc' }
    });
    const condition = conditionFromBolt(bolt);
    return profiles.flatMap((profile) => {
      const decision = this.policy.evaluate(
        condition,
        candidateFromProfile(profile, capabilityGroup)
      );
      return decision.eligible
        ? [
            {
              profile,
              currentSetting: profile.settingHistories[0],
              conditionFingerprint: decision.conditionFingerprint
            }
          ]
        : [];
    });
  }

  async confirm(input: {
    sessionId: string;
    clientDeviceId: string;
    clientDeviceName: string;
    expectedTemplateBoltId: string;
    torqueWrenchProfileId: string;
    physicalDisplayConfirmed: boolean;
  }) {
    if (!input.physicalDisplayConfirmed) {
      throw new ApiError(400, '現物の製造番号と設定表示の確認が必要です');
    }
    return prisma.$transaction(async (tx) => {
      const session = await lockAssemblyWorkSession(tx, input.sessionId);
      assertSessionClient(session, input.clientDeviceId);
      const bolt = findCurrentBolt(session);
      if (bolt.id !== input.expectedTemplateBoltId) {
        throw new ApiError(409, '表示中の丸数字が更新されています', undefined, 'STALE_TEMPLATE_BOLT');
      }
      const profile = await tx.torqueWrenchProfile.findUnique({
        where: { id: input.torqueWrenchProfileId },
        include: profileEligibilityInclude
      });
      if (!profile || !bolt.capabilityGroupId) throw new ApiError(404, '物理トルクレンチが見つかりません');
      const capabilityGroup = await tx.torqueWrenchCapabilityGroup.findUnique({
        where: { id: bolt.capabilityGroupId },
        include: capabilityGroupEligibilityInclude
      });
      if (!capabilityGroup) throw new ApiError(409, '適合グループが見つかりません', undefined, 'WRONG_CAPABILITY_GROUP');
      const decision = this.policy.evaluate(
        conditionFromBolt(bolt),
        candidateFromProfile(profile, capabilityGroup)
      );
      if (!decision.eligible) {
        throw new ApiError(409, 'このトルクレンチは現在の締付条件に適合しません', { reason: decision.reason }, decision.reason);
      }
      const setting = profile.settingHistories[0];
      if (!setting) throw new ApiError(409, '現在設定が登録されていません', undefined, 'SETTING_HISTORY_MISSING');
      return tx.assemblyTorqueWrenchConfirmation.create({
        data: {
          sessionId: session.id,
          templateBoltId: bolt.id,
          torqueWrenchProfileId: profile.id,
          settingHistoryId: setting.id,
          conditionFingerprint: decision.conditionFingerprint,
          operatorEmployeeId: session.operatorEmployeeId,
          operatorNameSnapshot: session.operatorNameSnapshot,
          clientDeviceId: input.clientDeviceId,
          clientDeviceNameSnapshot: input.clientDeviceName
        }
      });
    });
  }

  async listCurrentConfirmations(sessionId: string, clientDeviceId?: string) {
    const session = await prisma.assemblyWorkSession.findUnique({
      where: { id: sessionId },
      include: assemblyWorkSessionDetailInclude
    });
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    if (clientDeviceId) assertSessionClient(session, clientDeviceId);
    const bolt = findCurrentBolt(session);
    if (!bolt.capabilityGroupId) return [];
    const capabilityGroup = await this.loadCapabilityGroup(bolt.capabilityGroupId);
    const fingerprint = torqueConditionFingerprint(conditionFromBolt(bolt));
    const confirmations = await prisma.assemblyTorqueWrenchConfirmation.findMany({
      where: { sessionId, conditionFingerprint: fingerprint },
      include: {
        torqueWrenchProfile: { include: profileEligibilityInclude },
        settingHistory: true
      },
      orderBy: { confirmedAt: 'desc' }
    });
    const seenProfiles = new Set<string>();
    return confirmations.flatMap((confirmation) => {
      const profile = confirmation.torqueWrenchProfile;
      const latestSetting = profile.settingHistories[0] ?? null;
      if (seenProfiles.has(profile.id)) return [];
      if (
        !latestSetting ||
        confirmation.settingHistoryId !== latestSetting.id ||
        confirmation.conditionFingerprint !== fingerprint
      ) {
        return [];
      }
      const decision = this.policy.evaluate(
        conditionFromBolt(bolt),
        candidateFromProfile(profile, capabilityGroup)
      );
      if (!decision.eligible) return [];
      seenProfiles.add(profile.id);
      return [{
        id: confirmation.id,
        confirmedAt: confirmation.confirmedAt,
        templateBoltId: bolt.id,
        markerNo: bolt.markerNo,
        torqueWrenchProfileId: profile.id,
        settingHistoryId: latestSetting.id,
        serialNumber: profile.serialNumber,
        manufacturer: profile.model.manufacturer,
        modelNumber: profile.model.modelNumber,
        setting: {
          lowerLimit: latestSetting.lowerLimit,
          nominalTorque: latestSetting.nominalTorque,
          upperLimit: latestSetting.upperLimit,
          unit: latestSetting.unit
        }
      }];
    });
  }

  private async ignored(
    tx: Prisma.TransactionClient,
    session: AssemblyWorkSessionDetail,
    bolt: AssemblyTemplateBolt,
    input: AgentTorqueRecordInput,
    reason: TorqueWrenchRejectionReason,
    profile?: EligibilityProfile | null,
    valueNm?: Prisma.Decimal | null
  ): Promise<TraceabilityOutcome> {
    const record = await tx.assemblyTorqueRecord.create({
      data: {
        sessionId: session.id,
        templateBoltId: bolt.id,
        attempt: nextAttempt(session, bolt.id),
        inputSource: 'AGENT',
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
        value: Number.isFinite(input.value) ? new Prisma.Decimal(input.value) : null,
        inputUnit: input.unit,
        valueNm: valueNm ?? null,
        judgement: 'IGNORED',
        accepted: false,
        ignoredReason: reason,
        torqueWrenchProfileId: profile?.id ?? null,
        serialNumberSnapshot: input.serialNumber.slice(0, 120),
        manufacturerSnapshot: profile?.model.manufacturer ?? null,
        modelNumberSnapshot: profile?.model.modelNumber ?? null,
        sourceClientDeviceId: input.clientDeviceId,
        sourceEventKey: input.sourceEventKey,
        expectedTemplateBoltId: input.expectedTemplateBoltId,
        deviceRecordedAt: input.deviceRecordedAt ?? null,
        deviceMemoryCounter: input.deviceMemoryCounter?.slice(0, 120) ?? null,
        deviceJudgement: input.deviceJudgement?.slice(0, 80) ?? null
      }
    });
    return {
      kind: 'rejected',
      torqueRecordId: record.id,
      movedToBoltId: bolt.id,
      areaCompleted: false,
      allBoltsCompleted: isAllCompleteAfter(session),
      requiresAreaRestart: false,
      rejectionReason: reason
    };
  }

  async recordAgent(input: AgentTorqueRecordInput): Promise<{ session: AssemblyWorkSessionDetail; outcome: TraceabilityOutcome }> {
    const existing = await prisma.assemblyTorqueRecord.findUnique({
      where: {
        sourceClientDeviceId_sourceEventKey: {
          sourceClientDeviceId: input.clientDeviceId,
          sourceEventKey: input.sourceEventKey
        }
      }
    });
    if (existing) return this.resultForExisting(input.sessionId, existing);

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const session = await lockAssemblyWorkSession(tx, input.sessionId);
        if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は入力できない状態です');
        assertSessionClient(session, input.clientDeviceId);
        const bolt = findCurrentBolt(session);
        if (bolt.id !== input.expectedTemplateBoltId) {
          return this.ignored(tx, session, bolt, input, 'STALE_TEMPLATE_BOLT');
        }
        const profile = await tx.torqueWrenchProfile.findUnique({
          where: { serialNumberKey: normalizeTorqueWrenchKey(input.serialNumber) },
          include: profileEligibilityInclude
        });
        if (!profile) return this.ignored(tx, session, bolt, input, 'UNKNOWN_SERIAL_NUMBER');
        let valueNm: Prisma.Decimal;
        try {
          valueNm = TorqueUnitConverter.toNewtonMetres(input.value, input.unit);
        } catch (error) {
          if (error instanceof UnsupportedTorqueUnitError) {
            return this.ignored(tx, session, bolt, input, 'UNSUPPORTED_TORQUE_UNIT', profile);
          }
          throw error;
        }
        const confirmation = await tx.assemblyTorqueWrenchConfirmation.findUnique({ where: { id: input.confirmationId } });
        if (!confirmation || confirmation.sessionId !== session.id) {
          return this.ignored(tx, session, bolt, input, 'CONFIRMATION_REQUIRED', profile, valueNm);
        }
        if (confirmation.torqueWrenchProfileId !== profile.id) {
          return this.ignored(tx, session, bolt, input, 'WRONG_PHYSICAL_WRENCH', profile, valueNm);
        }
        const latestSetting = profile.settingHistories[0] ?? null;
        const fingerprint = torqueConditionFingerprint(conditionFromBolt(bolt));
        if (
          confirmation.conditionFingerprint !== fingerprint ||
          !latestSetting ||
          confirmation.settingHistoryId !== latestSetting.id
        ) {
          return this.ignored(tx, session, bolt, input, 'CONFIRMATION_STALE', profile, valueNm);
        }
        if (!bolt.capabilityGroupId) return this.ignored(tx, session, bolt, input, 'WRONG_CAPABILITY_GROUP', profile, valueNm);
        const capabilityGroup = await tx.torqueWrenchCapabilityGroup.findUnique({
          where: { id: bolt.capabilityGroupId },
          include: capabilityGroupEligibilityInclude
        });
        if (!capabilityGroup) return this.ignored(tx, session, bolt, input, 'WRONG_CAPABILITY_GROUP', profile, valueNm);
        const decision = this.policy.evaluate(
          conditionFromBolt(bolt),
          candidateFromProfile(profile, capabilityGroup)
        );
        if (!decision.eligible) return this.ignored(tx, session, bolt, input, decision.reason, profile, valueNm);

        const lowerNm = TorqueUnitConverter.toNewtonMetres(bolt.lowerLimit, bolt.unit);
        const upperNm = TorqueUnitConverter.toNewtonMetres(bolt.upperLimit, bolt.unit);
        const accepted = valueNm.gte(lowerNm) && valueNm.lte(upperNm);
        const deviceMemoryCounter = input.deviceMemoryCounter?.trim().slice(0, 120) || null;
        const memoryReplay = deviceMemoryCounter
          ? await tx.assemblyTorqueRecord.findFirst({
              where: {
                torqueWrenchProfileId: profile.id,
                deviceMemoryCounter
              },
              select: { id: true }
            })
          : null;
        const record = await tx.assemblyTorqueRecord.create({
          data: {
            sessionId: session.id,
            templateBoltId: bolt.id,
            attempt: nextAttempt(session, bolt.id),
            inputSource: 'AGENT',
            rawPayload: input.rawPayload as Prisma.InputJsonValue,
            value: new Prisma.Decimal(input.value),
            inputUnit: input.unit,
            valueNm,
            judgement: accepted ? 'OK' : 'NG',
            accepted,
            ignoredReason: memoryReplay ? 'DEVICE_MEMORY_REPLAY' : null,
            torqueWrenchProfileId: profile.id,
            confirmationId: confirmation.id,
            settingHistoryId: latestSetting.id,
            serialNumberSnapshot: profile.serialNumber,
            manufacturerSnapshot: profile.model.manufacturer,
            modelNumberSnapshot: profile.model.modelNumber,
            settingLowerLimitSnapshot: latestSetting.lowerLimit,
            settingNominalTorqueSnapshot: latestSetting.nominalTorque,
            settingUpperLimitSnapshot: latestSetting.upperLimit,
            settingUnitSnapshot: latestSetting.unit,
            sourceClientDeviceId: input.clientDeviceId,
            sourceEventKey: input.sourceEventKey,
            expectedTemplateBoltId: input.expectedTemplateBoltId,
            deviceRecordedAt: input.deviceRecordedAt ?? null,
            deviceMemoryCounter,
            deviceJudgement: input.deviceJudgement?.slice(0, 80) ?? null
          }
        });
        if (!accepted) {
          return {
            kind: 'recorded_ng',
            torqueRecordId: record.id,
            movedToBoltId: bolt.id,
            areaCompleted: false,
            allBoltsCompleted: false,
            requiresAreaRestart: false
          } satisfies TraceabilityOutcome;
        }
        const next = nextBoltInArea(session, bolt.id);
        await tx.assemblyWorkSession.update({
          where: { id: session.id },
          data: { currentAreaId: next.areaId, currentBoltId: next.nextBoltId }
        });
        return {
          kind: 'accepted_ok',
          torqueRecordId: record.id,
          movedToBoltId: next.nextBoltId,
          areaCompleted: next.nextBoltId === null,
          allBoltsCompleted: isAllCompleteAfter(session, bolt.id),
          requiresAreaRestart: false
        } satisfies TraceabilityOutcome;
      });
      const session = await prisma.assemblyWorkSession.findUnique({
        where: { id: input.sessionId },
        include: assemblyWorkSessionDetailInclude
      });
      if (!session) throw new ApiError(404, '作業セッションが見つかりません');
      return { session, outcome };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await prisma.assemblyTorqueRecord.findUnique({
          where: {
            sourceClientDeviceId_sourceEventKey: {
              sourceClientDeviceId: input.clientDeviceId,
              sourceEventKey: input.sourceEventKey
            }
          }
        });
        if (raced) return this.resultForExisting(input.sessionId, raced);
      }
      throw error;
    }
  }

  async recordOverride(input: {
    sessionId: string;
    confirmationId: string;
    value: number;
    unit: string;
    reason: string;
    actorUserId: string;
    actorUsername: string;
  }): Promise<{ session: AssemblyWorkSessionDetail; outcome: TraceabilityOutcome }> {
    const reason = input.reason.trim();
    if (!reason) throw new ApiError(400, '管理者例外入力の理由が必要です');
    const outcome = await prisma.$transaction(async (tx) => {
      const session = await lockAssemblyWorkSession(tx, input.sessionId);
      if (session.status !== 'IN_PROGRESS') throw new ApiError(409, 'この作業は入力できない状態です');
      const bolt = findCurrentBolt(session);
      const confirmation = await tx.assemblyTorqueWrenchConfirmation.findUnique({
        where: { id: input.confirmationId },
        include: {
          torqueWrenchProfile: { include: profileEligibilityInclude },
          settingHistory: true
        }
      });
      if (!confirmation || confirmation.sessionId !== session.id) {
        throw new ApiError(409, '現在の丸数字に有効なレンチ確認がありません', undefined, 'CONFIRMATION_REQUIRED');
      }
      const profile = confirmation.torqueWrenchProfile;
      const latestSetting = profile.settingHistories[0] ?? null;
      if (
        !latestSetting ||
        confirmation.settingHistoryId !== latestSetting.id ||
        confirmation.conditionFingerprint !== torqueConditionFingerprint(conditionFromBolt(bolt))
      ) {
        throw new ApiError(409, 'レンチ確認後に条件または設定が変更されています', undefined, 'CONFIRMATION_STALE');
      }
      if (!bolt.capabilityGroupId) {
        throw new ApiError(409, '適合グループがありません', undefined, 'WRONG_CAPABILITY_GROUP');
      }
      const capabilityGroup = await tx.torqueWrenchCapabilityGroup.findUnique({
        where: { id: bolt.capabilityGroupId },
        include: capabilityGroupEligibilityInclude
      });
      if (!capabilityGroup) {
        throw new ApiError(409, '適合グループが見つかりません', undefined, 'WRONG_CAPABILITY_GROUP');
      }
      const decision = this.policy.evaluate(
        conditionFromBolt(bolt),
        candidateFromProfile(profile, capabilityGroup)
      );
      if (!decision.eligible) {
        throw new ApiError(409, '安全条件を満たさないため例外入力できません', { reason: decision.reason }, decision.reason);
      }
      const valueNm = TorqueUnitConverter.toNewtonMetres(input.value, input.unit);
      const lowerNm = TorqueUnitConverter.toNewtonMetres(bolt.lowerLimit, bolt.unit);
      const upperNm = TorqueUnitConverter.toNewtonMetres(bolt.upperLimit, bolt.unit);
      const accepted = valueNm.gte(lowerNm) && valueNm.lte(upperNm);
      const record = await tx.assemblyTorqueRecord.create({
        data: {
          sessionId: session.id,
          templateBoltId: bolt.id,
          attempt: nextAttempt(session, bolt.id),
          inputSource: 'MANUAL',
          rawPayload: { source: 'admin_override', value: input.value, unit: input.unit, reason },
          value: new Prisma.Decimal(input.value),
          inputUnit: input.unit,
          valueNm,
          judgement: accepted ? 'OK' : 'NG',
          accepted,
          torqueWrenchProfileId: profile.id,
          confirmationId: confirmation.id,
          settingHistoryId: latestSetting.id,
          serialNumberSnapshot: profile.serialNumber,
          manufacturerSnapshot: profile.model.manufacturer,
          modelNumberSnapshot: profile.model.modelNumber,
          settingLowerLimitSnapshot: latestSetting.lowerLimit,
          settingNominalTorqueSnapshot: latestSetting.nominalTorque,
          settingUpperLimitSnapshot: latestSetting.upperLimit,
          settingUnitSnapshot: latestSetting.unit,
          overrideActorUserId: input.actorUserId,
          overrideActorUsername: input.actorUsername,
          overrideReason: reason.slice(0, 500)
        }
      });
      if (!accepted) {
        return {
          kind: 'recorded_ng',
          torqueRecordId: record.id,
          movedToBoltId: bolt.id,
          areaCompleted: false,
          allBoltsCompleted: false,
          requiresAreaRestart: false
        } satisfies TraceabilityOutcome;
      }
      const next = nextBoltInArea(session, bolt.id);
      await tx.assemblyWorkSession.update({
        where: { id: session.id },
        data: { currentAreaId: next.areaId, currentBoltId: next.nextBoltId }
      });
      return {
        kind: 'accepted_ok',
        torqueRecordId: record.id,
        movedToBoltId: next.nextBoltId,
        areaCompleted: next.nextBoltId === null,
        allBoltsCompleted: isAllCompleteAfter(session, bolt.id),
        requiresAreaRestart: false
      } satisfies TraceabilityOutcome;
    });
    const session = await prisma.assemblyWorkSession.findUnique({
      where: { id: input.sessionId },
      include: assemblyWorkSessionDetailInclude
    });
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    return { session, outcome };
  }

  private async resultForExisting(
    sessionId: string,
    record: { id: string; sessionId: string; accepted: boolean; judgement: string; ignoredReason: string | null }
  ): Promise<{ session: AssemblyWorkSessionDetail; outcome: TraceabilityOutcome }> {
    if (record.sessionId !== sessionId) {
      throw new ApiError(409, '同じ端末イベントIDが別の作業セッションで既に使用されています', undefined, 'EVENT_SESSION_MISMATCH');
    }
    const session = await prisma.assemblyWorkSession.findUnique({ where: { id: sessionId }, include: assemblyWorkSessionDetailInclude });
    if (!session) throw new ApiError(404, '作業セッションが見つかりません');
    const rejected = record.judgement === 'IGNORED';
    return {
      session,
      outcome: {
        kind: rejected ? 'rejected' : record.accepted ? 'accepted_ok' : 'recorded_ng',
        torqueRecordId: record.id,
        movedToBoltId: session.currentBoltId,
        areaCompleted: session.currentBoltId === null,
        allBoltsCompleted: isAllCompleteAfter(session),
        requiresAreaRestart: false,
        ...(rejected && record.ignoredReason
          ? { rejectionReason: record.ignoredReason as TorqueWrenchRejectionReason }
          : {})
      }
    };
  }
}
