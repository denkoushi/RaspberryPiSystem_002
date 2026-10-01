import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { findMaterialArrivalStatusByPart, materialArrivalLookupKey } from '../material-arrival-status.service.js';

const SEIBAN = 'ZZMATARR1';

const purchaseRow = (purchaseOrderNo: string, raw: string, purchaseStatus: string | null) => ({
  sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  purchaseOrderNo,
  purchasePartCodeRaw: raw,
  purchasePartCodeNormalized: raw.replace(/\([^)]*\)/g, ''),
  purchasePartCodeMatchKey: raw.replace(/\([^)]*\)/g, '').replace(/(-[0-9]+)+$/g, ''),
  seiban: SEIBAN,
  purchasePartName: 'test',
  purchaseStatus,
});

describe('findMaterialArrivalStatusByPart', () => {
  beforeAll(async () => {
    await prisma.purchaseOrderLookupRow.deleteMany({ where: { seiban: SEIBAN } });
    await prisma.purchaseOrderLookupRow.createMany({
      data: [
        // 材料が入荷済みでも、部品そのものの購買行（付加なし）は判定に使わない
        purchaseRow('9900000001', 'MD900000001-001', 'C'),
        purchaseRow('9900000002', 'MD900000001', 'P'),
        // 材料行が複数あれば最も遅れているもの。X（工程削除）は無視
        purchaseRow('9900000003', 'MD900000002-002', 'S'),
        purchaseRow('9900000004', 'MD900000002(A)', 'R'),
        purchaseRow('9900000005', 'MD900000002-001', 'X'),
        // 付加なしの行しか無い部品
        purchaseRow('9900000006', 'MD900000003', 'C'),
        // ステイタス未取込の材料行
        purchaseRow('9900000007', 'MD900000004-001', null),
      ],
    });
  });

  afterAll(async () => {
    await prisma.purchaseOrderLookupRow.deleteMany({ where: { seiban: SEIBAN } });
  });

  it('resolves the status per (seiban, part) from material rows only', async () => {
    const parts = ['MD900000001', 'MD900000002', 'MD900000003', 'MD900000004', 'MD900000005'].map((fhincd) => ({
      fseiban: SEIBAN,
      fhincd,
    }));
    const result = await findMaterialArrivalStatusByPart(parts);

    expect(result.get(materialArrivalLookupKey(SEIBAN, 'MD900000001'))).toBe('received');
    expect(result.get(materialArrivalLookupKey(SEIBAN, 'MD900000002'))).toBe('ordered');
    expect(result.has(materialArrivalLookupKey(SEIBAN, 'MD900000003'))).toBe(false);
    expect(result.has(materialArrivalLookupKey(SEIBAN, 'MD900000004'))).toBe(false);
    expect(result.has(materialArrivalLookupKey(SEIBAN, 'MD900000005'))).toBe(false);
  });

  it('does not match the same part under another seiban', async () => {
    const result = await findMaterialArrivalStatusByPart([{ fseiban: 'ZZMATARR2', fhincd: 'MD900000001' }]);
    expect(result.size).toBe(0);
  });

  it('returns an empty map without querying when no part is given', async () => {
    expect((await findMaterialArrivalStatusByPart([])).size).toBe(0);
  });
});
