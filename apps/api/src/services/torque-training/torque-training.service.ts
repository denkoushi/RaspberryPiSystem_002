import { Prisma, type TorqueTrainingAttemptJudgement } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { resolveActiveAssemblyOperatorNfcUid } from '../assembly/assembly-operator-nfc-resolve.service.js';
import { runTrainingTransaction } from './torque-training.transaction.js';
import {
  TorqueTrainingLeaseService,
  type TrainingLeaseAcquireInput,
  type TrainingLeaseTokenInput
} from './torque-training-lease.service.js';
import {
  candidateFromProfile,
  capabilityGroupEligibilityInclude,
  profileEligibilityInclude
} from '../torque-wrenches/torque-wrench-use-context.js';
import { TorqueWrenchEligibilityPolicy } from '../torque-wrenches/torque-wrench-eligibility.policy.js';
import { TorqueUnitConverter } from '../torque-wrenches/torque-unit-converter.js';
import {
  decideTrainingAttempt,
  summarizeTrainingAttempts,
  trainingConditionFingerprint,
  type TrainingConditionInput
} from './torque-training.policy.js';
import {
  conditionFromTrainingVersion,
  evaluateTrainingVersionSetup,
  trainingSetupVersionInclude
} from './torque-training-setup.service.js';
import {
  appendTorqueTrainingSettingsAudit,
  TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS,
  type TorqueTrainingSettingsAuditContext
} from './torque-training-settings-audit.js';

type Client = { id: string; name: string; location?: string | null };

export type TrainingProgramInput = {
  code: string;
  displayName: string;
  nominalDiameter: string;
  boltLengthMm: number | string;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  nominalTorque: number | string;
  lowerLimit: number | string;
  upperLimit: number | string;
  unit: string;
  jigConditionCode: string;
  torqueWrenchProfileIds: string[];
};

export type AgentTrainingAttemptInput = {
  sessionId: string;
  clientDeviceId: string;
  sourceEventKey: string;
  confirmationId: string;
  torqueWrenchProfileId?: string;
  serialNumber: string;
  value: number | string;
  unit: string;
  deviceRecordedAt?: Date | null;
  deviceMemoryCounter?: string | null;
  deviceJudgement?: string | null;
  connectionLeaseId?: string | null;
  connectionLeaseGeneration?: number | null;
};

const trainingProgramVersionInclude = {
  program: true,
  wrenches: {
    include: { torqueWrenchProfile: { select: { id: true, serialNumber: true } } }
  }
} as const;

const trainingSessionInclude = {
  programVersion: { include: trainingProgramVersionInclude },
  attempts: true,
  confirmations: true
} as const;

function decimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function toDecimalString(value: Prisma.Decimal | null | undefined): string | null {
  return value == null ? null : value.toString();
}

function serializeAttempt(attempt: Prisma.TorqueTrainingAttemptGetPayload<object>) {
  return {
    id: attempt.id,
    attemptNo: attempt.attemptNo,
    value: toDecimalString(attempt.value),
    inputUnit: attempt.inputUnit,
    valueNm: toDecimalString(attempt.valueNm),
    nominalTorque: toDecimalString(attempt.nominalTorqueSnapshot),
    lowerLimit: toDecimalString(attempt.lowerLimitSnapshot),
    upperLimit: toDecimalString(attempt.upperLimitSnapshot),
    deviationNm: toDecimalString(attempt.deviationNm),
    deviationPercent: toDecimalString(attempt.deviationPercent),
    absoluteDeviationPercent: toDecimalString(attempt.absoluteDeviationPercent),
    judgement: attempt.judgement,
    accepted: attempt.accepted,
    ignoredReason: attempt.ignoredReason,
    recordedAt: attempt.recordedAt.toISOString()
  };
}

