import { isManufacturingOrderNo } from '@raspi-system/shared-types';

import { ApiError } from '../../../lib/errors.js';
import { resolveLocationScopeContext, type ClientDeviceForScopeResolution } from '../../../lib/location-scope-resolver.js';
import { prisma } from '../../../lib/prisma.js';
import { normalizeSlipToken } from '../../mobile-placement/mobile-placement-slip-match.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { getResourceCategoryPolicy, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { compareProcessOrder } from '../process-order.js';
import { enrichRowsWithProcessArrival } from '../process-arrival.service.js';
import { listScheduleRowsByFseiban, listScheduleRowsByProductNo } from '../production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { acquireSessakuPieceLogicalLocks } from '../sessaku-pieces/piece-key.js';
import { asRowData, planningBoardArrivalDate } from './shared.js';
import { readWinnerRowsByIds } from './source.js';
import { ensurePlanningBoardState, lockState } from './state.js';
import { readLivePieceKeys, resolveCurrentProjectionInTransaction } from './write.js';
import { discoverSourceRows } from './write-source.js';

/**
 * A manufacturing order number (移動票) matches its own rows. A purchase order number (現品票) has no
 * schedule rows of its own, so it is resolved through the purchase data to its seiban and part code.
 * `productNos` is null when the scanned value itself is the ProductNo.
 */
async function listScanCandidates(scanned: string) {
  const byProductNo = await listScheduleRowsByProductNo(scanned);
  if (byProductNo.length || !isManufacturingOrderNo(scanned)) return { rows: byProductNo, productNos: null };
  const purchases = await findPurchaseOrderLookupRows(scanned);
  const seibans = new Set(purchases.map((row) => row.seiban.trim()).filter(Boolean));
  if (seibans.size !== 1) return { rows: [], productNos: null };
  const partCodes = new Set(purchases.flatMap((row) => [row.purchasePartCodeRaw, row.purchasePartCodeNormalized])
    .map((code) => code.trim().toUpperCase()).filter(Boolean));
  const rows = (await listScheduleRowsByFseiban([...seibans][0]!))
    .filter((row) => partCodes.has(row.fhincd.trim().toUpperCase()));
  return { rows, productNos: new Set(rows.map((row) => row.productNo.trim())) };
}

export async function applyGrindingPlanningBoardScanArrival(params: {
  clientDevice: ClientDeviceForScopeResolution;
  manufacturingOrderBarcodeRaw: string;
}) {
  const siteRequired = () => new ApiError(400, '研削の着スキャンには端末の拠点設定が必要です', undefined, 'HAIZEN_SCAN_SITE_REQUIRED');
  let siteKey: string;
  try {
    siteKey = resolveLocationScopeContext(params.clientDevice).siteKey;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SITE_NOT_ASSIGNED') throw siteRequired();
    throw error;
  }
  if (['shared', 'default'].includes(siteKey.toLowerCase())) throw siteRequired();
  const productNo = normalizeSlipToken(params.manufacturingOrderBarcodeRaw);
  const unresolved = () => ({ resolutionStatus: 'UNRESOLVED' as const, arrival: { productNo, reason: 'NO_INCOMPLETE_GRINDING_PROCESS' } });
  const policy = await getResourceCategoryPolicy({ siteKey });
  const scan = await listScanCandidates(productNo);
  const matchesProductNo = (value: string) => (scan.productNos ? scan.productNos.has(value.trim()) : value.trim() === productNo);
  const candidates = scan.rows
    .filter((row) => policy.grindingResourceCds.includes(normalizeProductionScheduleResourceCd(row.fsigencd)));
  if (!candidates.length) return unresolved();
  // Preserve the raw logical-key values (including zero-padded FKOJUN).
  const rows = await readWinnerRowsByIds(prisma, candidates.map((row) => row.rowId));
  const itemIds = rows.map((row) => buildGrindingPlanningBoardRowItemId(asRowData(row.rowData)));
  if (!itemIds.length) return unresolved();
  const sourceRows = await discoverSourceRows(itemIds);
  const sourceRowIds = [...new Set(sourceRows.values())].sort();
  await ensurePlanningBoardState(siteKey);
  const pieceKeys = await readLivePieceKeys(prisma, sourceRowIds);
  return prisma.$transaction(async (client) => {
    await acquireSessakuPieceLogicalLocks(client, pieceKeys);
    if (pieceKeys.length) await lockState(client, siteKey);
    for (const rowId of sourceRowIds) await acquireProductionScheduleParentRowLockInTransaction(client, rowId);
    // A CSV import between discovery and the locks can replace a winner row; skipping it would mark a later process.
    if ((await readWinnerRowsByIds(client, sourceRowIds)).length !== sourceRowIds.length) {
      throw new ApiError(409, '日程データが更新されました。もう一度スキャンしてください', undefined, 'HAIZEN_SCAN_STALE_SOURCE');
    }
    // The board projection owns completion (local progress OR external completion).
    const current = await resolveCurrentProjectionInTransaction({ client, siteKey, sourceRowIds, itemIds: [], policy, allowPieceParent: true });
    const item = [...current.byItemId.values()]
      .filter((entry) => matchesProductNo(entry.productNo) && !entry.isCompleted &&
        policy.grindingResourceCds.includes(normalizeProductionScheduleResourceCd(entry.originalResourceCd ?? '')))
      .sort((a, b) => compareProcessOrder(a.processOrder, b.processOrder) || a.itemId.localeCompare(b.itemId))[0];
    if (!item) return unresolved();
    const [arrival] = await enrichRowsWithProcessArrival([{
      id: item.itemId, sourceRowId: item.sourceRowId,
      rowData: { FSEIBAN: item.fseiban, FHINCD: item.fhincd, ProductNo: item.productNo, FKOJUN: item.processOrder }
    }], { siteKey, locationKey: siteKey, includeFirstProcess: true, placedProductNos: new Set(), client, policy });
    const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.parentItemId ?? item.itemId };
    if (arrival?.isFirstProcess) {
      const data = { state: 'arrived', recordedAt: new Date() };
      await client.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert({
        where: { csvDashboardId_siteKey_itemKey: key }, create: { ...key, ...data }, update: data
      });
    } else {
      const existing = await client.productionScheduleGrindingPlanningBoardArrival.findFirst({ where: key });
      if (!existing) {
        await client.productionScheduleGrindingPlanningBoardArrival.create({
          data: { ...key, arrivalDate: new Date(`${planningBoardArrivalDate()}T00:00:00.000Z`) }
        });
      }
    }
    return { resolutionStatus: 'RESOLVED' as const, arrival: { productNo, siteKey, itemId: item.itemId, itemKey: key.itemKey, isFirstProcess: Boolean(arrival?.isFirstProcess) } };
  }, { timeout: 30000, maxWait: 15000 });
}
