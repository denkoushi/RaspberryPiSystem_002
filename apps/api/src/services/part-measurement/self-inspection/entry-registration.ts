import type { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertMeasuringInstrumentAvailableForSelfInspection } from '../self-inspection-measuring-instrument-eligibility.js';
import { assertSelfInspectionEntryRegistrationTagUids } from '../self-inspection-registration-tag-validation.js';
import type { SelfInspectionRegistrationRequirementPolicy } from '../self-inspection-registration-policy.service.js';
import { normalizeText } from './shared.js';


export async function resolveEntryActor(employeeTagUid?: string | null): Promise<{
  createdByEmployeeId: string | null;
  createdByEmployeeNameSnapshot: string | null;
}> {
  const tag = (employeeTagUid ?? '').trim();
  if (!tag) {
    return { createdByEmployeeId: null, createdByEmployeeNameSnapshot: null };
  }
  const employee = await prisma.employee.findFirst({
    where: { nfcTagUid: tag }
  });
  if (!employee) {
    throw new ApiError(404, '従業員が登録されていません');
  }
  return {
    createdByEmployeeId: employee.id,
    createdByEmployeeNameSnapshot: employee.displayName
  };
}

export async function resolveEntryActorRequired(employeeTagUid?: string | null): Promise<{
  createdByEmployeeId: string;
  createdByEmployeeNameSnapshot: string;
}> {
  const tag = (employeeTagUid ?? '').trim();
  if (!tag) {
    throw new ApiError(400, '測定者のNFCタグが必要です');
  }
  const resolved = await resolveEntryActor(tag);
  return {
    createdByEmployeeId: resolved.createdByEmployeeId!,
    createdByEmployeeNameSnapshot: resolved.createdByEmployeeNameSnapshot!
  };
}

export async function resolveMeasuringInstrumentByTag(measuringInstrumentTagUid?: string | null): Promise<{
  measuringInstrumentId: string;
  measuringInstrumentManagementNumberSnapshot: string;
  measuringInstrumentNameSnapshot: string;
  measuringInstrumentTagUidSnapshot: string;
}> {
  const tag = (measuringInstrumentTagUid ?? '').trim();
  if (!tag) {
    throw new ApiError(400, '計測機器のNFCタグが必要です');
  }
  const instrumentTag = await prisma.measuringInstrumentTag.findUnique({
    where: { rfidTagUid: tag },
    include: { measuringInstrument: true }
  });
  if (!instrumentTag?.measuringInstrument) {
    throw new ApiError(404, '計測機器が登録されていません');
  }
  assertMeasuringInstrumentAvailableForSelfInspection(instrumentTag.measuringInstrument);
  return {
    measuringInstrumentId: instrumentTag.measuringInstrument.id,
    measuringInstrumentManagementNumberSnapshot: instrumentTag.measuringInstrument.managementNumber,
    measuringInstrumentNameSnapshot: instrumentTag.measuringInstrument.name,
    measuringInstrumentTagUidSnapshot: tag
  };
}

export function entryRegistrationFromRow(entry: {
  createdByEmployeeId: string | null;
  createdByEmployeeNameSnapshot: string | null;
  measuringInstrumentId: string | null;
  measuringInstrumentManagementNumberSnapshot: string | null;
  measuringInstrumentNameSnapshot: string | null;
  measuringInstrumentTagUidSnapshot: string | null;
}) {
  return {
    createdByEmployeeId: entry.createdByEmployeeId,
    createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
    measuringInstrumentId: entry.measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot
  };
}

