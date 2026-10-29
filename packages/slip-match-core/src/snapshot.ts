import type { ProductionScheduleLookupRow } from './types.js';
import type { PurchaseMatchRow } from './verify.js';

export type DatasetVersion = { version: string; dataUpdatedAt: string | null };
export type MobileDataVersions = { purchase: DatasetVersion; schedule: DatasetVersion; placements: DatasetVersion; purchaseEnrichment?: DatasetVersion };
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

export type LocalPlacementRow = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  branchNo: number;
  shelfCodeRaw: string;
  updatedAt: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  productNo: string;
  machineName: string;
};
export type PlacementTuple = [string, string, number, string, string, string, string, string, string, string];
export type PlacementsSnapshot = DatasetVersion & { rows: PlacementTuple[] };
export function packPlacement(r: LocalPlacementRow): PlacementTuple {
  return [r.id, r.manufacturingOrderBarcodeRaw, r.branchNo, r.shelfCodeRaw, r.updatedAt,
    r.fseiban, r.fhincd, r.fhinmei, r.productNo, r.machineName];
}
export function unpackPlacement(r: PlacementTuple): LocalPlacementRow {
  return { id: r[0], manufacturingOrderBarcodeRaw: r[1], branchNo: r[2], shelfCodeRaw: r[3], updatedAt: r[4],
    fseiban: r[5], fhincd: r[6], fhinmei: r[7], productNo: r[8], machineName: r[9] };
}

// Independent purchase wire contract, negotiated with format=2. Legacy tuples remain unchanged.
export type BasePurchaseRow = Omit<LocalPurchaseRow, 'masterPartName' | 'machineName' | 'plannedStartDate'>;
export type BasePurchaseTuple = [string, string, string, string, string, string, number];
export type BasePurchaseSnapshot = DatasetVersion & { format: 2; rows: BasePurchaseTuple[] };
export type MobilePurchaseSnapshot = PurchaseSnapshot | BasePurchaseSnapshot;
export function packBasePurchase(r: BasePurchaseRow): BasePurchaseTuple {
  return [r.purchaseOrderNo, r.seiban, r.purchasePartName, r.purchasePartCodeRaw,
    r.purchasePartCodeNormalized, r.purchasePartCodeMatchKey, r.acceptedQuantity];
}
export function unpackBasePurchase(r: BasePurchaseTuple): LocalPurchaseRow {
  return { purchaseOrderNo: r[0], seiban: r[1], purchasePartName: r[2], purchasePartCodeRaw: r[3],
    purchasePartCodeNormalized: r[4], purchasePartCodeMatchKey: r[5], acceptedQuantity: r[6],
    masterPartName: '', machineName: '', plannedStartDate: null };
}
export type PurchaseEnrichmentTuple =
  | ['match' | 'normalized' | 'machine', string, string]
  | ['date', string, string, string, string]; // raw seiban, raw code, raw name, ISO date
export type PurchaseEnrichmentSnapshot = DatasetVersion & { rows: PurchaseEnrichmentTuple[] };
