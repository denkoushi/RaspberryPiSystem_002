import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import {
  listScheduleRowsByProductNo,
  resolveMachineNameForSeiban,
} from '../part-measurement/part-measurement-schedule-lookup.service.js';
import { normalizeSlipToken } from '../mobile-placement/mobile-placement-slip-match.js';

const normalizeCd = (value: string): string => value.trim().toUpperCase();
const DEBUG_ENDPOINT = 'http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e';
const DEBUG_SESSION_ID = '529e0f';

function postDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  // #region agent log
  void fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': DEBUG_SESSION_ID },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: 'stonebase-404-investigation',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

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
  postDebugLog('H1', 'pallet-visualization-schedule-resolver.ts:resolveScheduleSnapshotForPalletItem', 'resolver-enter', {
    machineCd,
    scanLength: manufacturingOrderBarcodeRaw.length,
  });
  if (!machineCd) {
    throw new ApiError(400, '加工機コードが空です', undefined, 'PALLET_MACHINE_CD_EMPTY');
  }

  const orderScan = normalizeSlipToken(manufacturingOrderBarcodeRaw);
  postDebugLog('H2', 'pallet-visualization-schedule-resolver.ts:resolveScheduleSnapshotForPalletItem', 'normalized-scan', {
    machineCd,
    normalizedScanLength: orderScan.length,
  });
  if (orderScan.length === 0) {
    throw new ApiError(400, '製造order番号のスキャンが空です', undefined, 'PALLET_ORDER_SCAN_EMPTY');
  }

  const candidates = await listScheduleRowsByProductNo(orderScan);
  const matched = candidates.filter((c) => normalizeCd(c.fsigencd) === machineCd);
  const candidateResourceCds = Array.from(new Set(candidates.map((c) => normalizeCd(c.fsigencd)).filter(Boolean)));
  postDebugLog('H3', 'pallet-visualization-schedule-resolver.ts:resolveScheduleSnapshotForPalletItem', 'schedule-lookup-result', {
    machineCd,
    candidateCount: candidates.length,
    matchedCount: matched.length,
    candidateResourceCds: candidateResourceCds.slice(0, 5),
  });
  if (matched.length === 0) {
    postDebugLog('H4', 'pallet-visualization-schedule-resolver.ts:resolveScheduleSnapshotForPalletItem', 'throw-not-found-for-machine', {
      machineCd,
      candidateCount: candidates.length,
      candidateResourceCds: candidateResourceCds.slice(0, 5),
    });
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
    select: { id: true, rowData: true },
  });
  if (!row) {
    throw new ApiError(404, 'スケジュール行の取得に失敗しました', undefined, 'PALLET_SCHEDULE_ROW_MISSING');
  }

  const rd = (row.rowData ?? {}) as Record<string, unknown>;
  const scheduleSnapshot: Record<string, unknown> = {
    ProductNo: rd.ProductNo ?? null,
    FSEIBAN: rd.FSEIBAN ?? null,
    FHINCD: rd.FHINCD ?? null,
    FHINMEI: rd.FHINMEI ?? null,
    FSIGENCD: rd.FSIGENCD ?? null,
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
