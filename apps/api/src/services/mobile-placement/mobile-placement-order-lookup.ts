import {
  listScheduleRowsByFseiban,
  listScheduleRowsByProductNo
} from '../part-measurement/part-measurement-schedule-lookup.service.js';
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

/**
 * 製番（FSEIBAN）から日程行を1件解決する。
 */
export async function resolveScheduleRowByFseiban(fseibanRaw: string) {
  const fseiban = fseibanRaw.trim();
  if (fseiban.length === 0) {
    return null;
  }
  const rows = await listScheduleRowsByFseiban(fseiban);
  return pickPrimaryScheduleRowForOrder(rows);
}
