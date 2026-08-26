import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { resolveActiveAssemblyOperatorNfcUid } from '../assembly/assembly-operator-nfc-resolve.service.js';
import { appendTorqueWrenchSetting } from '../torque-wrenches/torque-wrench-setting-writer.js';
import type { EligibilityProfile } from '../torque-wrenches/torque-wrench-use-context.js';
import { TorqueTrainingLeaseService } from './torque-training-lease.service.js';
import {
  conditionFromTrainingVersion,
  evaluateTrainingProfileSetup,
  trainingSetupVersionInclude,
  type TrainingSetupVersion
} from './torque-training-setup.service.js';
import { runTrainingTransaction } from './torque-training.transaction.js';

type Client = { id: string; name: string };

export type TorqueTrainingWrenchPreparationInput = {
  uid: string;
  torqueWrenchProfileId: string;
  requestId: string;
  physicalSettingConfirmed: true;
};

type PreparationConfirmation = Prisma.TorqueTrainingWrenchConfirmationGetPayload<{
  include: {
    torqueWrenchProfile: { select: { id: true; serialNumber: true } };
    settingHistory: true;
  };
}>;

export type TorqueTrainingWrenchPreparationResult = {
  confirmationId: string;
  requestId: string;
  torqueWrenchProfileId: string;
  serialNumber: string;
  settingHistoryId: string;
  target: {
    lowerLimit: string;
    nominalTorque: string;
    upperLimit: string;
    unit: string;
  };
  confirmedAt: string;
  duplicate: boolean;
};