export async function resolveRegistrationForCreateEntry(
  existingEntry: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  } | null,
  input: {
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    createdByEmployeeId?: string | null;
    createdByEmployeeNameSnapshot?: string | null;
  },
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const isNew = !existingEntry;
  let createdByEmployeeId = existingEntry?.createdByEmployeeId ?? null;
  let createdByEmployeeNameSnapshot = existingEntry?.createdByEmployeeNameSnapshot ?? null;
  let measuringInstrumentId = existingEntry?.measuringInstrumentId ?? null;
  let measuringInstrumentManagementNumberSnapshot =
    existingEntry?.measuringInstrumentManagementNumberSnapshot ?? null;
  let measuringInstrumentNameSnapshot = existingEntry?.measuringInstrumentNameSnapshot ?? null;
  let measuringInstrumentTagUidSnapshot = existingEntry?.measuringInstrumentTagUidSnapshot ?? null;

  const pendingEmployeeTag = !createdByEmployeeId ? (input.employeeTagUid ?? '').trim() : '';
  const pendingInstrumentTag = !measuringInstrumentId ? (input.measuringInstrumentTagUid ?? '').trim() : '';
  await assertSelfInspectionEntryRegistrationTagUids({
    employeeTagUid: pendingEmployeeTag || null,
    measuringInstrumentTagUid: pendingInstrumentTag || null
  });

  if (!createdByEmployeeId) {
    if (input.createdByEmployeeId != null || input.createdByEmployeeNameSnapshot != null) {
      createdByEmployeeId = input.createdByEmployeeId ?? null;
      createdByEmployeeNameSnapshot = normalizeText(input.createdByEmployeeNameSnapshot) || null;
    } else if ((input.employeeTagUid ?? '').trim()) {
      const actor = await resolveEntryActorRequired(input.employeeTagUid);
      createdByEmployeeId = actor.createdByEmployeeId;
      createdByEmployeeNameSnapshot = actor.createdByEmployeeNameSnapshot;
    } else if (isNew) {
      throw new ApiError(400, '測定者のNFCタグが必要です');
    }
  }

  if (!measuringInstrumentId) {
    if ((input.measuringInstrumentTagUid ?? '').trim()) {
      const instrument = await resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
      measuringInstrumentId = instrument.measuringInstrumentId;
      measuringInstrumentManagementNumberSnapshot =
        instrument.measuringInstrumentManagementNumberSnapshot;
      measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
      measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
    } else if (isNew && registrationPolicy.requireMeasuringInstrumentTag) {
      throw new ApiError(400, '計測機器のNFCタグが必要です');
    }
  }

  return {
    createdByEmployeeId,
    createdByEmployeeNameSnapshot,
    measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot
  };
}

export function buildRegistrationBackfillData(
  existingEntry: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  },
  resolved: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  }
) {
  const data: {
    createdByEmployeeId?: string;
    createdByEmployeeNameSnapshot?: string;
    measuringInstrumentId?: string;
    measuringInstrumentManagementNumberSnapshot?: string;
    measuringInstrumentNameSnapshot?: string;
    measuringInstrumentTagUidSnapshot?: string;
  } = {};
  if (!existingEntry.createdByEmployeeId && resolved.createdByEmployeeId) {
    data.createdByEmployeeId = resolved.createdByEmployeeId;
    data.createdByEmployeeNameSnapshot = resolved.createdByEmployeeNameSnapshot ?? undefined;
  }
  if (!existingEntry.measuringInstrumentId && resolved.measuringInstrumentId) {
    data.measuringInstrumentId = resolved.measuringInstrumentId;
    data.measuringInstrumentManagementNumberSnapshot =
      resolved.measuringInstrumentManagementNumberSnapshot ?? undefined;
    data.measuringInstrumentNameSnapshot = resolved.measuringInstrumentNameSnapshot ?? undefined;
    data.measuringInstrumentTagUidSnapshot = resolved.measuringInstrumentTagUidSnapshot ?? undefined;
  }
  return Object.keys(data).length > 0 ? data : null;
}

export async function resolveRegistrationPatchForUpdate(
  existingEntry: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  },
  input: {
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    createdByEmployeeId?: string | null;
    createdByEmployeeNameSnapshot?: string | null;
  },
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const patch: {
    createdByEmployeeId?: string;
    createdByEmployeeNameSnapshot?: string;
    measuringInstrumentId?: string;
    measuringInstrumentManagementNumberSnapshot?: string;
    measuringInstrumentNameSnapshot?: string;
    measuringInstrumentTagUidSnapshot?: string;
  } = {};

  const pendingEmployeeTag = !existingEntry.createdByEmployeeId ? (input.employeeTagUid ?? '').trim() : '';
  const pendingInstrumentTag = !existingEntry.measuringInstrumentId
    ? (input.measuringInstrumentTagUid ?? '').trim()
    : '';
  await assertSelfInspectionEntryRegistrationTagUids({
    employeeTagUid: pendingEmployeeTag || null,
    measuringInstrumentTagUid: pendingInstrumentTag || null
  });

  if (!existingEntry.createdByEmployeeId) {
    if (input.createdByEmployeeId) {
      patch.createdByEmployeeId = input.createdByEmployeeId;
      patch.createdByEmployeeNameSnapshot = normalizeText(input.createdByEmployeeNameSnapshot) || undefined;
    } else {
      const actor = await resolveEntryActorRequired(input.employeeTagUid);
      patch.createdByEmployeeId = actor.createdByEmployeeId;
      patch.createdByEmployeeNameSnapshot = actor.createdByEmployeeNameSnapshot;
    }
  }

  if (!existingEntry.measuringInstrumentId && (input.measuringInstrumentTagUid ?? '').trim()) {
    const instrument = await resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
    patch.measuringInstrumentId = instrument.measuringInstrumentId;
    patch.measuringInstrumentManagementNumberSnapshot =
      instrument.measuringInstrumentManagementNumberSnapshot;
    patch.measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
    patch.measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
  } else if (!existingEntry.measuringInstrumentId && registrationPolicy.requireMeasuringInstrumentTag) {
    await resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
  }

  return patch;
}

