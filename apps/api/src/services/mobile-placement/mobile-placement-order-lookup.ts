import { listScheduleRowsByProductNo } from '../part-measurement/part-measurement-schedule-lookup.service.js';
import { pickPrimaryScheduleRowForOrder } from './mobile-placement-slip-match.js';

/**
 * 製造order番号（ProductNo）から日程行を1件解決する。
 */
export async function resolveScheduleRowByProductNo(productNoBarcodeRaw: string) {
  const productNo = productNoBarcodeRaw.trim();
  if (productNo.length === 0) {
    return null;
  }
  const rows = await listScheduleRowsByProductNo(productNo);
  return pickPrimaryScheduleRowForOrder(rows);
}
