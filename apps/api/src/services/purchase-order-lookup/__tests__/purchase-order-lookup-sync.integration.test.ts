import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { ensureProductionScheduleFkobainoDashboard } from '../../production-schedule/fkobaino-dashboard.definition.js';
import { PurchaseOrderLookupSyncService } from '../purchase-order-lookup-sync.service.js';

const SEIBAN = 'ZZPOSYNC1';
const ROW_COUNT = 1200;
const orderNo = (i: number) => String(9_800_000_000 + i);

let dir = '';
const runIds: string[] = [];

async function ingestRunFor(csv: string): Promise<string> {
  const csvFilePath = path.join(dir, `${runIds.length}.csv`);
  await writeFile(csvFilePath, csv, 'utf-8');
  const run = await prisma.csvDashboardIngestRun.create({
    data: { csvDashboardId: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID, status: 'COMPLETED', csvFilePath },
  });
  runIds.push(run.id);
  return run.id;
}

describe('PurchaseOrderLookupSyncService', () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'po-sync-'));
    await ensureProductionScheduleFkobainoDashboard(prisma);
    await prisma.purchaseOrderLookupRow.deleteMany({ where: { seiban: SEIBAN } });
  });

  afterAll(async () => {
    await prisma.purchaseOrderLookupRow.deleteMany({ where: { seiban: SEIBAN } });
    await prisma.csvDashboardIngestRun.deleteMany({ where: { id: { in: runIds } } });
    await rm(dir, { recursive: true, force: true });
  });

  it('upserts a CSV larger than one chunk and keeps the last row of a repeated key', async () => {
    const lines = ['FKOBAINO,FHINCD,FSEIBAN,FKOBAIHINMEI,FUPDTEDT,FKENSAOKSU,FSEZONO,FKOBAIST'];
    for (let i = 0; i < ROW_COUNT; i += 1) {
      lines.push(`${orderNo(i)},MD9${String(i).padStart(8, '0')}-001,${SEIBAN},材料${i},,0,,R`);
    }
    // 同じキー（注番・製番・照合キー）の行がチャンクをまたいで再登場する
    lines.push(`${orderNo(0)},MD900000000-001,${SEIBAN},材料0 更新,,3,,C`);

    const result = await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({
      ingestRunId: await ingestRunFor(lines.join('\n')),
    });

    expect(result.scanned).toBe(ROW_COUNT + 1);
    expect(await prisma.purchaseOrderLookupRow.count({ where: { seiban: SEIBAN } })).toBe(ROW_COUNT);
    const first = await prisma.purchaseOrderLookupRow.findFirstOrThrow({
      where: { seiban: SEIBAN, purchaseOrderNo: orderNo(0) },
    });
    expect(first).toMatchObject({ purchaseStatus: 'C', purchasePartName: '材料0 更新', acceptedQuantity: 3 });
    const last = await prisma.purchaseOrderLookupRow.findFirstOrThrow({
      where: { seiban: SEIBAN, purchaseOrderNo: orderNo(ROW_COUNT - 1) },
    });
    expect(last.purchaseStatus).toBe('R');
  });

  it('updates existing rows in place and keeps the status when the CSV has no FKOBAIST column', async () => {
    const before = await prisma.purchaseOrderLookupRow.findFirstOrThrow({
      where: { seiban: SEIBAN, purchaseOrderNo: orderNo(1) },
    });
    const csv = [
      'FKOBAINO,FHINCD,FSEIBAN,FKOBAIHINMEI,FUPDTEDT,FKENSAOKSU',
      `${orderNo(1)},MD900000001-001,${SEIBAN},材料1 改,,5`,
    ].join('\n');

    await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: await ingestRunFor(csv) });

    const after = await prisma.purchaseOrderLookupRow.findFirstOrThrow({
      where: { seiban: SEIBAN, purchaseOrderNo: orderNo(1) },
    });
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ purchaseStatus: 'R', purchasePartName: '材料1 改', acceptedQuantity: 5 });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect(await prisma.purchaseOrderLookupRow.count({ where: { seiban: SEIBAN } })).toBe(ROW_COUNT);
  });

  it('decides old and new by FUPDTEDT, not by import order', async () => {
    const header = 'FKOBAINO,FHINCD,FSEIBAN,FKOBAIHINMEI,FUPDTEDT,FKENSAOKSU,FSEZONO,FKOBAIST';
    const line = (i: number, name: string, updatedAt: string, qty: number, status: string) =>
      `${orderNo(i)},MD9${String(i).padStart(8, '0')}-001,${SEIBAN},${name},${updatedAt},${qty},,${status}`;
    const sync = async (...lines: string[]) =>
      new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({
        ingestRunId: await ingestRunFor([header, ...lines].join('\n')),
      });
    const row = (i: number) =>
      prisma.purchaseOrderLookupRow.findFirstOrThrow({ where: { seiban: SEIBAN, purchaseOrderNo: orderNo(i) } });

    // 更新日時の無い既存行は、更新日時のある行で上書きできる。CSV 内の重複は行順ではなく新しい方を採る。
    const first = await sync(
      line(2, '入荷済', '2026-09-20T10:00:00', 5, 'C'),
      line(2, '注文済', '2026-09-10T10:00:00', 0, 'R'),
      line(3, '入荷済', '2026-09-20T10:00:00', 5, 'C')
    );
    expect(first.skippedStale).toBe(0);
    expect(await row(2)).toMatchObject({
      purchaseStatus: 'C',
      purchasePartName: '入荷済',
      sourceUpdatedAt: new Date('2026-09-20T01:00:00.000Z'),
    });

    // 後から取り込んだ古いCSV・更新日時の無いCSVでは戻らない。
    const stale = await sync(line(2, '注文済', '2026-09-10T10:00:00', 0, 'R'), line(3, '日付なし', '', 0, 'R'));
    expect(stale.skippedStale).toBe(2);
    expect(await row(2)).toMatchObject({ purchaseStatus: 'C', purchasePartName: '入荷済', acceptedQuantity: 5 });
    expect(await row(3)).toMatchObject({ purchaseStatus: 'C', purchasePartName: '入荷済', acceptedQuantity: 5 });

    // 同時刻と、より新しい行は反映する。
    const fresh = await sync(
      line(2, '同時刻', '2026-09-20T10:00:00', 6, 'C'),
      line(3, '一部入荷', '2026-09-21T08:30:00', 2, 'S')
    );
    expect(fresh.skippedStale).toBe(0);
    expect(await row(2)).toMatchObject({ purchasePartName: '同時刻', acceptedQuantity: 6 });
    expect(await row(3)).toMatchObject({
      purchaseStatus: 'S',
      sourceUpdatedAt: new Date('2026-09-20T23:30:00.000Z'),
    });
  });
});
