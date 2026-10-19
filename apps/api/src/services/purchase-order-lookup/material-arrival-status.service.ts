import { Prisma } from '@prisma/client';
import type { MaterialArrivalBasis, MaterialArrivalStatus } from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../production-schedule/constants.js';
import { normalizePurchaseFhinCdForMatching } from './purchase-fhincd-normalize.js';

/**
 * 材料として発注された購買行か。加工品の品番に `(A)`（素材・鋳物）または
 * 末尾 `-001`（材料）/ `-002`（鋳物）が付く。型費・再処理などの他の枝番や、
 * 付加なしの行（部品そのものの購買）は材料ではない。
 */
export function isMaterialPurchasePartCode(purchasePartCodeRaw: string): boolean {
  const code = String(purchasePartCodeRaw ?? '').trim();
  if (/\(A\)/i.test(code)) return true;
  return /-00[12](-[0-9]+)?$/.test(code.replace(/\([^)]*\)/g, '').trim());
}

/** 遅れている順。複数の材料行があれば最も遅れているものを表示する。 */
const SEVERITY: readonly MaterialArrivalStatus[] = ['unordered', 'ordered', 'partial', 'received'];

function toMaterialArrivalStatus(purchaseStatus: string | null): MaterialArrivalStatus | null {
  switch ((purchaseStatus ?? '').trim().toUpperCase()) {
    case 'C':
      return 'received';
    case 'S':
      return 'partial';
    case 'R':
      return 'ordered';
    case 'O':
    case 'P':
      return 'unordered';
    default:
      // X（工程削除）・未取込（null）・未知の値は判定に使わない
      return null;
  }
}

export function resolveMaterialArrivalStatus(
  purchaseStatuses: ReadonlyArray<string | null>
): MaterialArrivalStatus | null {
  let worst: MaterialArrivalStatus | null = null;
  for (const raw of purchaseStatuses) {
    const status = toMaterialArrivalStatus(raw);
    if (status == null) continue;
    if (worst == null || SEVERITY.indexOf(status) < SEVERITY.indexOf(worst)) {
      worst = status;
    }
  }
  return worst;
}

export type MaterialArrivalResult = { status: MaterialArrivalStatus; basis: MaterialArrivalBasis };

type PurchaseArrivalRow = { raw: string; matchKey: string; purchaseStatus: string | null };

export function resolveMaterialArrivalByPart(rows: ReadonlyArray<PurchaseArrivalRow>): MaterialArrivalResult | null {
  const materialStatuses = rows.filter((row) => isMaterialPurchasePartCode(row.raw)).map((row) => row.purchaseStatus);
  const materialStatus = resolveMaterialArrivalStatus(materialStatuses);
  if (materialStatus != null) return { status: materialStatus, basis: 'material' };
  if (!materialStatuses.some((status) => status?.trim().toUpperCase() === 'X')) return null;

  const partStatus = resolveMaterialArrivalStatus(
    rows.filter((row) => row.raw.trim() === row.matchKey.trim()).map((row) => row.purchaseStatus)
  );
  return partStatus != null ? { status: partStatus, basis: 'part' } : null;
}

export function materialArrivalLookupKey(fseiban: string, fhincd: string): string {
  return `${fseiban.trim()}\t${normalizePurchaseFhinCdForMatching(fhincd)}`;
}

const PAIR_CHUNK = 500;

/**
 * 生産日程の (FSEIBAN, FHINCD) ごとに材料の入荷状況を返す。
 * 戻り値のキーは {@link materialArrivalLookupKey}。材料行から判定できず X がある場合だけ部品購買で代用する。
 */
export async function findMaterialArrivalStatusByPart(
  parts: ReadonlyArray<{ fseiban: string; fhincd: string }>
): Promise<Map<string, MaterialArrivalResult>> {
  const pairs = new Map<string, { seiban: string; matchKey: string }>();
  for (const part of parts) {
    const seiban = part.fseiban.trim();
    const matchKey = normalizePurchaseFhinCdForMatching(part.fhincd);
    if (seiban.length === 0 || matchKey.length === 0) continue;
    pairs.set(`${seiban}\t${matchKey}`, { seiban, matchKey });
  }

  const rowsByKey = new Map<string, PurchaseArrivalRow[]>();
  const all = [...pairs.values()];
  for (let i = 0; i < all.length; i += PAIR_CHUNK) {
    const chunk = all.slice(i, i + PAIR_CHUNK);
    const rows = await prisma.$queryRaw<
      Array<{ seiban: string; matchKey: string; raw: string; purchaseStatus: string | null }>
    >`
      SELECT p."seiban", p."purchasePartCodeMatchKey" AS "matchKey",
             p."purchasePartCodeRaw" AS "raw", p."purchaseStatus"
      FROM "PurchaseOrderLookupRow" p
      WHERE p."sourceCsvDashboardId" = ${PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID}
        AND p."purchaseStatus" IS NOT NULL
        AND (p."seiban", p."purchasePartCodeMatchKey") IN (${Prisma.join(
          chunk.map(({ seiban, matchKey }) => Prisma.sql`(${seiban}, ${matchKey})`),
          ','
        )})
    `;
    for (const row of rows) {
      const key = `${row.seiban.trim()}\t${row.matchKey.trim()}`;
      const list = rowsByKey.get(key);
      if (list) list.push(row);
      else rowsByKey.set(key, [row]);
    }
  }

  const result = new Map<string, MaterialArrivalResult>();
  for (const [key, rows] of rowsByKey) {
    const status = resolveMaterialArrivalByPart(rows);
    if (status != null) result.set(key, status);
  }
  return result;
}
