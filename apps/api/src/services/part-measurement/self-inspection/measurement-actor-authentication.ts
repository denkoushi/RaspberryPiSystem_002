import type { Prisma, SelfInspectionMeasurementActorMode } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';

export type MeasurementActorAuthenticationInput = {
  employeeTagUid: string;
  measurementMode: 'operator' | 'inspector';
  clientDeviceId?: string | null;
};

export type MeasurementActorAuthenticationContext = {
  id: string;
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  employeeNfcTagUidSnapshot: string;
  mode: SelfInspectionMeasurementActorMode;
};

function toActorMode(mode: MeasurementActorAuthenticationInput['measurementMode']): SelfInspectionMeasurementActorMode {
  return mode === 'inspector' ? 'INSPECTOR' : 'OPERATOR';
}

function serializeActorMode(mode: SelfInspectionMeasurementActorMode): 'operator' | 'inspector' {
  return mode === 'INSPECTOR' ? 'inspector' : 'operator';
}

/** NFCを受け付けた時点の社員・端末・モードを不変に記録する。 */
export async function createMeasurementActorAuthentication(
  db: Prisma.TransactionClient,
  sessionId: string,
  input: MeasurementActorAuthenticationInput
) {
  const uid = input.employeeTagUid.trim();
  if (!uid) {
    throw new ApiError(400, '測定者のNFCタグが必要です');
  }
  const session = await db.selfInspectionSession.findUnique({
    where: { id: sessionId },
    select: { id: true, completedAt: true }
  });
  if (!session) throw new ApiError(404, '自主検査セッションが見つかりません');
  if (session.completedAt) throw new ApiError(409, '完了済みの自主検査は認証できません');

  const employee = await db.employee.findFirst({
    where: { nfcTagUid: uid },
    select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true, status: true }
  });
  if (!employee?.nfcTagUid) {
    throw new ApiError(404, '従業員のNFCタグが登録されていません');
  }
  if (employee.status !== 'ACTIVE') {
    throw new ApiError(403, '有効な社員のみ自主検査を入力できます');
  }

  if (!input.clientDeviceId) {
    throw new ApiError(401, 'キオスク端末の識別が必要です');
  }
  const clientDevice = await db.clientDevice.findUnique({
    where: { id: input.clientDeviceId },
    select: { id: true, name: true }
  });
  if (!clientDevice) {
    throw new ApiError(401, 'キオスク端末を確認できません');
  }

  const authentication = await db.selfInspectionMeasurementActorAuthentication.create({
    data: {
      sessionId,
      mode: toActorMode(input.measurementMode),
      employeeId: employee.id,
      employeeCodeSnapshot: employee.employeeCode,
      employeeNameSnapshot: employee.displayName,
      employeeNfcTagUidSnapshot: employee.nfcTagUid,
      clientDeviceId: clientDevice.id,
      clientDeviceNameSnapshot: clientDevice.name
    }
  });
  return {
    id: authentication.id,
    measurementMode: serializeActorMode(authentication.mode),
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName
    },
    authenticatedAt: authentication.authenticatedAt.toISOString()
  };
}

/** 変更系APIの境界。別セッション・別モード・別端末の認証IDをfail-closedで拒否する。 */
export async function requireMeasurementActorAuthentication(
  db: Prisma.TransactionClient,
  input: {
    sessionId: string;
    authenticationId: string | null | undefined;
    mode: SelfInspectionMeasurementActorMode;
    clientDeviceId?: string | null;
  }
): Promise<MeasurementActorAuthenticationContext> {
  const authenticationId = input.authenticationId?.trim();
  if (!authenticationId) {
    throw new ApiError(401, 'この画面で測定者NFCタグをスキャンしてください');
  }
  const authentication = await db.selfInspectionMeasurementActorAuthentication.findUnique({
    where: { id: authenticationId },
    include: { employee: { select: { status: true } } }
  });
  if (!authentication || authentication.sessionId !== input.sessionId || authentication.mode !== input.mode) {
    throw new ApiError(403, 'この自主検査画面のNFC認証が必要です');
  }
  if ((authentication.clientDeviceId ?? null) !== (input.clientDeviceId ?? null)) {
    throw new ApiError(403, '別のキオスク端末で認証されたNFCタグは使用できません');
  }
  if (!authentication.employeeId || authentication.employee?.status !== 'ACTIVE') {
    throw new ApiError(403, '有効な社員のNFC認証が必要です');
  }
  return {
    id: authentication.id,
    employeeId: authentication.employeeId,
    employeeCodeSnapshot: authentication.employeeCodeSnapshot,
    employeeNameSnapshot: authentication.employeeNameSnapshot,
    employeeNfcTagUidSnapshot: authentication.employeeNfcTagUidSnapshot,
    mode: authentication.mode
  };
}

export async function appendMeasurementOperation(
  db: Prisma.TransactionClient,
  input: {
    sessionId: string;
    authenticationId: string;
    mode: SelfInspectionMeasurementActorMode;
    entryIndex: number | null;
    operationKind: 'DRAFT_AUTOSAVED' | 'ENTRY_CONFIRMED' | 'INSTRUMENT_PRE_USE';
  }
): Promise<void> {
  await db.selfInspectionMeasurementOperation.create({ data: input });
}