function serializeSession(session: Prisma.TorqueTrainingSessionGetPayload<{
  include: {
    programVersion: { include: typeof trainingProgramVersionInclude };
    attempts: true;
    confirmations: true;
  };
}>) {
  return {
    id: session.id,
    requestId: session.requestId,
    status: session.status,
    employeeCode: session.employeeCodeSnapshot,
    employeeName: session.employeeNameSnapshot,
    clientDeviceName: session.clientDeviceNameSnapshot,
    conditionFingerprint: session.conditionFingerprint,
    targetAttemptCount: 5,
    program: {
      id: session.programVersion.program.id,
      code: session.programVersion.program.code,
      version: session.programVersion.version,
      displayName: session.programVersion.displayName,
      nominalDiameter: session.programVersion.nominalDiameter,
      boltLengthMm: session.programVersion.boltLengthMm.toString(),
      material: session.programVersion.material,
      strengthClass: session.programVersion.strengthClass,
      capabilityGroupId: session.programVersion.capabilityGroupId,
      nominalTorque: session.programVersion.nominalTorque.toString(),
      lowerLimit: session.programVersion.lowerLimit.toString(),
      upperLimit: session.programVersion.upperLimit.toString(),
      unit: session.programVersion.unit,
      jigConditionCode: session.programVersion.jigConditionCode,
      conditionFingerprint: session.programVersion.conditionFingerprint,
      torqueWrenchProfiles: session.programVersion.wrenches.map((wrench) => wrench.torqueWrenchProfile)
    },
    attempts: session.attempts.map(serializeAttempt),
    hasWrenchConfirmation: session.confirmations.length > 0,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    cancelledAt: session.cancelledAt?.toISOString() ?? null,
    cancelReason: session.cancelReason,
    excludedAt: session.excludedAt?.toISOString() ?? null,
    exclusionReason: session.exclusionReason
  };
}

async function resolveTrainingEmployee(rawUid: string) {
  if (!rawUid.trim()) throw new ApiError(400, 'NFC UIDが必要です', undefined, 'NFC_UID_REQUIRED');
  const resolved = await resolveActiveAssemblyOperatorNfcUid(prisma, rawUid);
  return {
    id: resolved.employeeId,
    employeeCode: resolved.employeeCode,
    displayName: resolved.displayName,
    nfcTagUid: resolved.nfcTagUid
  };
}

function normalizeProgramInput(input: TrainingProgramInput) {
  const boltLengthMm = decimal(input.boltLengthMm);
  const lowerLimit = decimal(input.lowerLimit);
  const nominalTorque = decimal(input.nominalTorque);
  const upperLimit = decimal(input.upperLimit);
  const condition: TrainingConditionInput = {
    nominalDiameter: input.nominalDiameter.trim(),
    boltLengthMm,
    material: input.material.trim(),
    strengthClass: input.strengthClass.trim(),
    capabilityGroupId: input.capabilityGroupId,
    lowerLimit,
    nominalTorque,
    upperLimit,
    unit: input.unit.trim(),
    jigConditionCode: input.jigConditionCode.trim()
  };
  if (lowerLimit.gt(nominalTorque) || nominalTorque.gt(upperLimit)) {
    throw new ApiError(400, 'トルク上下限と目標値の関係が不正です', undefined, 'TRAINING_CONDITION_INVALID');
  }
  return { ...condition, fingerprint: trainingConditionFingerprint(condition), displayName: input.displayName.trim(), code: input.code.trim(), torqueWrenchProfileIds: input.torqueWrenchProfileIds };
}

export class TorqueTrainingService {
  constructor(
    private readonly leaseService = new TorqueTrainingLeaseService()
  ) {}