export async function resolveInspectorEmployeeRequired(
  db: Prisma.TransactionClient,
  employeeTagUid?: string | null
) {
  const tag = (employeeTagUid ?? '').trim();
  if (!tag) {
    throw new ApiError(400, '検査員の社員NFCタグが必要です');
  }
  const employee = await db.employee.findFirst({
    where: { nfcTagUid: tag },
    select: {
      id: true,
      employeeCode: true,
      displayName: true,
      nfcTagUid: true,
      status: true
    }
  });
  if (!employee?.nfcTagUid) {
    throw new ApiError(404, '検査員の社員NFCタグが登録されていません');
  }
  if (employee.status !== 'ACTIVE') {
    throw new ApiError(403, '有効な社員のみ検査員として測定できます');
  }
  return employee;
}

export async function resolveInspectorRegistrationForSave(
  db: Prisma.TransactionClient,
  existingEntry: {
    inspectorEmployeeId: string | null;
    inspectorEmployeeCodeSnapshot: string | null;
    inspectorEmployeeNameSnapshot: string | null;
    inspectorEmployeeNfcTagUidSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  } | null,
  operatorEntry: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
  },
  input: {
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    inspectorEmployeeId?: string | null;
    inspectorEmployeeCodeSnapshot?: string | null;
    inspectorEmployeeNameSnapshot?: string | null;
    inspectorEmployeeNfcTagUidSnapshot?: string | null;
  },
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  let inspectorEmployeeId = existingEntry?.inspectorEmployeeId ?? null;
  let inspectorEmployeeCodeSnapshot = existingEntry?.inspectorEmployeeCodeSnapshot ?? null;
  let inspectorEmployeeNameSnapshot = existingEntry?.inspectorEmployeeNameSnapshot ?? null;
  let inspectorEmployeeNfcTagUidSnapshot = existingEntry?.inspectorEmployeeNfcTagUidSnapshot ?? null;
  let measuringInstrumentId = existingEntry?.measuringInstrumentId ?? null;
  let measuringInstrumentManagementNumberSnapshot =
    existingEntry?.measuringInstrumentManagementNumberSnapshot ?? null;
  let measuringInstrumentNameSnapshot = existingEntry?.measuringInstrumentNameSnapshot ?? null;
  let measuringInstrumentTagUidSnapshot = existingEntry?.measuringInstrumentTagUidSnapshot ?? null;

  const pendingEmployeeTag = !inspectorEmployeeId ? (input.employeeTagUid ?? '').trim() : '';
  const pendingInstrumentTag = !measuringInstrumentId ? (input.measuringInstrumentTagUid ?? '').trim() : '';
  await assertSelfInspectionEntryRegistrationTagUids({
    employeeTagUid: pendingEmployeeTag || null,
    measuringInstrumentTagUid: pendingInstrumentTag || null
  });

  if (!inspectorEmployeeId) {
    const employee = input.inspectorEmployeeId
      ? {
          id: input.inspectorEmployeeId,
          employeeCode: input.inspectorEmployeeCodeSnapshot ?? '',
          displayName: input.inspectorEmployeeNameSnapshot ?? '',
          nfcTagUid: input.inspectorEmployeeNfcTagUidSnapshot ?? ''
        }
      : await resolveInspectorEmployeeRequired(db, input.employeeTagUid);
    if (!employee.id || !employee.employeeCode || !employee.displayName || !employee.nfcTagUid) {
      throw new ApiError(403, '有効な検査員NFC認証が必要です');
    }
    if (operatorEntry.createdByEmployeeId && operatorEntry.createdByEmployeeId === employee.id) {
      throw new ApiError(409, '検査員はオペレータ本人とは別の社員を登録してください');
    }
    inspectorEmployeeId = employee.id;
    inspectorEmployeeCodeSnapshot = employee.employeeCode;
    inspectorEmployeeNameSnapshot = employee.displayName;
    inspectorEmployeeNfcTagUidSnapshot = employee.nfcTagUid;
  } else if (operatorEntry.createdByEmployeeId && operatorEntry.createdByEmployeeId === inspectorEmployeeId) {
    throw new ApiError(409, '検査員はオペレータ本人とは別の社員を登録してください');
  }

  if (!measuringInstrumentId) {
    if ((input.measuringInstrumentTagUid ?? '').trim()) {
      const instrument = await resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
      measuringInstrumentId = instrument.measuringInstrumentId;
      measuringInstrumentManagementNumberSnapshot =
        instrument.measuringInstrumentManagementNumberSnapshot;
      measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
      measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
    } else if (registrationPolicy.requireMeasuringInstrumentTag) {
      throw new ApiError(400, '計測機器のNFCタグが必要です');
    }
  }

  return {
    inspectorEmployeeId,
    inspectorEmployeeCodeSnapshot,
    inspectorEmployeeNameSnapshot,
    inspectorEmployeeNfcTagUidSnapshot,
    measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot
  };
}