function serializePreparation(
  confirmation: PreparationConfirmation,
  requestId: string,
  duplicate: boolean
): TorqueTrainingWrenchPreparationResult {
  return {
    confirmationId: confirmation.id,
    requestId,
    torqueWrenchProfileId: confirmation.torqueWrenchProfileId,
    serialNumber: confirmation.torqueWrenchProfile.serialNumber,
    settingHistoryId: confirmation.settingHistoryId,
    target: {
      lowerLimit: confirmation.settingHistory.lowerLimit.toString(),
      nominalTorque: confirmation.settingHistory.nominalTorque.toString(),
      upperLimit: confirmation.settingHistory.upperLimit.toString(),
      unit: confirmation.settingHistory.unit
    },
    confirmedAt: confirmation.confirmedAt.toISOString(),
    duplicate
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

function setupVersionCondition(version: TrainingSetupVersion) {
  return conditionFromTrainingVersion(version);
}

function preparationProfile(
  version: TrainingSetupVersion,
  profileId: string
): EligibilityProfile {
  const assigned = version.wrenches.find(
    (wrench) => wrench.torqueWrenchProfile.id === profileId
  );
  if (!assigned) {
    throw new ApiError(
      409,
      'この訓練版に割り当てられたレンチではありません',
      undefined,
      'TRAINING_WRENCH_NOT_ALLOWED'
    );
  }
  return assigned.torqueWrenchProfile;
}

function isPreparationRequestUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return targetText.includes('requestId') || targetText.includes('TorqueTrainingWrenchPreparationRequest_pkey');
}

function preparationLeaseRequestId(requestId: string): string {
  return `training-preparation-lease-${requestId}`;
}

async function findPreparationByRequestId(requestId: string) {
  return prisma.torqueTrainingWrenchPreparationRequest.findUnique({
    where: { requestId },
    include: {
      confirmation: {
        include: {
          torqueWrenchProfile: { select: { id: true, serialNumber: true } },
          settingHistory: true
        }
      }
    }
  });
}

/**
 * Registers the server-derived setting and the physical confirmation as one
 * training transaction. The request key is guarded by a unique primary key in
 * the separate idempotency ledger, which is safe to add under the expand-only
 * migration contract without duplicating confirmation audit data.
 */
export class TorqueTrainingWrenchPreparationService {
  constructor(
    private readonly leaseService = new TorqueTrainingLeaseService()
  ) {}

  async prepare(
    sessionId: string,
    input: TorqueTrainingWrenchPreparationInput,
    client: Client
  ): Promise<TorqueTrainingWrenchPreparationResult> {
    if (input.physicalSettingConfirmed !== true) {
      throw new ApiError(400, 'レンチ本体の設定確認が必要です', undefined, 'PHYSICAL_SETTING_CONFIRMATION_REQUIRED');
    }
    const requestId = input.requestId.trim();
    const employee = await resolveTrainingEmployee(input.uid);

    try {
      return await runTrainingTransaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "TorqueTrainingSession" WHERE "id" = ${sessionId} FOR UPDATE
        `);
        if (locked.length === 0) throw new ApiError(404, '訓練セッションが見つかりません');

        const session = await tx.torqueTrainingSession.findUnique({
          where: { id: sessionId },
          include: { programVersion: { include: trainingSetupVersionInclude } }
        });
        if (!session || session.clientDeviceId !== client.id) {
          throw new ApiError(404, '訓練セッションが見つかりません');
        }
        if (session.employeeId !== employee.id) throw new ApiError(403, '訓練者が一致しません');

        const existingRequest = await tx.torqueTrainingWrenchPreparationRequest.findUnique({
          where: { requestId },
          include: {
            confirmation: {
              include: {
                torqueWrenchProfile: { select: { id: true, serialNumber: true } },
                settingHistory: true
              }
            }
          }
        });
        if (existingRequest) {
          const existing = existingRequest.confirmation;
          if (
            existing.sessionId !== sessionId ||
            existing.clientDeviceId !== client.id ||
            existing.employeeId !== employee.id ||
            existing.torqueWrenchProfileId !== input.torqueWrenchProfileId
          ) {
            throw new ApiError(409, 'requestIdは別のレンチ準備要求です', undefined, 'TRAINING_PREPARATION_REQUEST_ID_REUSED');
          }
          return serializePreparation(existing, requestId, true);
        }

        if (session.status !== 'IN_PROGRESS') {
          throw new ApiError(409, '訓練セッションは進行中ではありません', undefined, 'TRAINING_SESSION_STATE_CONFLICT');
        }

        const profile = preparationProfile(session.programVersion, input.torqueWrenchProfileId);
        const condition = setupVersionCondition(session.programVersion);
        const readiness = evaluateTrainingProfileSetup(
          condition,
          profile,
          session.programVersion.capabilityGroup
        );
        if (!readiness.ready) {
          throw new ApiError(
            409,
            'レンチが訓練条件に対応していません',
            { setupState: 'UNAVAILABLE', setupStateReason: readiness.reason },
            readiness.reason
          );
        }

        const setting = await appendTorqueWrenchSetting(tx, input.torqueWrenchProfileId, {
          lowerLimit: session.programVersion.lowerLimit,
          nominalTorque: session.programVersion.nominalTorque,
          upperLimit: session.programVersion.upperLimit,
          unit: session.programVersion.unit,
          reason: 'TORQUE_TRAINING_WRENCH_PREPARATION'
        });
        const confirmation = await tx.torqueTrainingWrenchConfirmation.create({
          data: {
            sessionId,
            torqueWrenchProfileId: input.torqueWrenchProfileId,
            settingHistoryId: setting.id,
            conditionFingerprint: session.conditionFingerprint,
            employeeId: employee.id,
            employeeNameSnapshot: employee.displayName,
            clientDeviceId: client.id,
            clientDeviceNameSnapshot: client.name
          },
          include: {
            torqueWrenchProfile: { select: { id: true, serialNumber: true } },
            settingHistory: true
          }
        });
        await this.leaseService.acquireInTransaction(tx, {
          sessionId,
          profileId: input.torqueWrenchProfileId,
          confirmationId: confirmation.id,
          clientDeviceId: client.id,
          requestId: preparationLeaseRequestId(requestId)
        });
        await tx.torqueTrainingWrenchPreparationRequest.create({
          data: { requestId, confirmationId: confirmation.id }
        });
        return serializePreparation(confirmation, requestId, false);
      });
    } catch (error) {
      // A database-level uniqueness race rolls back the whole interactive
      // transaction, including the just-appended setting history. Read the
      // committed winner only after that rollback and return it idempotently.
      if (!isPreparationRequestUniqueViolation(error)) throw error;
      const existingRequest = await findPreparationByRequestId(requestId);
      const existing = existingRequest?.confirmation;
      if (!existing) throw error;
      if (
        existing.sessionId !== sessionId ||
        existing.clientDeviceId !== client.id ||
        existing.employeeId !== employee.id ||
        existing.torqueWrenchProfileId !== input.torqueWrenchProfileId
      ) {
        throw new ApiError(409, 'requestIdは別のレンチ準備要求です', undefined, 'TRAINING_PREPARATION_REQUEST_ID_REUSED');
      }
      return serializePreparation(existing, requestId, true);
    }
  }
}