  async listPrograms(includeInactive = false) {
    const programs = await prisma.torqueTrainingProgram.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ code: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: includeInactive ? undefined : 1,
          include: trainingSetupVersionInclude
        }
      }
    });
    return programs.map((program) => ({
      id: program.id,
      code: program.code,
      isActive: program.isActive,
      currentVersion: program.currentVersion,
      versions: program.versions.map((version) => ({
        id: version.id,
        version: version.version,
        displayName: version.displayName,
        nominalDiameter: version.nominalDiameter,
        boltLengthMm: version.boltLengthMm.toString(),
        material: version.material,
        strengthClass: version.strengthClass,
        capabilityGroupId: version.capabilityGroupId,
        nominalTorque: version.nominalTorque.toString(),
        lowerLimit: version.lowerLimit.toString(),
        upperLimit: version.upperLimit.toString(),
        unit: version.unit,
        jigConditionCode: version.jigConditionCode,
        conditionFingerprint: version.conditionFingerprint,
        torqueWrenchProfiles: version.wrenches.map((wrench) => ({
          id: wrench.torqueWrenchProfile.id,
          serialNumber: wrench.torqueWrenchProfile.serialNumber
        })),
        ...evaluateTrainingVersionSetup(version)
      }))
    }));
  }

  async createProgram(input: TrainingProgramInput, audit?: TorqueTrainingSettingsAuditContext) {
    const normalized = normalizeProgramInput(input);
    return runTrainingTransaction(async (tx) => {
      const group = await tx.torqueWrenchCapabilityGroup.findUnique({ where: { id: normalized.capabilityGroupId } });
      if (!group || !group.isActive) throw new ApiError(400, '有効な適合グループを指定してください', undefined, 'CAPABILITY_GROUP_INVALID');
      const profiles = await tx.torqueWrenchProfile.findMany({ where: { id: { in: normalized.torqueWrenchProfileIds } }, select: { id: true } });
      if (profiles.length !== normalized.torqueWrenchProfileIds.length) throw new ApiError(400, '指定された利用レンチが見つかりません');
      const program = await tx.torqueTrainingProgram.create({
        data: {
          code: normalized.code,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              displayName: normalized.displayName,
              nominalDiameter: normalized.nominalDiameter,
              boltLengthMm: normalized.boltLengthMm,
              material: normalized.material,
              strengthClass: normalized.strengthClass,
              capabilityGroupId: normalized.capabilityGroupId,
              nominalTorque: normalized.nominalTorque,
              lowerLimit: normalized.lowerLimit,
              upperLimit: normalized.upperLimit,
              unit: normalized.unit,
              jigConditionCode: normalized.jigConditionCode,
              conditionFingerprint: normalized.fingerprint,
              attemptCount: 5,
              wrenches: { create: normalized.torqueWrenchProfileIds.map((torqueWrenchProfileId) => ({ torqueWrenchProfileId })) }
            }
          }
        },
        include: { versions: true }
      });
      if (audit) {
        await appendTorqueTrainingSettingsAudit(tx, {
          ...audit,
          action: TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS.PROGRAM_CREATED,
          targetType: 'PROGRAM',
          targetId: program.id
        });
      }
      return program;
    });
  }

  async reviseProgram(
    programId: string,
    input: Omit<TrainingProgramInput, 'code'>,
    audit?: TorqueTrainingSettingsAuditContext
  ) {
    const normalized = normalizeProgramInput({ ...input, code: `revision-${programId}` });
    return runTrainingTransaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "TorqueTrainingProgram"
        WHERE "id" = ${programId}
        FOR UPDATE
      `);
      const program = await tx.torqueTrainingProgram.findUnique({ where: { id: programId } });
      if (!program) throw new ApiError(404, '訓練メニューが見つかりません');
      if (!program.isActive) throw new ApiError(409, '停止済みメニューは変更できません');
      const group = await tx.torqueWrenchCapabilityGroup.findUnique({ where: { id: normalized.capabilityGroupId } });
      if (!group || !group.isActive) throw new ApiError(400, '有効な適合グループを指定してください', undefined, 'CAPABILITY_GROUP_INVALID');
      const profiles = await tx.torqueWrenchProfile.findMany({ where: { id: { in: normalized.torqueWrenchProfileIds } }, select: { id: true } });
      if (profiles.length !== normalized.torqueWrenchProfileIds.length) throw new ApiError(400, '指定された利用レンチが見つかりません');
      const version = program.currentVersion + 1;
      const created = await tx.torqueTrainingProgramVersion.create({
        data: {
          programId,
          version,
          displayName: normalized.displayName,
          nominalDiameter: normalized.nominalDiameter,
          boltLengthMm: normalized.boltLengthMm,
          material: normalized.material,
          strengthClass: normalized.strengthClass,
          capabilityGroupId: normalized.capabilityGroupId,
          nominalTorque: normalized.nominalTorque,
          lowerLimit: normalized.lowerLimit,
          upperLimit: normalized.upperLimit,
          unit: normalized.unit,
          jigConditionCode: normalized.jigConditionCode,
          conditionFingerprint: normalized.fingerprint,
          attemptCount: 5,
          wrenches: { create: normalized.torqueWrenchProfileIds.map((torqueWrenchProfileId) => ({ torqueWrenchProfileId })) }
        }
      });
      await tx.torqueTrainingProgram.update({ where: { id: programId }, data: { currentVersion: version } });
      if (audit) {
        await appendTorqueTrainingSettingsAudit(tx, {
          ...audit,
          action: TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS.PROGRAM_REVISED,
          targetType: 'PROGRAM',
          targetId: programId
        });
      }
      return created;
    });
  }

  async deactivateProgram(programId: string, reason: string, audit?: TorqueTrainingSettingsAuditContext) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new ApiError(400, '停止理由が必要です');
    return runTrainingTransaction(async (tx) => {
      const program = await tx.torqueTrainingProgram.findUnique({ where: { id: programId } });
      if (!program) throw new ApiError(404, '訓練メニューが見つかりません');
      const updated = await tx.torqueTrainingProgram.update({
        where: { id: programId },
        data: { isActive: false, deactivatedAt: new Date(), deactivationReason: normalizedReason }
      });
      if (audit) {
        await appendTorqueTrainingSettingsAudit(tx, {
          ...audit,
          action: TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS.PROGRAM_DEACTIVATED,
          targetType: 'PROGRAM',
          targetId: updated.id
        });
      }
      return { id: updated.id, isActive: updated.isActive };
    });
  }

  async operatorContext(rawUid: string, clientDeviceId: string) {
    const employee = await resolveTrainingEmployee(rawUid);
    const activeSession = await prisma.torqueTrainingSession.findFirst({
      where: { employeeId: employee.id, clientDeviceId, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
      include: trainingSessionInclude
    });
    // Keep the recent-ten boundary in PostgreSQL. A global LIMIT followed by
    // JavaScript grouping can silently omit a fingerprint when one condition
    // is much more common than the others.
    const recentSessionIds = await prisma.$queryRaw<Array<{ id: string; conditionFingerprint: string; completedAt: Date | null }>>(Prisma.sql`
      SELECT "id", "conditionFingerprint", "completedAt"
      FROM (
        SELECT
          "id",
          "conditionFingerprint",
          "completedAt",
          ROW_NUMBER() OVER (
            PARTITION BY "conditionFingerprint"
            ORDER BY "completedAt" DESC NULLS LAST, "id" DESC
          ) AS row_number
        FROM "TorqueTrainingSession"
        WHERE "employeeId" = ${employee.id}
          AND "status" = 'COMPLETED'
          AND "excludedAt" IS NULL
      ) ranked
      WHERE row_number <= 10
      ORDER BY "completedAt" DESC NULLS LAST, "id" DESC
    `);
    const sessions = recentSessionIds.length === 0
      ? []
      : await prisma.torqueTrainingSession.findMany({
          where: { id: { in: recentSessionIds.map((row) => row.id) } },
          include: { attempts: true }
        });
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const grouped = new Map<string, typeof sessions>();
    for (const row of recentSessionIds) {
      const session = sessionsById.get(row.id);
      if (!session) continue;
      const rows = grouped.get(session.conditionFingerprint) ?? [];
      rows.push(session);
      grouped.set(session.conditionFingerprint, rows);
    }
    const metrics = [...grouped.entries()].map(([conditionFingerprint, rows]) => ({
      conditionFingerprint,
      sessions: rows.map((session) => ({
        sessionId: session.id,
        completedAt: session.completedAt?.toISOString() ?? null,
        ...summarizeTrainingAttempts(session.attempts.map((attempt) => ({
          accepted: attempt.accepted,
          judgement: attempt.judgement,
          deviationPercent: attempt.deviationPercent,
          absoluteDeviationPercent: attempt.absoluteDeviationPercent
        })))
      })),
      ...summarizeTrainingAttempts(rows.flatMap((session) => session.attempts.map((attempt) => ({
        accepted: attempt.accepted,
        judgement: attempt.judgement,
        deviationPercent: attempt.deviationPercent,
        absoluteDeviationPercent: attempt.absoluteDeviationPercent
      }))))
    }));
    return {
      employee: { id: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName },
      currentSession: activeSession ? serializeSession(activeSession) : null,
      metrics
    };
  }

  async startSession(rawUid: string, programVersionId: string, client: Client, requestId: string) {
    const employee = await resolveTrainingEmployee(rawUid);
    const include = trainingSessionInclude;
    const existingRequest = await prisma.torqueTrainingSession.findUnique({ where: { requestId }, include });
    if (existingRequest) {
      if (existingRequest.employeeId !== employee.id || existingRequest.clientDeviceId !== client.id || existingRequest.programVersionId !== programVersionId) {
        throw new ApiError(409, 'requestIdは別の訓練開始要求です', undefined, 'TRAINING_REQUEST_ID_REUSED');
      }
      return serializeSession(existingRequest);
    }
    const version = await prisma.torqueTrainingProgramVersion.findUnique({
      where: { id: programVersionId },
      include: trainingSetupVersionInclude
    });
    if (!version || !version.program.isActive || version.version !== version.program.currentVersion) throw new ApiError(409, '現行版ではない訓練メニューは開始できません', undefined, 'TRAINING_PROGRAM_INACTIVE');
    const setup = evaluateTrainingVersionSetup(version);
    if (setup.setupState !== 'READY') {
      throw new ApiError(
        409,
        setup.setupState === 'UNASSIGNED' ? '訓練メニューに利用レンチが割り当てられていません' : '訓練メニューに利用可能なレンチがありません',
        { setupState: setup.setupState, setupStateReason: setup.setupStateReason },
        setup.setupState === 'UNASSIGNED' ? 'TRAINING_SETUP_UNASSIGNED' : 'TRAINING_SETUP_UNAVAILABLE'
      );
    }
    try {
      const session = await prisma.torqueTrainingSession.create({
        data: {
          requestId,
          programVersionId,
          employeeId: employee.id,
          employeeCodeSnapshot: employee.employeeCode,
          employeeNameSnapshot: employee.displayName,
          clientDeviceId: client.id,
          clientDeviceNameSnapshot: client.name,
          conditionFingerprint: version.conditionFingerprint,
          targetAttemptCount: 5,
          activeEmployeeKey: 'ACTIVE',
          activeClientKey: 'ACTIVE'
        },
        include: trainingSessionInclude
      });
      return serializeSession(session);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const requestWinner = await prisma.torqueTrainingSession.findUnique({ where: { requestId }, include });
        if (requestWinner) {
          if (requestWinner.employeeId !== employee.id || requestWinner.clientDeviceId !== client.id || requestWinner.programVersionId !== programVersionId) {
            throw new ApiError(409, 'requestIdは別の訓練開始要求です', undefined, 'TRAINING_REQUEST_ID_REUSED');
          }
          return serializeSession(requestWinner);
        }
        const active = await prisma.torqueTrainingSession.findFirst({ where: { employeeId: employee.id, clientDeviceId: client.id, status: 'IN_PROGRESS' }, include });
        if (active) throw new ApiError(409, '同じ社員・端末で進行中の訓練があります', undefined, 'TRAINING_SESSION_ALREADY_ACTIVE');
      }
      throw error;
    }
  }

  async getSession(sessionId: string, clientDeviceId: string) {
    const session = await prisma.torqueTrainingSession.findFirst({
      where: { id: sessionId, clientDeviceId },
      include: {
        programVersion: { include: trainingProgramVersionInclude },
        attempts: { orderBy: { recordedAt: 'asc' } },
        confirmations: true
      }
    });
    if (!session) throw new ApiError(404, '訓練セッションが見つかりません');
    return serializeSession(session);
  }

  async confirmWrench(sessionId: string, rawUid: string, profileId: string, client: Client) {
    const employee = await resolveTrainingEmployee(rawUid);
    return runTrainingTransaction(async (tx) => {
      const session = await tx.torqueTrainingSession.findUnique({ where: { id: sessionId }, include: { programVersion: true } });
      if (!session || session.clientDeviceId !== client.id) throw new ApiError(404, '訓練セッションが見つかりません');
      if (session.employeeId !== employee.id) throw new ApiError(403, '訓練者が一致しません');
      if (session.status !== 'IN_PROGRESS') throw new ApiError(409, '訓練セッションは進行中ではありません');
      const assigned = await tx.torqueTrainingProgramWrench.findUnique({ where: { programVersionId_torqueWrenchProfileId: { programVersionId: session.programVersionId, torqueWrenchProfileId: profileId } } });
      if (!assigned) throw new ApiError(409, 'この訓練版に割り当てられたレンチではありません', undefined, 'TRAINING_WRENCH_NOT_ALLOWED');
      const profile = await tx.torqueWrenchProfile.findUnique({ where: { id: profileId }, include: profileEligibilityInclude });
      const group = await tx.torqueWrenchCapabilityGroup.findUnique({ where: { id: session.programVersion.capabilityGroupId }, include: capabilityGroupEligibilityInclude });
      if (!profile || !group) throw new ApiError(404, 'レンチまたは適合グループが見つかりません');
      const eligibility = new TorqueWrenchEligibilityPolicy().evaluate(conditionFromTrainingVersion(session.programVersion), candidateFromProfile(profile, group));
      if (!eligibility.eligible) throw new ApiError(409, 'レンチが訓練条件に適合しません', { reason: eligibility.reason }, eligibility.reason);
      const setting = profile.settingHistories[0];
      if (!setting) throw new ApiError(409, 'レンチ設定履歴がありません');
      const confirmation = await tx.torqueTrainingWrenchConfirmation.create({
        data: {
          sessionId,
          torqueWrenchProfileId: profileId,
          settingHistoryId: setting.id,
          conditionFingerprint: session.conditionFingerprint,
          employeeId: employee.id,
          employeeNameSnapshot: employee.displayName,
          clientDeviceId: client.id,
          clientDeviceNameSnapshot: client.name
        }
      });
      return { id: confirmation.id, torqueWrenchProfileId: profileId, serialNumber: profile.serialNumber, settingHistoryId: setting.id };
    });
  }

  async acquireTrainingLease(input: TrainingLeaseAcquireInput) {
    return this.leaseService.acquire(input);
  }

  async releaseTrainingLease(input: TrainingLeaseTokenInput) {
    return this.leaseService.release(input);
  }

  async renewTrainingLease(input: TrainingLeaseTokenInput) {
    return this.leaseService.renew(input);
  }

  async recordAgentAttempt(input: AgentTrainingAttemptInput) {
    return runTrainingTransaction(async (tx) => {
      const existing = await tx.torqueTrainingAttempt.findUnique({ where: { sourceClientDeviceId_sourceEventKey: { sourceClientDeviceId: input.clientDeviceId, sourceEventKey: input.sourceEventKey } } });
      if (existing) return { attempt: serializeAttempt(existing), duplicate: true };
      const lockedSession = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "TorqueTrainingSession" WHERE "id" = ${input.sessionId} FOR UPDATE
      `);
      if (lockedSession.length === 0) throw new ApiError(404, '訓練セッションが見つかりません');
      const afterLockExisting = await tx.torqueTrainingAttempt.findUnique({ where: { sourceClientDeviceId_sourceEventKey: { sourceClientDeviceId: input.clientDeviceId, sourceEventKey: input.sourceEventKey } } });
      if (afterLockExisting) return { attempt: serializeAttempt(afterLockExisting), duplicate: true };
      const session = await tx.torqueTrainingSession.findUnique({ where: { id: input.sessionId }, include: { programVersion: true } });
      if (!session || session.clientDeviceId !== input.clientDeviceId) throw new ApiError(404, '訓練セッションが見つかりません');
      if (session.status !== 'IN_PROGRESS') throw new ApiError(409, '訓練セッションは完了済みです', undefined, 'TRAINING_SESSION_STATE_CONFLICT');
      const confirmationIdentity = await tx.torqueTrainingWrenchConfirmation.findFirst({
        where: { id: input.confirmationId, sessionId: input.sessionId, clientDeviceId: input.clientDeviceId },
        select: { torqueWrenchProfileId: true }
      });
      const resolvedProfileId = input.torqueWrenchProfileId ?? confirmationIdentity?.torqueWrenchProfileId;
      if (!resolvedProfileId) throw new ApiError(400, 'torqueWrenchProfileIdまたは有効なレンチ確認が必要です', undefined, 'TRAINING_PROFILE_REQUIRED');
      // Legacy outbox rows omit the profile ID. Derive it only from the same
      // session/device confirmation; an explicit mismatching ID is never
      // replaced and therefore remains a confirmation-required event.
      const confirmation = confirmationIdentity?.torqueWrenchProfileId === resolvedProfileId ? confirmationIdentity : null;
      const base = { sessionId: input.sessionId, sourceClientDeviceId: input.clientDeviceId, sourceEventKey: input.sourceEventKey, torqueWrenchProfileId: resolvedProfileId, connectionLeaseId: input.connectionLeaseId ?? null, connectionLeaseGeneration: input.connectionLeaseGeneration ?? null, deviceRecordedAt: input.deviceRecordedAt ?? null, deviceMemoryCounter: input.deviceMemoryCounter ?? null, deviceJudgement: input.deviceJudgement ?? null };
      const ignored = async (reason: string) => tx.torqueTrainingAttempt.create({ data: { ...base, judgement: 'IGNORED', accepted: false, ignoredReason: reason } });
      if (!confirmation) return { attempt: serializeAttempt(await ignored('CONFIRMATION_REQUIRED')), duplicate: false };
      const leaseValid = await this.leaseService.isCurrentForAttempt(tx, {
        sessionId: input.sessionId,
        profileId: resolvedProfileId,
        clientDeviceId: input.clientDeviceId,
        leaseId: input.connectionLeaseId,
        generation: input.connectionLeaseGeneration
      });
      if (!leaseValid) return { attempt: serializeAttempt(await ignored('LEASE_TOKEN_INVALID')), duplicate: false };
      const profile = await tx.torqueWrenchProfile.findUnique({ where: { id: resolvedProfileId }, include: profileEligibilityInclude });
      if (!profile || profile.serialNumber !== input.serialNumber) return { attempt: serializeAttempt(await ignored('SERIAL_NUMBER_MISMATCH')), duplicate: false };
      const setting = profile.settingHistories[0];
      if (!setting) return { attempt: serializeAttempt(await ignored('SETTING_HISTORY_MISSING')), duplicate: false };
      const condition = conditionFromTrainingVersion(session.programVersion);
      const expectedLower = TorqueUnitConverter.toNewtonMetres(condition.lowerLimit, condition.unit);
      const expectedNominal = TorqueUnitConverter.toNewtonMetres(condition.nominalTorque, condition.unit);
      const expectedUpper = TorqueUnitConverter.toNewtonMetres(condition.upperLimit, condition.unit);
      if (!setting.lowerLimitNm.equals(expectedLower) || !setting.nominalTorqueNm.equals(expectedNominal) || !setting.upperLimitNm.equals(expectedUpper)) return { attempt: serializeAttempt(await ignored('SETTING_MISMATCH')), duplicate: false };
      const decision = decideTrainingAttempt(input.value, input.unit, condition);
      const acceptedCount = await tx.torqueTrainingAttempt.count({ where: { sessionId: input.sessionId, accepted: true } });
      if (acceptedCount >= 5) throw new ApiError(409, '訓練試行は5回完了しています');
      const attempt = await tx.torqueTrainingAttempt.create({ data: { ...base, settingHistoryId: setting.id, attemptNo: acceptedCount + 1, value: decimal(input.value), inputUnit: input.unit, valueNm: decision.valueNm, nominalTorqueSnapshot: decision.nominalNm, lowerLimitSnapshot: decision.lowerNm, upperLimitSnapshot: decision.upperNm, deviationNm: decision.deviationNm, deviationPercent: decision.deviationPercent, absoluteDeviationPercent: decision.absoluteDeviationPercent, judgement: decision.judgement as TorqueTrainingAttemptJudgement, accepted: true, serialNumberSnapshot: profile.serialNumber, manufacturerSnapshot: profile.model.manufacturer, modelNumberSnapshot: profile.model.modelNumber } });
      if (acceptedCount + 1 === 5) {
        await tx.torqueTrainingSession.update({ where: { id: input.sessionId }, data: { status: 'COMPLETED', completedAt: new Date(), activeEmployeeKey: null, activeClientKey: null } });
        // Completion is authoritative even if the browser disappears. The
        // same token-fenced transaction releases the physical wrench and
        // appends the minimal lease history entry.
        const completionGeneration = input.connectionLeaseGeneration;
        if (input.connectionLeaseId && typeof completionGeneration === 'number' && Number.isInteger(completionGeneration)) {
          await this.leaseService.releaseExactInTransaction(tx, {
            sessionId: input.sessionId,
            profileId: resolvedProfileId,
            clientDeviceId: input.clientDeviceId,
            leaseId: input.connectionLeaseId,
            generation: completionGeneration,
            reason: 'TRAINING_COMPLETED'
          }, 'TRAINING_COMPLETED');
        }
      }
      return { attempt: serializeAttempt(attempt), duplicate: false };
    });
  }

  async cancelSession(sessionId: string, clientDeviceId: string, reason: string) {
    await runTrainingTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "TorqueTrainingSession" WHERE "id" = ${sessionId} FOR UPDATE`);
      if (locked.length === 0) throw new ApiError(404, '訓練セッションが見つかりません');
      const result = await tx.torqueTrainingSession.updateMany({ where: { id: sessionId, clientDeviceId, status: 'IN_PROGRESS' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim(), activeEmployeeKey: null, activeClientKey: null } });
      if (result.count !== 1) throw new ApiError(409, '訓練セッションを取消できません');
      await this.leaseService.releaseForSession(tx, sessionId, clientDeviceId, 'TRAINING_CANCELLED');
    });
    return { cancelled: true };
  }

  async listAdminResults() {
    const sessions = await prisma.torqueTrainingSession.findMany({ orderBy: { completedAt: 'desc' }, take: 500, include: { attempts: true, programVersion: { include: { program: true } } } });
    return sessions.map((session) => ({
      id: session.id,
      employeeCode: session.employeeCodeSnapshot,
      employeeName: session.employeeNameSnapshot,
      programCode: session.programVersion.program.code,
      programVersion: session.programVersion.version,
      conditionFingerprint: session.conditionFingerprint,
      status: session.status,
      excludedAt: session.excludedAt?.toISOString() ?? null,
      exclusionReason: session.exclusionReason,
      completedAt: session.completedAt?.toISOString() ?? null,
      metrics: summarizeTrainingAttempts(session.attempts.map((attempt) => ({ accepted: attempt.accepted, judgement: attempt.judgement, deviationPercent: attempt.deviationPercent, absoluteDeviationPercent: attempt.absoluteDeviationPercent })))
    }));
  }

  async excludeSession(
    sessionId: string,
    reason: string,
    actor: { id: string; username: string } | null,
    audit?: TorqueTrainingSettingsAuditContext
  ) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new ApiError(400, '集計対象外理由が必要です');
    return runTrainingTransaction(async (tx) => {
      const session = await tx.torqueTrainingSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new ApiError(404, '訓練セッションが見つかりません');
      const updated = await tx.torqueTrainingSession.update({
        where: { id: sessionId },
        data: {
          excludedAt: new Date(),
          exclusionReason: normalizedReason,
          // Kiosk PIN actions have no individual actor. Preserve an existing
          // ADMIN actor attribution when a session is excluded again from a
          // kiosk; the legacy ADMIN route still updates both fields below.
          ...(actor
            ? {
                excludedByUserId: actor.id,
                excludedByUsername: actor.username
              }
            : {})
        }
      });
      if (audit) {
        await appendTorqueTrainingSettingsAudit(tx, {
          ...audit,
          action: TORQUE_TRAINING_SETTINGS_AUDIT_ACTIONS.SESSION_EXCLUDED,
          targetType: 'SESSION',
          targetId: updated.id
        });
      }
      return { id: updated.id, excludedAt: updated.excludedAt?.toISOString() ?? null, exclusionReason: updated.exclusionReason };
    });
  }
}
