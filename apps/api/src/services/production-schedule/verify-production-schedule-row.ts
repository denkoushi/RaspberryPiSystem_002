import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function readRowField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** 生産日程行が期待する製造order・製番・品番・資源CDと一致するか検証する */
export async function verifyProductionScheduleRowOrThrow(
  scheduleRowId: string,
  expected: {
    productNo: string;
    fseiban?: string | null;
    fhincd?: string;
    resourceCd?: string;
  }
): Promise<void> {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: scheduleRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  if (!row) {
    throw new ApiError(400, '日程行が見つかりません');
  }
  const data = row.rowData as Record<string, unknown>;
  const pn = readRowField(data, 'ProductNo');
  const fs = readRowField(data, 'FSEIBAN');
  if (pn !== normalizeText(expected.productNo)) {
    throw new ApiError(400, '日程行が製造order番号と一致しません');
  }
  if (expected.fseiban != null && normalizeText(expected.fseiban) !== '') {
    if (fs !== normalizeText(expected.fseiban)) {
      throw new ApiError(400, '日程行が製番と一致しません');
    }
  }
  if (expected.fhincd) {
    const fhincd = readRowField(data, 'FHINCD');
    if (fhincd !== normalizeText(expected.fhincd)) {
      throw new ApiError(400, '日程行の品番が一致しません');
    }
  }
  if (expected.resourceCd) {
    const resourceCd = readRowField(data, 'FSIGENCD');
    if (resourceCd !== normalizeText(expected.resourceCd)) {
      throw new ApiError(400, '日程行の資源CDが一致しません');
    }
  }
}
