import type { ProductionScheduleLookupRow } from './types.js';
import type { PurchaseMatchRow } from './verify.js';

export type DatasetVersion = { version: string; dataUpdatedAt: string | null };
export type MobileDataVersions = { purchase: DatasetVersion; schedule: DatasetVersion };
export type LocalPurchaseRow = PurchaseMatchRow & {
  purchaseOrderNo: string;
  masterPartName: string;
  machineName: string;
  purchasePartCodeNormalized: string;
  acceptedQuantity: number;
  plannedStartDate: string | null;
};
// Fixed column order is the v1 wire contract. No repeated JSON property names per row.
export type PurchaseTuple = [string, string, string, string, string, string, string, string, number, string | null];
export type ScheduleTuple = [string, string, string, string, string, string, number | null];
export type PurchaseSnapshot = DatasetVersion & { rows: PurchaseTuple[] };
export type ScheduleSnapshot = DatasetVersion & { rows: ScheduleTuple[]; knownFseibans: string[] };
export function packPurchase(r: LocalPurchaseRow): PurchaseTuple {
  return [r.purchaseOrderNo, r.seiban, r.purchasePartName, r.masterPartName, r.machineName,
    r.purchasePartCodeRaw, r.purchasePartCodeNormalized, r.purchasePartCodeMatchKey, r.acceptedQuantity, r.plannedStartDate];
}
export function unpackPurchase(r: PurchaseTuple): LocalPurchaseRow {
  return { purchaseOrderNo: r[0], seiban: r[1], purchasePartName: r[2], masterPartName: r[3], machineName: r[4],
    purchasePartCodeRaw: r[5], purchasePartCodeNormalized: r[6], purchasePartCodeMatchKey: r[7], acceptedQuantity: r[8], plannedStartDate: r[9] };
}
export function packSchedule(r: ProductionScheduleLookupRow): ScheduleTuple {
  return [r.rowId, r.fseiban, r.productNo, r.fhincd, r.fhinmei, r.fsigencd, r.fkojun];
}
export function unpackSchedule(r: ScheduleTuple): ProductionScheduleLookupRow {
  return { rowId: r[0], fseiban: r[1], productNo: r[2], fhincd: r[3], fhinmei: r[4], fsigencd: r[5], fkojun: r[6] };
}
