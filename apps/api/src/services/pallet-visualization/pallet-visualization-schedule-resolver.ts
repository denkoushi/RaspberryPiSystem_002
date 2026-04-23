import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import {
  listScheduleRowsByProductNo,
  resolveMachineNameForSeiban,
} from '../part-measurement/part-measurement-schedule-lookup.service.js';
import { normalizeSlipToken } from '../mobile-placement/mobile-placement-slip-match.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import {
  extractOutsideDimensionsDisplay,
  formatPlannedStartDateForPalletDisplay,
} from './pallet-visualization-display-fields.js';

const normalizeCd = (value: string): string => value.trim().toUpperCase();

export type ResolvedPalletScheduleSnapshot = {
  csvDashboardRowId: string;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  scheduleSnapshot: Prisma.InputJsonValue;
};

/**
 * 製造orderスキャンと資源CD（machineCd）から日程行を解決し、投影・イベント用スナップショットを組み立てる。
 */
export async function resolveScheduleSnapshotForPalletItem(
  machineCdRaw: string,
  manufacturingOrderBarcodeRaw: string
): Promise<ResolvedPalletScheduleSnapshot> {
  const machineCd = normalizeCd(machineCdRaw);
  if (!machineCd) {
    throw new ApiError(400, '加工機コードが空です', undefined, 'PALLET_MACHINE_CD_EMPTY');
  }

  const orderScan = normalizeSlipToken(manufacturingOrderBarcodeRaw);
  if (orderScan.length === 0) {
    throw new ApiError(400, '製造order番号のスキャンが空です', undefined, 'PALLET_ORDER_SCAN_EMPTY');
  }

  const candidates = await listScheduleRowsByProductNo(orderScan);
  const matched = candidates.filter((c) => normalizeCd(c.fsigencd) === machineCd);
  const candidateResourceCds = Array.from(new Set(candidates.map((c) => normalizeCd(c.fsigencd)).filter(Boolean)));
  if (matched.length === 0) {
    if (candidateResourceCds.length > 0) {
      const candidatesLabel = candidateResourceCds.slice(0, 5).join(', ');
      throw new ApiError(
        404,
        `選択中の加工機（${machineCd}）と一致しません。候補の加工機コード: ${candidatesLabel}`,
        undefined,
        'PALLET_SCHEDULE_NOT_FOUND_FOR_MACHINE'
      );
    }
    throw new ApiError(
      404,
      '製造order番号に一致する日程行がないか、選択中の加工機（資源）と一致しません',
      undefined,
      'PALLET_SCHEDULE_NOT_FOUND_FOR_MACHINE'
    );
  }

  const primary = matched[0];
  if (!primary) {
    throw new ApiError(
      404,
      '製造order番号に一致する日程行がないか、選択中の加工機（資源）と一致しません',
      undefined,
      'PALLET_SCHEDULE_NOT_FOUND_FOR_MACHINE'
    );
  }

  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: primary.rowId },
    select: {
      id: true,
      rowData: true,
      orderSupplements: {
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        take: 1,
        select: { plannedQuantity: true, plannedStartDate: true },
      },
    },
  });
  if (!row) {
    throw new ApiError(404, 'スケジュール行の取得に失敗しました', undefined, 'PALLET_SCHEDULE_ROW_MISSING');
  }

  const rd = (row.rowData ?? {}) as Record<string, unknown>;
  const supplement = row.orderSupplements[0];
  const plannedQuantity = supplement?.plannedQuantity ?? null;
  const plannedStartDateDisplay = formatPlannedStartDateForPalletDisplay(supplement?.plannedStartDate ?? null);
  const outsideDimensionsDisplay = extractOutsideDimensionsDisplay(rd);

  const scheduleSnapshot: Record<string, unknown> = {
    ProductNo: rd.ProductNo ?? null,
    FSEIBAN: rd.FSEIBAN ?? null,
    FHINCD: rd.FHINCD ?? null,
    FHINMEI: rd.FHINMEI ?? null,
    FSIGENCD: rd.FSIGENCD ?? null,
    plannedQuantity,
    plannedStartDateDisplay,
    outsideDimensionsDisplay,
  };

  const machineName = await resolveMachineNameForSeiban(primary.fseiban);

  return {
    csvDashboardRowId: row.id,
    fhincd: String(rd.FHINCD ?? primary.fhincd ?? '').trim(),
    fhinmei: String(rd.FHINMEI ?? primary.fhinmei ?? '').trim(),
    fseiban: String(rd.FSEIBAN ?? primary.fseiban ?? '').trim(),
    machineName,
    scheduleSnapshot: scheduleSnapshot as Prisma.InputJsonValue,
  };
}
