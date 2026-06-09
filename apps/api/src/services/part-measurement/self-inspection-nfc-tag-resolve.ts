import { prisma } from '../../lib/prisma.js';

import {
  isMeasuringInstrumentAvailableForSelfInspection
} from './self-inspection-measuring-instrument-eligibility.js';

export type SelfInspectionNfcTagResolveKind =
  | 'employee'
  | 'instrument'
  | 'unknown'
  | 'duplicate'
  | 'instrument_unavailable';

export type SelfInspectionNfcTagResolveResult =
  | {
      kind: 'employee';
      employee: { id: string; displayName: string; nfcTagUid: string };
    }
  | {
      kind: 'instrument';
      instrument: {
        id: string;
        name: string;
        managementNumber: string;
        tagUid: string;
      };
    }
  | { kind: 'unknown' }
  | { kind: 'duplicate' }
  | { kind: 'instrument_unavailable'; reason: 'retired' };

/** NFC UID を社員 / 計測機器 / 未知 / 重複に解決する（自主検査登録用） */
export async function resolveSelfInspectionNfcTagUid(
  rawUid: string
): Promise<SelfInspectionNfcTagResolveResult> {
  const uid = rawUid.trim();
  if (!uid) {
    return { kind: 'unknown' };
  }

  const [employee, instrumentTag] = await Promise.all([
    prisma.employee.findFirst({
      where: { nfcTagUid: uid },
      select: { id: true, displayName: true, nfcTagUid: true }
    }),
    prisma.measuringInstrumentTag.findUnique({
      where: { rfidTagUid: uid },
      include: {
        measuringInstrument: {
          select: { id: true, name: true, managementNumber: true, status: true }
        }
      }
    })
  ]);

  const hasEmployee = Boolean(employee?.nfcTagUid);
  const hasInstrument = Boolean(instrumentTag?.measuringInstrument);

  if (hasEmployee && hasInstrument) {
    return { kind: 'duplicate' };
  }

  if (hasEmployee && employee) {
    return {
      kind: 'employee',
      employee: {
        id: employee.id,
        displayName: employee.displayName,
        nfcTagUid: employee.nfcTagUid!
      }
    };
  }

  if (hasInstrument && instrumentTag?.measuringInstrument) {
    if (!isMeasuringInstrumentAvailableForSelfInspection(instrumentTag.measuringInstrument.status)) {
      return { kind: 'instrument_unavailable', reason: 'retired' };
    }
    return {
      kind: 'instrument',
      instrument: {
        id: instrumentTag.measuringInstrument.id,
        name: instrumentTag.measuringInstrument.name,
        managementNumber: instrumentTag.measuringInstrument.managementNumber,
        tagUid: uid
      }
    };
  }

  return { kind: 'unknown' };
}

export function isSelfInspectionLotEntryRegistrationComplete(entry: {
  createdByEmployeeId: string | null;
  measuringInstrumentId: string | null;
}): boolean {
  return Boolean(entry.createdByEmployeeId && entry.measuringInstrumentId);
}
