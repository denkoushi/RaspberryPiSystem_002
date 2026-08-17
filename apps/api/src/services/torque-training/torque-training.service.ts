import { randomUUID } from 'node:crypto';

import { Prisma, type TorqueTrainingAttemptJudgement } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { resolveActiveAssemblyOperatorNfcUid } from '../assembly/assembly-operator-nfc-resolve.service.js';
import { runTrainingTransaction } from './torque-training.transaction.js';
import {
  candidateFromProfile,
  capabilityGroupEligibilityInclude,
  profileEligibilityInclude
} from '../torque-wrenches/torque-wrench-use-context.js';
import { TorqueWrenchEligibilityPolicy, type TorqueCondition } from '../torque-wrenches/torque-wrench-eligibility.policy.js';
import { TorqueUnitConverter } from '../torque-wrenches/torque-unit-converter.js';
import {
  decideTrainingAttempt,
  summarizeTrainingAttempts,
  trainingConditionFingerprint,
  type TrainingConditionInput
} from './torque-training.policy.js';

const LEASE_TTL_MS = 8_000;
const HANDOFF_GRACE_MS = 1_000;

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

async function appendTrainingLeaseHistory(
  tx: Prisma.TransactionClient,
  input: {
    profileId: string;
    leaseId: string;
    generation: number;
    sessionId: string;
    clientDeviceId: string;
    action: string;
    reason: string;
    adoptedConfirmationId?: string | null;
  }
): Promise<void> {
  const client = await tx.clientDevice.findUnique({
    where: { id: input.clientDeviceId },
    select: { name: true }
  });
  await tx.torqueWrenchUsageLeaseHistory.create({
    data: {
      torqueWrenchProfileId: input.profileId,
      leaseId: input.leaseId,
      generation: input.generation,
      ownerKind: 'TRAINING',
      ownerTargetId: input.sessionId,
      ownerClientDeviceId: input.clientDeviceId,
      ownerClientDeviceName: client?.name ?? 'kiosk',
      action: input.action,
      adoptedConfirmationId: input.adoptedConfirmationId ?? null,
      reason: input.reason.trim().slice(0, 500)
    }
  });
}

async function releaseTrainingLeasesForSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  clientDeviceId: string,
  reason: string
): Promise<void> {
  const candidates = await tx.torqueWrenchUsageLease.findMany({
    where: {
      ownerKind: 'TRAINING',
      ownerTrainingSessionId: sessionId,
      ownerClientDeviceId: clientDeviceId,
      releasedAt: null
    },
    select: { torqueWrenchProfileId: true }
  });
  for (const candidate of candidates) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "TorqueWrenchProfile"
      WHERE "id" = ${candidate.torqueWrenchProfileId}
      FOR UPDATE
    `);
    const row = await tx.torqueWrenchUsageLease.findUnique({
      where: { torqueWrenchProfileId: candidate.torqueWrenchProfileId }
    });
    if (!row || row.releasedAt || row.ownerKind !== 'TRAINING' || row.ownerTrainingSessionId !== sessionId || row.ownerClientDeviceId !== clientDeviceId) continue;
    const releasedAt = new Date();
    await tx.torqueWrenchUsageLease.update({
      where: { torqueWrenchProfileId: candidate.torqueWrenchProfileId },
      data: { releasedAt, releaseReason: reason.trim().slice(0, 500) }
    });
    await appendTrainingLeaseHistory(tx, {
      profileId: row.torqueWrenchProfileId,
      leaseId: row.leaseId,
      generation: row.generation,
      sessionId,
      clientDeviceId,
      action: 'RELEASE',
      reason,
      adoptedConfirmationId: row.adoptedConfirmationId
    });
  }
}

function decimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function versionCondition(version: {
  id: string;
  nominalDiameter: string;
  boltLengthMm: Prisma.Decimal;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  lowerLimit: Prisma.Decimal;
  nominalTorque: Prisma.Decimal;
  upperLimit: Prisma.Decimal;
  unit: string;
}): TorqueCondition {
  return {
    templateBoltId: version.id,
    nominalDiameter: version.nominalDiameter,
    boltLengthMm: version.boltLengthMm,
    material: version.material,
    strengthClass: version.strengthClass,
    capabilityGroupId: version.capabilityGroupId,
    lowerLimit: version.lowerLimit,
    nominalTorque: version.nominalTorque,
    upperLimit: version.upperLimit,
    unit: version.unit
  };
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
  async listPrograms(includeInactive = false) {
    const programs = await prisma.torqueTrainingProgram.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ code: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: includeInactive ? undefined : 1,
          include: { wrenches: { include: { torqueWrenchProfile: { select: { id: true, serialNumber: true } } } } }
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
        torqueWrenchProfiles: version.wrenches.map((wrench) => wrench.torqueWrenchProfile)
      }))
    }));
  }

  async createProgram(input: TrainingProgramInput) {
    const normalized = normalizeProgramInput(input);
    return runTrainingTransaction(async (tx) => {
      const group = await tx.torqueWrenchCapabilityGroup.findUnique({ where: { id: normalized.capabilityGroupId } });
      if (!group || !group.isActive) throw new ApiError(400, '有効な適合グループを指定してください', undefined, 'CAPABILITY_GROUP_INVALID');
      const profiles = await tx.torqueWrenchProfile.findMany({ where: { id: { in: normalized.torqueWrenchProfileIds } }, select: { id: true } });
      if (profiles.length !== normalized.torqueWrenchProfileIds.length || profiles.length === 0) throw new ApiError(400, '利用レンチを1台以上指定してください');
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
      return program;
    });
  }

  async reviseProgram(programId: string, input: Omit<TrainingProgramInput, 'code'>) {
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
      if (profiles.length !== normalized.torqueWrenchProfileIds.length || profiles.length === 0) throw new ApiError(400, '利用レンチを1台以上指定してください');
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
      return created;
    });
  }

  async deactivateProgram(programId: string, reason: string) {
    const program = await prisma.torqueTrainingProgram.update({
      where: { id: programId },
      data: { isActive: false, deactivatedAt: new Date(), deactivationReason: reason.trim() }
    });
    return { id: program.id, isActive: program.isActive };
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
      include: { program: true }
    });
    if (!version || !version.program.isActive || version.version !== version.program.currentVersion) throw new ApiError(409, '現行版ではない訓練メニューは開始できません', undefined, 'TRAINING_PROGRAM_INACTIVE');
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
      const eligibility = new TorqueWrenchEligibilityPolicy().evaluate(versionCondition(session.programVersion), candidateFromProfile(profile, group));
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

  async acquireTrainingLease(input: { sessionId: string; profileId: string; confirmationId: string; clientDeviceId: string; requestId: string; takeover?: boolean; reason?: string }) {
    return runTrainingTransaction(async (tx) => {
      const session = await tx.torqueTrainingSession.findUnique({ where: { id: input.sessionId } });
      if (!session || session.clientDeviceId !== input.clientDeviceId || session.status !== 'IN_PROGRESS') throw new ApiError(409, '訓練セッションが接続可能な状態ではありません');
      const confirmation = await tx.torqueTrainingWrenchConfirmation.findFirst({ where: { id: input.confirmationId, sessionId: input.sessionId, torqueWrenchProfileId: input.profileId } });
      if (!confirmation) throw new ApiError(409, 'レンチ確認が必要です', undefined, 'CONFIRMATION_REQUIRED');
      // The profile row is the stable lock key. A missing lease row cannot be
      // locked by SELECT FOR UPDATE, so serialize creation on the profile.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TorqueWrenchProfile" WHERE "id" = ${input.profileId} FOR UPDATE`);
      const now = new Date();
      const current = await tx.torqueWrenchUsageLease.findUnique({ where: { torqueWrenchProfileId: input.profileId } });
      const active = current && !current.releasedAt && current.expiresAt > now;
      const sameOwner = active && current.ownerKind === 'TRAINING' && current.ownerTrainingSessionId === input.sessionId && current.ownerClientDeviceId === input.clientDeviceId;
      if (sameOwner && current.requestId === input.requestId) return { leaseId: current.leaseId, generation: current.generation, expiresAt: current.expiresAt.toISOString(), connectAfter: current.connectAfter.toISOString() };
      if (active && !sameOwner && !input.takeover) throw new ApiError(409, 'このレンチは他の端末で使用中です', undefined, 'TORQUE_WRENCH_LEASE_HELD');
      const generation = sameOwner ? current.generation : (current?.generation ?? 0) + 1;
      const leaseId = sameOwner ? current.leaseId : randomUUID();
      const connectAfter = input.takeover && active ? new Date(current.expiresAt.getTime() + HANDOFF_GRACE_MS) : now;
      const lease = await tx.torqueWrenchUsageLease.upsert({
        where: { torqueWrenchProfileId: input.profileId },
        create: { torqueWrenchProfileId: input.profileId, leaseId, generation, requestId: input.requestId, ownerKind: 'TRAINING', ownerAssemblySessionId: null, ownerTrainingSessionId: input.sessionId, ownerClientDeviceId: input.clientDeviceId, adoptedConfirmationId: input.confirmationId, expiresAt: new Date(now.getTime() + LEASE_TTL_MS), connectAfter },
        update: { leaseId, generation, requestId: input.requestId, ownerKind: 'TRAINING', ownerAssemblySessionId: null, ownerTrainingSessionId: input.sessionId, ownerClientDeviceId: input.clientDeviceId, adoptedConfirmationId: input.confirmationId, acquiredAt: now, renewedAt: now, expiresAt: new Date(now.getTime() + LEASE_TTL_MS), connectAfter, releasedAt: null, releaseReason: null }
      });
      const client = await tx.clientDevice.findUnique({ where: { id: input.clientDeviceId }, select: { name: true } });
      await tx.torqueWrenchUsageLeaseHistory.create({ data: { torqueWrenchProfileId: input.profileId, leaseId: lease.leaseId, generation: lease.generation, ownerKind: 'TRAINING', ownerTargetId: input.sessionId, ownerClientDeviceId: input.clientDeviceId, ownerClientDeviceName: client?.name ?? 'kiosk', action: input.takeover ? 'TAKEN_OVER' : sameOwner ? 'RENEWED' : 'ACQUIRE', adoptedConfirmationId: input.confirmationId, reason: input.reason?.trim() || null } });
      return { leaseId: lease.leaseId, generation: lease.generation, expiresAt: lease.expiresAt.toISOString(), connectAfter: lease.connectAfter.toISOString() };
    });
  }

  async releaseTrainingLease(input: { sessionId: string; profileId: string; clientDeviceId: string; leaseId: string; generation: number; reason?: string | null }) {
    await runTrainingTransaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "TorqueWrenchProfile"
        WHERE "id" = ${input.profileId}
        FOR UPDATE
      `);
      const now = new Date();
      const row = await tx.torqueWrenchUsageLease.findUnique({ where: { torqueWrenchProfileId: input.profileId } });
      if (!row || row.leaseId !== input.leaseId || row.generation !== input.generation || row.ownerKind !== 'TRAINING' || row.ownerTrainingSessionId !== input.sessionId || row.ownerClientDeviceId !== input.clientDeviceId) {
        throw new ApiError(409, '有効な訓練リースがありません', undefined, 'LEASE_TOKEN_INVALID');
      }
      if (row.releasedAt) throw new ApiError(409, '訓練リースはすでに解放されています', undefined, 'LEASE_TOKEN_INVALID');
      const reason = input.reason?.trim() || 'CLIENT_RELEASE';
      await tx.torqueWrenchUsageLease.update({
        where: { torqueWrenchProfileId: input.profileId },
        data: { releasedAt: now, releaseReason: reason }
      });
      await appendTrainingLeaseHistory(tx, {
        profileId: row.torqueWrenchProfileId,
        leaseId: row.leaseId,
        generation: row.generation,
        sessionId: input.sessionId,
        clientDeviceId: input.clientDeviceId,
        action: 'RELEASE',
        reason
      });
    });
    return { released: true };
  }

  async renewTrainingLease(input: { sessionId: string; profileId: string; clientDeviceId: string; leaseId: string; generation: number }) {
    const result = await runTrainingTransaction(async (tx) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
      const updated = await tx.torqueWrenchUsageLease.updateMany({
      where: {
        torqueWrenchProfileId: input.profileId,
        leaseId: input.leaseId,
        generation: input.generation,
        ownerKind: 'TRAINING',
        ownerTrainingSessionId: input.sessionId,
        ownerClientDeviceId: input.clientDeviceId,
        releasedAt: null,
        expiresAt: { gt: now }
      },
      data: { renewedAt: now, expiresAt }
      });
      const renewed = await tx.torqueWrenchUsageLease.findUnique({
        where: { torqueWrenchProfileId: input.profileId },
        select: { connectAfter: true }
      });
      return { updated, expiresAt, connectAfter: renewed?.connectAfter };
    });
    if (result.updated.count !== 1) throw new ApiError(409, '有効な訓練リースがありません', undefined, 'TORQUE_WRENCH_LEASE_EXPIRED');
    if (!result.connectAfter) throw new ApiError(409, '有効な訓練リースがありません', undefined, 'TORQUE_WRENCH_LEASE_EXPIRED');
    return { leaseId: input.leaseId, generation: input.generation, expiresAt: result.expiresAt.toISOString(), connectAfter: result.connectAfter.toISOString() };
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
      const lease = await tx.torqueWrenchUsageLease.findUnique({ where: { torqueWrenchProfileId: resolvedProfileId } });
      const base = { sessionId: input.sessionId, sourceClientDeviceId: input.clientDeviceId, sourceEventKey: input.sourceEventKey, torqueWrenchProfileId: resolvedProfileId, connectionLeaseId: input.connectionLeaseId ?? null, connectionLeaseGeneration: input.connectionLeaseGeneration ?? null, deviceRecordedAt: input.deviceRecordedAt ?? null, deviceMemoryCounter: input.deviceMemoryCounter ?? null, deviceJudgement: input.deviceJudgement ?? null };
      const ignored = async (reason: string) => tx.torqueTrainingAttempt.create({ data: { ...base, judgement: 'IGNORED', accepted: false, ignoredReason: reason } });
      if (!confirmation) return { attempt: serializeAttempt(await ignored('CONFIRMATION_REQUIRED')), duplicate: false };
      if (!lease || lease.releasedAt || lease.expiresAt <= new Date() || lease.ownerKind !== 'TRAINING' || lease.ownerTrainingSessionId !== input.sessionId || lease.ownerClientDeviceId !== input.clientDeviceId || lease.leaseId !== input.connectionLeaseId || lease.generation !== input.connectionLeaseGeneration) return { attempt: serializeAttempt(await ignored('LEASE_TOKEN_INVALID')), duplicate: false };
      const profile = await tx.torqueWrenchProfile.findUnique({ where: { id: resolvedProfileId }, include: profileEligibilityInclude });
      if (!profile || profile.serialNumber !== input.serialNumber) return { attempt: serializeAttempt(await ignored('SERIAL_NUMBER_MISMATCH')), duplicate: false };
      const setting = profile.settingHistories[0];
      if (!setting) return { attempt: serializeAttempt(await ignored('SETTING_HISTORY_MISSING')), duplicate: false };
      const condition = versionCondition(session.programVersion);
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
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "TorqueWrenchProfile"
          WHERE "id" = ${resolvedProfileId}
          FOR UPDATE
        `);
        const completionLease = await tx.torqueWrenchUsageLease.findUnique({ where: { torqueWrenchProfileId: resolvedProfileId } });
        if (completionLease && completionLease.ownerKind === 'TRAINING' && completionLease.ownerTrainingSessionId === input.sessionId && completionLease.ownerClientDeviceId === input.clientDeviceId && completionLease.leaseId === input.connectionLeaseId && completionLease.generation === input.connectionLeaseGeneration && completionLease.releasedAt === null) {
          const completionReason = 'TRAINING_COMPLETED';
          await tx.torqueWrenchUsageLease.update({ where: { torqueWrenchProfileId: resolvedProfileId }, data: { releasedAt: new Date(), releaseReason: completionReason } });
          await appendTrainingLeaseHistory(tx, { profileId: completionLease.torqueWrenchProfileId, leaseId: completionLease.leaseId, generation: completionLease.generation, sessionId: input.sessionId, clientDeviceId: input.clientDeviceId, action: 'RELEASE', reason: completionReason, adoptedConfirmationId: completionLease.adoptedConfirmationId });
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
      await releaseTrainingLeasesForSession(tx, sessionId, clientDeviceId, 'TRAINING_CANCELLED');
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

  async excludeSession(sessionId: string, reason: string, actor: { id: string; username: string }) {
    if (!reason.trim()) throw new ApiError(400, '集計対象外理由が必要です');
    const session = await prisma.torqueTrainingSession.update({ where: { id: sessionId }, data: { excludedAt: new Date(), exclusionReason: reason.trim(), excludedByUserId: actor.id, excludedByUsername: actor.username } });
    return { id: session.id, excludedAt: session.excludedAt?.toISOString() ?? null, exclusionReason: session.exclusionReason };
  }
}
