import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
} from '../../services/production-schedule/constants.js';
import { fetchMaxProductNoWinnerRowIdsForDashboard } from '../../services/production-schedule/row-resolver/max-product-no-winner-materialization.js';
import { buildMaxProductNoWinnerCondition } from '../../services/production-schedule/row-resolver/max-product-no-sql.js';
import { computeLeaderboardShellFillerBudget } from '../../services/production-schedule/leaderboard/leaderboard-shell-filler-budget.js';
import { reconcileStaleProductionScheduleOrderAssignments } from '../../services/production-schedule/order-assignment/order-assignment-reconciliation.service.js';
import * as productionScheduleQueryService from '../../services/production-schedule/production-schedule-query.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';
/** Gmail FKOJUNST（旧ルート）想定の sourceCsvDashboardId — fkst 行のテスト種付け用 */
const FKOJUNST_GMAIL_LEGACY_SOURCE_DASHBOARD_ID = '9e4f2c1a-8b7d-4e6f-a5c4-1d2e3f4a5b6c';
const CLIENT_KEY = 'client-demo-key';
const CLIENT_KEY_2 = 'client-demo-key-2';

async function seedDefaultVisibleFkojunstMailStatusForAllDashboardRows(): Promise<void> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: DASHBOARD_ID },
    select: { id: true, rowData: true },
  });
  if (rows.length === 0) return;
  await prisma.productionScheduleFkojunstMailStatus.createMany({
    data: rows.map((rw) => {
      const rd = rw.rowData as Record<string, string | undefined>;
      return {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rw.id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: rd.FKOJUN ?? '',
        fkoteicd: (rd.FSIGENCD ?? '').trim().toUpperCase(),
        fsezono: rd.ProductNo ?? '',
        statusCode: 'S',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      };
    }),
    skipDuplicates: true,
  });
}

describe('Kiosk Production Schedule API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    await prisma.productionScheduleFkojunstStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleAccessPasswordConfig.deleteMany();
    await prisma.dueManagementOutcomeEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.dueManagementOperatorDecisionEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.dueManagementProposalEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleGlobalRowRank.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleGlobalRank.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleDailyPlanItem.deleteMany({ where: { plan: { csvDashboardId: DASHBOARD_ID } } });
    await prisma.productionScheduleDailyPlan.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleTriageSelection.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionSchedulePartProcessingType.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionSchedulePartPriority.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.$executeRaw`
      DELETE FROM "ProductionScheduleSeibanProcessingDueDate"
      WHERE "csvDashboardId" = ${DASHBOARD_ID}
    `;
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCategoryConfig.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCodeMapping.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }
    });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    await prisma.productionScheduleResourceMaster.deleteMany({
      where: { resourceCd: { in: ['1', '2', 'MSZ'] } }
    });
    if (closeServer) await closeServer();
  });

  beforeEach(async () => {
    await prisma.productionScheduleFkojunstStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleAccessPasswordConfig.deleteMany();
    await prisma.dueManagementOutcomeEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.dueManagementOperatorDecisionEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.dueManagementProposalEvent.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleGlobalRowRank.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleGlobalRank.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleDailyPlanItem.deleteMany({ where: { plan: { csvDashboardId: DASHBOARD_ID } } });
    await prisma.productionScheduleDailyPlan.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleTriageSelection.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionSchedulePartProcessingType.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionSchedulePartPriority.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.$executeRaw`
      DELETE FROM "ProductionScheduleSeibanProcessingDueDate"
      WHERE "csvDashboardId" = ${DASHBOARD_ID}
    `;
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCategoryConfig.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCodeMapping.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }
    });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    await prisma.productionScheduleResourceMaster.deleteMany({
      where: { resourceCd: { in: ['1', '2', 'MSZ'] } }
    });

    // client-demo-key は seed.ts で作られるが、テスト単体でも通るように保険で作成
    await prisma.clientDevice.upsert({
      where: { apiKey: CLIENT_KEY },
      update: { name: 'Test Client', location: 'Test', defaultMode: 'TAG' },
      create: { apiKey: CLIENT_KEY, name: 'Test Client', location: 'Test', defaultMode: 'TAG' }
    });
    await prisma.clientDevice.upsert({
      where: { apiKey: CLIENT_KEY_2 },
      update: { name: 'Test Client 2', location: 'Other', defaultMode: 'TAG' },
      create: { apiKey: CLIENT_KEY_2, name: 'Test Client 2', location: 'Other', defaultMode: 'TAG' }
    });

    await prisma.csvDashboard.create({
      data: {
        id: DASHBOARD_ID,
        name: 'ProductionSchedule_Mishima_Grinding',
        columnDefinitions: [
          { internalName: 'ProductNo', displayName: 'ProductNo', csvHeaderCandidates: ['ProductNo'], dataType: 'string', order: 0 }
        ],
        templateType: 'CARD_GRID',
        templateConfig: { cardsPerPage: 9, fontSize: 14, displayFields: ['ProductNo'] },
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        gmailSubjectPattern: '生産日程_三島_研削工程',
        enabled: true
      }
    });

    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-0',
          rowData: { ProductNo: '0000', FSEIBAN: 'A', FHINCD: 'Z', FSIGENCD: '1', FKOJUN: '5', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-1',
          rowData: { ProductNo: '0001', FSEIBAN: 'A', FHINCD: 'X', FSIGENCD: '1', FKOJUN: '210', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-2',
          rowData: { ProductNo: '0002', FSEIBAN: 'B', FHINCD: 'Y', FSIGENCD: '2', FKOJUN: '220', progress: '完了' }
        }
      ]
    });
    await prisma.productionScheduleResourceMaster.createMany({
      data: [
        {
          resourceCd: '1',
          resourceName: '1号機',
          resourceClassCd: 'M02',
          resourceGroupCd: 'G1'
        },
        {
          resourceCd: '1',
          resourceName: '1号機-予備',
          resourceClassCd: 'M02',
          resourceGroupCd: 'G1'
        },
        {
          resourceCd: '2',
          resourceName: '2号機',
          resourceClassCd: 'M02',
          resourceGroupCd: 'G1'
        },
        {
          resourceCd: 'MSZ',
          resourceName: '切削除外設備',
          resourceClassCd: 'M02',
          resourceGroupCd: 'G2'
        }
      ],
      skipDuplicates: true
    });

    // progressは別テーブルが真実なので、完了状態もseedする。
    const completedRow = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0002' }
      },
      select: { id: true }
    });
    if (completedRow) {
      await prisma.productionScheduleProgress.upsert({
        where: { csvDashboardRowId: completedRow.id },
        create: {
          csvDashboardRowId: completedRow.id,
          csvDashboardId: DASHBOARD_ID,
          isCompleted: true
        },
        update: { isCompleted: true }
      });
    }

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }
    });
  });

  it('rejects request without x-client-key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kiosk/production-schedule' });
    expect(res.statusCode).toBe(401);
  });

  it('lists all rows including completed ones (for graying out)', async () => {
    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { id: 'asc' },
      select: { id: true, rowData: true }
    });
    const row0000 = rows.find((row) => (row.rowData as any).ProductNo === '0000');
    const row0001 = rows.find((row) => (row.rowData as any).ProductNo === '0001');
    if (row0000 && row0001) {
      await prisma.productionScheduleGlobalRowRank.createMany({
        data: [
          {
            csvDashboardId: DASHBOARD_ID,
            location: 'Test',
            csvDashboardRowId: row0000.id,
            fseiban: 'A',
            globalRank: 1,
            sourceType: 'manual'
          },
          {
            csvDashboardId: DASHBOARD_ID,
            location: 'Test',
            csvDashboardRowId: row0001.id,
            fseiban: 'A',
            globalRank: 2,
            sourceType: 'manual'
          }
        ]
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{ rowData: { ProductNo?: string; progress?: string }; globalRank?: number | null }>
    };
    // 完了状態のものも含めて全て返す（グレーアウト表示のため）
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001', '0002']);
    expect(body.rows.find((r) => r.rowData.ProductNo === '0000')?.globalRank).toBe(1);
    expect(body.rows.find((r) => r.rowData.ProductNo === '0001')?.globalRank).toBe(2);
    expect(body.rows.find((r) => r.rowData.ProductNo === '0002')?.globalRank ?? null).toBeNull();
    // 完了状態のものはprogressが'完了'
    const completedRow = body.rows.find((r) => r.rowData.ProductNo === '0002');
    expect(completedRow?.rowData.progress).toBe('完了');
  });

  it('treats external completion as completed in the list response', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleExternalCompletion.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardRowId: targetRow.id,
        csvDashboardId: DASHBOARD_ID,
        isExternallyCompleted: true,
      },
      update: {
        isExternallyCompleted: true,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{ rowData: { ProductNo?: string; progress?: string } }>;
    };
    expect(body.rows.find((r) => r.rowData.ProductNo === '0001')?.rowData.progress).toBe('完了');
  });

  it('shows S/R from FKOJUNST_Status mail sync rows', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleFkojunstMailStatus.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: '210',
        fkoteicd: '1',
        fsezono: '0001',
        statusCode: 'S',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
      update: {
        statusCode: 'S',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{ rowData: { ProductNo?: string; FKOJUNST?: string } }>;
    };
    expect(body.rows.find((row) => row.rowData.ProductNo === '0001')?.rowData.FKOJUNST).toBe('S');
  });

  for (const completedStatus of ['C', 'X'] as const) {
    it(`shows ${completedStatus} from FKOJUNST_Status mail sync rows`, async () => {
      const targetRow = await prisma.csvDashboardRow.findFirst({
        where: {
          csvDashboardId: DASHBOARD_ID,
          rowData: { path: ['ProductNo'], equals: '0001' },
        },
        select: { id: true },
      });
      expect(targetRow).toBeDefined();
      if (!targetRow) return;

      await prisma.productionScheduleFkojunstMailStatus.upsert({
        where: { csvDashboardRowId: targetRow.id },
        create: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: targetRow.id,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          fkojun: '210',
          fkoteicd: '1',
          fsezono: '0001',
          statusCode: completedStatus,
          sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
        },
        update: {
          statusCode: completedStatus,
          sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule',
        headers: { 'x-client-key': CLIENT_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        rows: Array<{ rowData: { ProductNo?: string; FKOJUNST?: string } }>;
      };
      expect(body.rows.find((row) => row.rowData.ProductNo === '0001')?.rowData.FKOJUNST).toBe(completedStatus);
    });
  }

  it('hides rows when matched FKOJUNST_Status mail sync result is non S/R', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleFkojunstMailStatus.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: '210',
        fkoteicd: '1',
        fsezono: '0001',
        statusCode: '?',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
      update: {
        statusCode: '?',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{ rowData: { ProductNo?: string } }>;
    };
    expect(body.rows.map((row) => row.rowData.ProductNo)).toEqual(['0000', '0002']);
  });

  it('hides rows when only legacy fkst is non-S/R and there is no FKOJUNST_Status mail row', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: { csvDashboardId: DASHBOARD_ID, rowData: { path: ['ProductNo'], equals: '0001' } },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: { csvDashboardRowId: targetRow.id },
    });

    await prisma.productionScheduleFkojunstStatus.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: FKOJUNST_GMAIL_LEGACY_SOURCE_DASHBOARD_ID,
        productNo: '0001',
        resourceCd: '1',
        processOrder: '210',
        statusCode: 'X',
      },
      update: { statusCode: 'X' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0002']);
  });

  it('hides rows when only legacy fkst is S/R and there is no FKOJUNST_Status mail row', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: { csvDashboardId: DASHBOARD_ID, rowData: { path: ['ProductNo'], equals: '0001' } },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: { csvDashboardRowId: targetRow.id },
    });

    await prisma.productionScheduleFkojunstStatus.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: FKOJUNST_GMAIL_LEGACY_SOURCE_DASHBOARD_ID,
        productNo: '0001',
        resourceCd: '1',
        processOrder: '210',
        statusCode: 'R',
      },
      update: { statusCode: 'R' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0002']);
  });

  it('hides O/P mail rows from kiosk list but keeps them in seiban progress total', async () => {
    const targetRow = await prisma.csvDashboardRow.findFirst({
      where: { csvDashboardId: DASHBOARD_ID, rowData: { path: ['ProductNo'], equals: '0001' } },
      select: { id: true },
    });
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleFkojunstMailStatus.upsert({
      where: { csvDashboardRowId: targetRow.id },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: '210',
        fkoteicd: '1',
        fsezono: '0001',
        statusCode: 'O',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
      update: {
        statusCode: 'O',
        sourceUpdatedAt: new Date('2026-04-28T01:05:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000']);

    const stateGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    const etag = stateGet.headers.etag;
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': String(etag) },
      payload: { state: { history: ['A'] } },
    });

    const progressRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/history-progress',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(progressRes.statusCode).toBe(200);
    const progressBody = progressRes.json() as {
      progressBySeiban: Record<string, { total: number; completed: number }>;
    };
    expect(progressBody.progressBySeiban.A).toMatchObject({ total: 2, completed: 0 });
  });

  it('returns planned supplement fields when linked row exists', async () => {
    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { id: 'asc' },
      select: { id: true, rowData: true },
    });
    const targetRow = rows.find((row) => (row.rowData as any).ProductNo === '0000');
    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    await prisma.productionScheduleOrderSupplement.upsert({
      where: { csvDashboardRowId: targetRow.id },
      update: {
        plannedQuantity: 12,
        plannedStartDate: new Date('2026-04-21T00:00:00.000Z'),
        plannedEndDate: new Date('2026-04-23T00:00:00.000Z'),
      },
      create: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: targetRow.id,
        sourceCsvDashboardId: '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31',
        productNo: '0000',
        resourceCd: '1',
        processOrder: '10',
        plannedQuantity: 12,
        plannedStartDate: new Date('2026-04-21T00:00:00.000Z'),
        plannedEndDate: new Date('2026-04-23T00:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{
        id: string;
        plannedQuantity?: number | null;
        plannedStartDate?: string | null;
        plannedEndDate?: string | null;
      }>;
    };
    const target = body.rows.find((row) => row.id === targetRow.id);
    expect(target?.plannedQuantity).toBe(12);
    expect(target?.plannedStartDate).toContain('2026-04-21');
    expect(target?.plannedEndDate).toContain('2026-04-23');
  });

  it('keeps only the larger ProductNo for the same seiban+process key', async () => {
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-older-duplicate',
          rowData: { ProductNo: '0003', FSEIBAN: 'BA1S2320', FHINCD: 'K001', FSIGENCD: 'R1', FKOJUN: '10', progress: '' },
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-newer-duplicate',
          rowData: { ProductNo: '0009', FSEIBAN: 'BA1S2320', FHINCD: 'K001', FSIGENCD: 'R1', FKOJUN: '10', progress: '' },
        },
      ],
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=BA1S2320',
      headers: { 'x-client-key': CLIENT_KEY },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.rowData.ProductNo).toBe('0009');
  });

  it('completes a row and keeps it in list (grayed out)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const first = (list.json() as any).rows.find((r: any) => r.rowData.ProductNo === '0001');
    expect(first).toBeDefined();
    expect(first.rowData.progress).toBe('');

    const complete = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${first.id}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(complete.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    // 完了状態のものも含めて全て返す（グレーアウト表示のため）
    expect((after.json() as any).rows).toHaveLength(3);
    const completedRow = (after.json() as any).rows.find((r: any) => r.id === first.id);
    expect(completedRow.rowData.progress).toBe('完了');
  });

  it('PUT /completion with intent=complete twice keeps row completed (no accidental toggle)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const first = (list.json() as any).rows.find((r: any) => r.rowData.ProductNo === '0001');
    expect(first).toBeDefined();

    const once = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${first.id}/completion`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { intent: 'complete' }
    });
    expect(once.statusCode).toBe(200);
    expect((once.json() as any).unchanged).toBe(false);

    const twice = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${first.id}/completion`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { intent: 'complete' }
    });
    expect(twice.statusCode).toBe(200);
    expect((twice.json() as any).unchanged).toBe(true);
    expect((twice.json() as any).rowData.progress).toBe('完了');

    const after = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const completedRow = (after.json() as any).rows.find((r: any) => r.id === first.id);
    expect(completedRow.rowData.progress).toBe('完了');
  });

  it('legacy PUT /complete twice toggles completion back (compat behavior)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const target = (list.json() as any).rows.find((r: any) => r.rowData.ProductNo === '0000');
    expect(target).toBeDefined();
    expect(target.rowData.progress).not.toBe('完了');

    const firstToggle = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${target.id}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(firstToggle.statusCode).toBe(200);
    expect((firstToggle.json() as any).rowData.progress).toBe('完了');

    const secondToggle = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${target.id}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(secondToggle.statusCode).toBe(200);
    expect((secondToggle.json() as any).rowData.progress).not.toBe('完了');
  });

  it('filters by ProductNo partial match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?productNo=0000',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000']);
  });

  it('filters by q for ProductNo or FSEIBAN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; FSEIBAN?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001']);
    expect(body.rows.map((r) => r.rowData.FSEIBAN)).toEqual(['A', 'A']);
  });

  it('responseProfile=leaderboard omits actual-hours but resolves resolvedMachineName', async () => {
    const resLb = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A&responseProfile=leaderboard',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(resLb.statusCode).toBe(200);
    const lbBody = resLb.json() as {
      rows: Array<{
        resolvedMachineName?: string | null;
        actualPerPieceMinutes?: number | null;
        rowData: { ProductNo?: string; FSEIBAN?: string; FHINCD?: string; FSIGENCD?: string };
      }>;
      total: number;
      leaderboardFooterChipsByPartKey?: Record<
        string,
        Array<{ rowId: string; resourceCd: string; isCompleted: boolean; resourceNames?: string[] }>
      >;
    };
    expect(lbBody.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001']);
    expect(lbBody.total).toBe(2);
    for (const r of lbBody.rows) {
      expect(r.resolvedMachineName ?? null).toBe(SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL);
      expect(r.actualPerPieceMinutes ?? null).toBeNull();
    }
    const chips = lbBody.leaderboardFooterChipsByPartKey;
    expect(chips).toBeDefined();
    const rPn0 = lbBody.rows.find((r) => r.rowData.ProductNo === '0000');
    const rPn1 = lbBody.rows.find((r) => r.rowData.ProductNo === '0001');
    expect(rPn0?.rowData.FSEIBAN).toBe('A');
    expect(rPn1?.rowData.FSEIBAN).toBe('A');
    const k0 = [rPn0!.rowData.FSEIBAN!, rPn0!.rowData.ProductNo!, rPn0!.rowData.FHINCD!].join('\0');
    const k1 = [rPn1!.rowData.FSEIBAN!, rPn1!.rowData.ProductNo!, rPn1!.rowData.FHINCD!].join('\0');
    expect(chips![k0]?.map((c) => c.resourceCd)).toEqual([rPn0!.rowData.FSIGENCD!]);
    expect(chips![k1]?.map((c) => c.resourceCd)).toEqual([rPn1!.rowData.FSIGENCD!]);
  });

  it('leaderboardFooterChips prefers CsvDashboardRow ids present on the current leaderboard payload when duplicates share FSEIBAN/FHINCD/ProductNo/FSIGENCD/FKOJUN', async () => {
    const { buildLeaderboardFooterChipsByPartKeyForScheduleRows } = await import(
      '../../services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.js'
    );

    const older = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        dataHash: 'footer-dup-old',
        rowData: {
          ProductNo: 'FDUP1',
          FSEIBAN: 'FDUP-S',
          FHINCD: 'FDUP-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });
    const newer = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        dataHash: 'footer-dup-new',
        rowData: {
          ProductNo: 'FDUP1',
          FSEIBAN: 'FDUP-S',
          FHINCD: 'FDUP-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });

    await prisma.productionScheduleProgress.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: older.id,
        isCompleted: true
      }
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const partKey = ['FDUP-S', 'FDUP1', 'FDUP-H'].join('\0');
    const chips = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [
        {
          id: older.id,
          seibanJoinKey: 'FDUP-S',
          rowData: {
            ProductNo: 'FDUP1',
            FSEIBAN: 'FDUP-S',
            FHINCD: 'FDUP-H',
            FSIGENCD: '021',
            FKOJUN: '10'
          }
        }
      ],
      locationKey: 'Test',
      siteKey: 'Test'
    });

    expect(chips).toBeDefined();
    const chip021 = chips![partKey]?.find((c) => c.resourceCd === '021');
    expect(chip021?.rowId).toBe(older.id);
    expect(chip021?.isCompleted).toBe(true);
    expect(chip021?.rowId).not.toBe(newer.id);
  });

  it('leaderboardFooterChips: if no shell row id matches duplicate CsvDashboardRows, DISTINCT ON falls back and may pick newer incomplete row', async () => {
    const { buildLeaderboardFooterChipsByPartKeyForScheduleRows } = await import(
      '../../services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.js'
    );

    const older = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        dataHash: `footer-dup-miss-old-${randomUUID()}`,
        rowData: {
          ProductNo: 'FDUPX',
          FSEIBAN: 'FDUPX-S',
          FHINCD: 'FDUPX-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });
    const newer = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        dataHash: `footer-dup-miss-new-${randomUUID()}`,
        rowData: {
          ProductNo: 'FDUPX',
          FSEIBAN: 'FDUPX-S',
          FHINCD: 'FDUPX-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });

    await prisma.productionScheduleProgress.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: older.id,
        isCompleted: true
      }
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const partKey = ['FDUPX-S', 'FDUPX', 'FDUPX-H'].join('\0');
    const chips = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [
        {
          id: randomUUID(),
          seibanJoinKey: 'FDUPX-S',
          rowData: {
            ProductNo: 'FDUPX',
            FSEIBAN: 'FDUPX-S',
            FHINCD: 'FDUPX-H',
            FSIGENCD: '021',
            FKOJUN: '10'
          }
        }
      ],
      locationKey: 'Test',
      siteKey: 'Test'
    });

    expect(chips).toBeDefined();
    const chip021 = chips![partKey]?.find((c) => c.resourceCd === '021');
    expect(chip021?.rowId).toBe(newer.id);
    expect(chip021?.isCompleted).toBe(false);
  });

  it('leaderboardFooterChips keeps preferred duplicate winner selection beyond 900 preferred row ids', async () => {
    const { buildLeaderboardFooterChipsByPartKeyForScheduleRows } = await import(
      '../../services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.js'
    );

    const older = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        dataHash: `hy9-dup-old-${randomUUID()}`,
        rowData: {
          ProductNo: 'HY9DUP',
          FSEIBAN: 'HY9DUP-S',
          FHINCD: 'HY9DUP-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });
    const newer = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        dataHash: `hy9-dup-new-${randomUUID()}`,
        rowData: {
          ProductNo: 'HY9DUP',
          FSEIBAN: 'HY9DUP-S',
          FHINCD: 'HY9DUP-H',
          FSIGENCD: '021',
          FKOJUN: '10',
          progress: ''
        }
      }
    });

    await prisma.productionScheduleProgress.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: older.id,
        isCompleted: true
      }
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();
    const preferredDisplayRowIds = Array.from({ length: 900 }, () => randomUUID());
    preferredDisplayRowIds.push(older.id);

    const partKey = ['HY9DUP-S', 'HY9DUP', 'HY9DUP-H'].join('\0');
    const chips = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [
        {
          id: older.id,
          seibanJoinKey: 'HY9DUP-S',
          rowData: {
            ProductNo: 'HY9DUP',
            FSEIBAN: 'HY9DUP-S',
            FHINCD: 'HY9DUP-H',
            FSIGENCD: '021',
            FKOJUN: '10'
          }
        }
      ],
      locationKey: 'Test',
      siteKey: 'Test',
      preferredDisplayRowIds
    });

    const chip021 = chips?.[partKey]?.find((c) => c.resourceCd === '021');
    expect(chip021?.rowId).toBe(older.id);
    expect(chip021?.isCompleted).toBe(true);
    expect(chip021?.rowId).not.toBe(newer.id);
  });

  it('leaderboard phased read: shell + total + decorations match monolithic leaderboard ordering', async () => {
    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as {
      page: number;
      pageSize: number;
      rows: Array<{
        id: string;
        rowData: { ProductNo?: string };
        resolvedMachineName?: unknown;
        customerName?: unknown;
        actualPerPieceMinutes?: unknown;
      }>;
      nextCursor?: number;
      hasMore?: boolean;
    };
    expect(shellBody.pageSize).toBeLessThanOrEqual(160);
    expect(shellBody.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001']);
    expect(shellBody.nextCursor).toBe(2);
    expect(shellBody.hasMore).toBe(false);
    for (const r of shellBody.rows) {
      expect('resolvedMachineName' in r ? r.resolvedMachineName : undefined).toBeUndefined();
      expect(r.customerName ?? null).toBeNull();
      expect(r.actualPerPieceMinutes ?? null).toBeNull();
    }

    const mono = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A&responseProfile=leaderboard',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(mono.statusCode).toBe(200);
    const monoBody = mono.json() as { rows: Array<{ id: string }> };
    expect(shellBody.rows.map((r) => r.id)).toEqual(monoBody.rows.map((r) => r.id));

    const totalRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-total?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(totalRes.statusCode).toBe(200);
    expect((totalRes.json() as { total: number }).total).toBe(2);

    const deco = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-decorations',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: { rowIds: shellBody.rows.map((r) => r.id) }
    });
    expect(deco.statusCode).toBe(200);
    const decoBody = deco.json() as {
      rowDecorations: Array<{ id: string; resolvedMachineName: string | null }>;
      leaderboardFooterChipsByPartKey: Record<string, Array<{ resourceCd: string }>>;
    };
    for (const d of decoBody.rowDecorations) {
      expect(d.resolvedMachineName ?? null).toBe(SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL);
    }
    expect(Object.keys(decoBody.leaderboardFooterChipsByPartKey ?? {}).length).toBeGreaterThan(0);
  });

  it('leaderboard-board aggregates ordered shells and totals for boardResourceCds', async () => {
    const s1 = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?q=A&resourceCds=1&pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const s2 = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?q=A&resourceCds=2&pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const board = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?q=A&boardResourceCds=1,2&pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(s1.statusCode).toBe(200);
    expect(s2.statusCode).toBe(200);
    expect(board.statusCode).toBe(200);
    const b = board.json() as {
      rows: Array<{ id: string }>;
      total: number;
      resources: Array<{ resourceCd: string; total: number }>;
    };
    const o1 = s1.json() as { rows: Array<{ id: string }> };
    const o2 = s2.json() as { rows: Array<{ id: string }> };
    expect(b.rows.map((r) => r.id)).toEqual([...o1.rows.map((r) => r.id), ...o2.rows.map((r) => r.id)]);

    const tt1 = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-total?q=A&resourceCds=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const tt2 = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-total?q=A&resourceCds=2',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const sum = (tt1.json() as { total: number }).total + (tt2.json() as { total: number }).total;
    expect(b.total).toBe(sum);
    expect(b.resources).toHaveLength(2);
  });

  it('leaderboard-board returns laborRequiredMinutes when FSIGENCD=10 rows lack fkmail', async () => {
    const productNo = 'LAB-010';
    const fkojun = '200';

    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'lab-machine',
          rowData: {
            ProductNo: productNo,
            FSEIBAN: 'L',
            FHINCD: 'H',
            FSIGENCD: '1',
            FKOJUN: fkojun,
            FSIGENSHOYORYO: '400',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'lab-labor',
          rowData: {
            ProductNo: productNo,
            FSEIBAN: 'L',
            FHINCD: 'H',
            FSIGENCD: '10',
            FKOJUN: fkojun,
            FSIGENSHOYORYO: '175',
            progress: ''
          }
        }
      ]
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const laborRows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: productNo },
        AND: [{ rowData: { path: ['FSIGENCD'], equals: '10' } }]
      },
      select: { id: true }
    });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: { csvDashboardRowId: { in: laborRows.map((row) => row.id) } }
    });

    const board = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true',
      headers: { 'x-client-key': CLIENT_KEY }
    });

    expect(board.statusCode).toBe(200);
    const body = board.json() as {
      rows: Array<{
        rowData: Record<string, unknown>;
        machineRequiredMinutes?: number;
        laborRequiredMinutes?: number;
      }>;
    };
    const target = body.rows.find((row) => (row.rowData as { ProductNo?: string }).ProductNo === productNo);
    expect(target).toBeDefined();
    expect(target?.machineRequiredMinutes).toBe(400);
    expect(target?.laborRequiredMinutes).toBe(175);
  });

  it('leaderboard-board continue profile logs: multi-resource append reaches hasMore=false', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 140 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 1, 1, 0, 0, index)),
        dataHash: `board-r1-${index}`,
        rowData: {
          ProductNo: `R1${String(index).padStart(4, '0')}`,
          FSEIBAN: `R1-S${String(index).padStart(7, '0')}`,
          FHINCD: `R1-P${String(index).padStart(4, '0')}`,
          FHINMEI: `R1 Part ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 140 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 1, 2, 0, 0, index)),
        dataHash: `board-r2-${index}`,
        rowData: {
          ProductNo: `R2${String(index).padStart(4, '0')}`,
          FSEIBAN: `R2-S${String(index).padStart(7, '0')}`,
          FHINCD: `R2-P${String(index).padStart(4, '0')}`,
          FHINMEI: `R2 Part ${index}`,
          FSIGENCD: '2',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1,2&pageSize=80&allowResourceOnly=true&includeDecorations=false',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    let board = shell.json() as {
      rows: Array<{ id: string }>;
      total: number;
      resources: Array<{
        resourceCd: string;
        snapshotId?: string;
        nextCursor?: number;
        hasMore: boolean;
      }>;
      pageSize: number;
      deltaRows?: Array<{ id: string }>;
      leaderboardFooterChipsByPartKey?: Record<string, unknown>;
    };
    expect(board.deltaRows).toBeUndefined();
    expect(board.leaderboardFooterChipsByPartKey).toBeUndefined();
    expect(board.rows).toHaveLength(160);
    expect(board.resources.some((r) => r.hasMore)).toBe(true);

    let prevRowLen = board.rows.length;
    let guard = 0;
    while (board.resources.some((r) => r.hasMore) && guard < 20) {
      guard += 1;
      const cont = await app.inject({
        method: 'POST',
        url: '/api/kiosk/production-schedule/leaderboard-board/continue',
        headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
        payload: {
          boardResourceCds: '1,2',
          allowResourceOnly: true,
          includeDecorations: false,
          resourceSlices: board.resources.map((r) => ({
            resourceCd: r.resourceCd,
            snapshotId: r.snapshotId,
            cursor: r.nextCursor,
            hasMore: r.hasMore
          })),
          pageSize: 40
        }
      });
      expect(cont.statusCode).toBe(200);
      board = cont.json() as typeof board;
      expect(board.snapshotExpired).not.toBe(true);
      expect(Array.isArray(board.deltaRows)).toBe(true);
      expect(board.rows.length).toBeGreaterThanOrEqual(prevRowLen);
      prevRowLen = board.rows.length;
    }

    expect(board.resources.some((r) => r.hasMore)).toBe(false);
    expect(board.rows.length).toBe(board.total);

    const monolithic = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1,2&pageSize=160&allowResourceOnly=true',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(monolithic.statusCode).toBe(200);
    const monoBody = monolithic.json() as { rows: Array<{ id: string }>; total: number };
    expect(monoBody.rows.map((r) => r.id)).toEqual(board.rows.map((r) => r.id));
    expect(monoBody.total).toBe(board.total);
  });

  it('leaderboard-board continue skips COUNT when shell snapshot totals are seeded', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 1, 1, 0, 0, index)),
        dataHash: `board-count-skip-${index}`,
        rowData: {
          ProductNo: `CS${String(index).padStart(4, '0')}`,
          FSEIBAN: `CS-S${String(index).padStart(7, '0')}`,
          FHINCD: `CS-P${String(index).padStart(4, '0')}`,
          FHINMEI: `CS Part ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const countSpy = vi.spyOn(
      productionScheduleQueryService,
      'countProductionScheduleDashboardVisibleRowsFromListFilters'
    );

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=80&allowResourceOnly=true&includeDecorations=false',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as {
      rows: Array<{ id: string }>;
      resources: Array<{
        resourceCd: string;
        snapshotId?: string;
        nextCursor?: number;
        hasMore: boolean;
      }>;
    };
    const countCallsAfterShell = countSpy.mock.calls.length;
    expect(countCallsAfterShell).toBeGreaterThanOrEqual(1);

    if (!shellBody.resources.some((r) => r.hasMore)) {
      countSpy.mockRestore();
      return;
    }

    const cont = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-board/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: {
        boardResourceCds: '1',
        allowResourceOnly: true,
        includeDecorations: false,
        pageSize: 40,
        resourceSlices: shellBody.resources.map((r) => ({
          resourceCd: r.resourceCd,
          snapshotId: r.snapshotId,
          cursor: r.nextCursor,
          hasMore: r.hasMore
        }))
      }
    });
    expect(cont.statusCode).toBe(200);
    expect(countSpy.mock.calls.length).toBe(countCallsAfterShell);
    countSpy.mockRestore();
  });

  it('leaderboard-board shell keeps responding when completed slot COUNT rejects after shell settles total', async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 2 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 1, 1, 0, 0, index)),
        dataHash: `board-shell-complete-${index}`,
        rowData: {
          ProductNo: `SC${String(index).padStart(4, '0')}`,
          FSEIBAN: `SC-S${String(index).padStart(7, '0')}`,
          FHINCD: `SC-P${String(index).padStart(4, '0')}`,
          FHINMEI: `SC Part ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const countSpy = vi
      .spyOn(productionScheduleQueryService, 'countProductionScheduleDashboardVisibleRowsFromListFilters')
      .mockRejectedValueOnce(new Error('count should not block completed shell slot'));

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=80&allowResourceOnly=true&includeDecorations=false',
      headers: { 'x-client-key': CLIENT_KEY }
    });

    expect(shell.statusCode).toBe(200);
    const body = shell.json() as {
      total: number;
      rows: Array<{ id: string }>;
      resources: Array<{ total: number; hasMore: boolean }>;
    };
    expect(body.rows).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.resources).toHaveLength(1);
    expect(body.resources[0]).toMatchObject({ total: 2, hasMore: false });
    countSpy.mockRestore();
  });

  it('leaderboard-board slot scale profile: 2 vs 6 resources', async () => {
    const rowsPerSlot = 100;
    const shellPageSize = 80;
    const continuePageSize = 40;

    for (const slotCount of [2, 6] as const) {
      const resourceCds = Array.from({ length: slotCount }, (_, i) => String(i + 1));
      await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
      await prisma.productionScheduleFkojunstMailStatus.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
      await prisma.productionScheduleResourceMaster.createMany({
        data: resourceCds.map((resourceCd) => ({
          resourceCd,
          resourceName: `Resource ${resourceCd}`,
          resourceClassCd: 'M02',
          resourceGroupCd: 'G1'
        })),
        skipDuplicates: true
      });

      const seedRows = resourceCds.flatMap((resourceCd, slotIdx) =>
        Array.from({ length: rowsPerSlot }, (_, index) => ({
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(Date.UTC(2026, 2, slotIdx + 1, 0, 0, index)),
          dataHash: `scale-${resourceCd}-${index}`,
          rowData: {
            ProductNo: `P${resourceCd}${String(index).padStart(4, '0')}`,
            FSEIBAN: `S${resourceCd}-${String(index).padStart(5, '0')}`,
            FHINCD: `H${resourceCd}-${String(index).padStart(4, '0')}`,
            FHINMEI: `Part ${resourceCd}-${index}`,
            FSIGENCD: resourceCd,
            FKOJUN: '10',
            progress: ''
          }
        }))
      );
      await prisma.csvDashboardRow.createMany({ data: seedRows });
      await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

      const boardCds = resourceCds.join(',');
      let continueRounds = 0;

      const shellRes = await app.inject({
        method: 'GET',
        url: `/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=${boardCds}&pageSize=${shellPageSize}&allowResourceOnly=true&includeDecorations=false`,
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(shellRes.statusCode).toBe(200);
      let board = shellRes.json() as {
        rows: Array<{ id: string }>;
        total: number;
        resources: Array<{
          resourceCd: string;
          snapshotId?: string;
          nextCursor?: number;
          hasMore: boolean;
        }>;
      };

      while (board.resources.some((r) => r.hasMore) && continueRounds < 25) {
        continueRounds += 1;
        const contRes = await app.inject({
          method: 'POST',
          url: '/api/kiosk/production-schedule/leaderboard-board/continue',
          headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
          payload: {
            boardResourceCds: boardCds,
            allowResourceOnly: true,
            includeDecorations: false,
            pageSize: continuePageSize,
            resourceSlices: board.resources.map((r) => ({
              resourceCd: r.resourceCd,
              snapshotId: r.snapshotId,
              cursor: r.nextCursor,
              hasMore: r.hasMore
            }))
          }
        });
        expect(contRes.statusCode).toBe(200);
        board = contRes.json() as typeof board;
      }

      expect(board.resources.some((r) => r.hasMore)).toBe(false);
      expect(board.rows.length).toBe(slotCount * rowsPerSlot);
    }
  });

  it('leaderboard shell filler budget caps incremental filler batches for takeCount 20', () => {
    const b = computeLeaderboardShellFillerBudget({ takeCount: 20, excludeRowIdCount: 0 });
    expect(b.batchTakeSoftCap).toBeLessThan(320);
    expect(b.maxFillerTotal).toBeLessThan(20 * 48 + 800);
  });

  it('leaderboard phased read caps shell at 160 even when total is larger', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 170 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        dataHash: `bulk-hash-${index}`,
        rowData: {
          ProductNo: `B${String(index).padStart(4, '0')}`,
          FSEIBAN: `S${String(index).padStart(7, '0')}`,
          FHINCD: `P${String(index).padStart(4, '0')}`,
          FHINMEI: `Part ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=320',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as {
      pageSize: number;
      rows: Array<{ id: string }>;
      snapshotId?: string;
    };
    expect(shellBody.pageSize).toBe(160);
    expect(shellBody.rows).toHaveLength(160);
    expect(shellBody.snapshotId).toBeTruthy();
    expect(shellBody.nextCursor).toBe(160);
    expect(shellBody.hasMore).toBe(true);

    const totalRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-total',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(totalRes.statusCode).toBe(200);
    expect((totalRes.json() as { total: number }).total).toBeGreaterThan(shellBody.rows.length);
  });

  it('leaderboard shell continue accumulates rows to match monolithic leaderboard order', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 170 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        dataHash: `bulk-hash-continue-${index}`,
        rowData: {
          ProductNo: `B${String(index).padStart(4, '0')}`,
          FSEIBAN: `S${String(index).padStart(7, '0')}`,
          FHINCD: `P${String(index).padStart(4, '0')}`,
          FHINMEI: `Part ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const mono = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?responseProfile=leaderboard',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(mono.statusCode).toBe(200);
    const monoBody = mono.json() as { rows: Array<{ id: string }>; total: number };
    const expectIds = monoBody.rows.map((r) => r.id);
    expect(expectIds).toHaveLength(monoBody.total);

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=320',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as { rows: Array<{ id: string }>; snapshotId?: string };
    expect(shellBody.rows).toHaveLength(160);
    expect(shellBody.snapshotId).toBeTruthy();
    const shellSnapshotId = shellBody.snapshotId as string;

    const seen = new Set(shellBody.rows.map((r) => r.id));
    const merged = shellBody.rows.map((r) => r.id);
    let guard = 0;
    while (merged.length < monoBody.total && guard < 20) {
      guard += 1;
      const cont = await app.inject({
        method: 'POST',
        url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
        headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
        payload: {
          excludeRowIds: merged,
          pageSize: 160,
          snapshotId: shellSnapshotId
        }
      });
      expect(cont.statusCode).toBe(200);
      const contBody = cont.json() as { rows: Array<{ id: string }> };
      if (contBody.rows.length === 0) break;
      let added = 0;
      for (const r of contBody.rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          merged.push(r.id);
          added += 1;
        }
      }
      if (added === 0) break;
    }

    expect(merged).toEqual(expectIds);
    expect(seen.size).toBe(merged.length);
  });

  it('leaderboard shell continue with snapshotId+cursor matches monolithic leaderboard order', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 170 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        dataHash: `bulk-hash-cursor-${index}`,
        rowData: {
          ProductNo: `C${String(index).padStart(4, '0')}`,
          FSEIBAN: `T${String(index).padStart(7, '0')}`,
          FHINCD: `Q${String(index).padStart(4, '0')}`,
          FHINMEI: `PartC ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const mono = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?responseProfile=leaderboard',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(mono.statusCode).toBe(200);
    const monoBody = mono.json() as { rows: Array<{ id: string }>; total: number };
    const expectIds = monoBody.rows.map((r) => r.id);

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=320',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as {
      rows: Array<{ id: string }>;
      snapshotId?: string;
      nextCursor?: number;
      hasMore?: boolean;
    };
    expect(shellBody.rows).toHaveLength(160);
    const shellSnapshotId = shellBody.snapshotId as string;
    expect(shellBody.nextCursor).toBe(160);
    expect(shellBody.hasMore).toBe(true);

    const seen = new Set(shellBody.rows.map((r) => r.id));
    const merged = shellBody.rows.map((r) => r.id);
    let cursor = shellBody.nextCursor!;
    let hasMore = shellBody.hasMore!;
    let guard = 0;
    while (merged.length < monoBody.total && hasMore && guard < 30) {
      guard += 1;
      const cont = await app.inject({
        method: 'POST',
        url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
        headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
        payload: {
          snapshotId: shellSnapshotId,
          cursor,
          pageSize: 160
        }
      });
      expect(cont.statusCode).toBe(200);
      const contBody = cont.json() as {
        rows: Array<{ id: string }>;
        nextCursor?: number;
        hasMore?: boolean;
        snapshotExpired?: boolean;
      };
      expect(contBody.snapshotExpired).not.toBe(true);
      for (const r of contBody.rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          merged.push(r.id);
        }
      }
      cursor = contBody.nextCursor ?? cursor;
      hasMore = Boolean(contBody.hasMore);
    }

    expect(merged).toEqual(expectIds);
  });

  it('leaderboard shell continue cursor path works beyond 900 total rows (no excludeRowIds)', async () => {
    await prisma.csvDashboardRow.createMany({
      data: Array.from({ length: 1000 }, (_, index) => ({
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)),
        dataHash: `bulk-hash-1k-${index}`,
        rowData: {
          ProductNo: `K${String(index).padStart(4, '0')}`,
          FSEIBAN: `K${String(index).padStart(7, '0')}`,
          FHINCD: `H${String(index).padStart(4, '0')}`,
          FHINMEI: `Big ${index}`,
          FSIGENCD: '1',
          FKOJUN: '10',
          progress: ''
        }
      }))
    });
    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const totalRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-total',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(totalRes.statusCode).toBe(200);
    const total = (totalRes.json() as { total: number }).total;
    expect(total).toBeGreaterThan(900);

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as {
      rows: Array<{ id: string }>;
      snapshotId?: string;
      nextCursor?: number;
      hasMore?: boolean;
    };
    expect(shellBody.rows).toHaveLength(160);
    const shellSnapshotId = shellBody.snapshotId as string;

    const ids: string[] = shellBody.rows.map((r) => r.id);
    let cursor = shellBody.nextCursor!;
    let hasMore = shellBody.hasMore!;
    let guard = 0;
    while (ids.length < total && hasMore && guard < 80) {
      guard += 1;
      const cont = await app.inject({
        method: 'POST',
        url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
        headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
        payload: { snapshotId: shellSnapshotId, cursor, pageSize: 160 }
      });
      expect(cont.statusCode).toBe(200);
      const contBody = cont.json() as { rows: Array<{ id: string }>; nextCursor?: number; hasMore?: boolean };
      ids.push(...contBody.rows.map((r) => r.id));
      cursor = contBody.nextCursor ?? cursor;
      hasMore = Boolean(contBody.hasMore);
    }

    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it('leaderboard shell continue rejects empty body without snapshot cursor or excludeRowIds', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: { pageSize: 160 }
    });
    expect(bad.statusCode).toBe(400);
  });

  it('leaderboard shell continue with unknown snapshotId returns snapshotExpired', async () => {
    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as { rows: Array<{ id: string }>; snapshotId?: string };
    expect(shellBody.snapshotId).toBeTruthy();
    expect(shellBody.rows.length).toBeGreaterThan(0);

    const cont = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: {
        excludeRowIds: shellBody.rows.map((r) => r.id),
        pageSize: 160,
        snapshotId: randomUUID()
      }
    });
    expect(cont.statusCode).toBe(200);
    const contBody = cont.json() as { rows: unknown[]; snapshotExpired?: boolean };
    expect(contBody.snapshotExpired).toBe(true);
    expect(contBody.rows).toEqual([]);
  });

  it('leaderboard shell continue expires when source generation changes', async () => {
    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as { rows: Array<{ id: string }>; snapshotId?: string };
    expect(shellBody.snapshotId).toBeTruthy();
    expect(shellBody.rows.length).toBeGreaterThan(0);

    await prisma.productionScheduleRowNote.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: shellBody.rows[0]!.id,
        note: 'snapshot invalidation',
      }
    });

    const cont = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: {
        excludeRowIds: shellBody.rows.map((r) => r.id),
        pageSize: 160,
        snapshotId: shellBody.snapshotId
      }
    });
    expect(cont.statusCode).toBe(200);
    const contBody = cont.json() as { rows: unknown[]; snapshotExpired?: boolean };
    expect(contBody.snapshotExpired).toBe(true);
    expect(contBody.rows).toEqual([]);
  });

  it('leaderboard shell continue expires when raw FKOJUNST_Status mail rows change without fkmail sync', async () => {
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        name: 'FKOJUNST_Status_Test',
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'APPEND',
        enabled: true
      },
      update: {}
    });

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as { rows: Array<{ id: string }>; snapshotId?: string };
    expect(shellBody.snapshotId).toBeTruthy();
    expect(shellBody.rows.length).toBeGreaterThan(0);

    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        occurredAt: new Date(),
        dataHash: `pcr-mail-gen-${randomUUID()}`,
        rowData: {
          FSEZONO: 'GEN0001',
          FKOJUN: '210',
          FKOTEICD: '1',
          FKOJUNST: 'R',
          FUPDTEDT: '04/13/2026 13:02:46'
        }
      }
    });

    const cont = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: {
        excludeRowIds: shellBody.rows.map((r) => r.id),
        pageSize: 160,
        snapshotId: shellBody.snapshotId
      }
    });
    expect(cont.statusCode).toBe(200);
    const contBody = cont.json() as { rows: unknown[]; snapshotExpired?: boolean };
    expect(contBody.snapshotExpired).toBe(true);
    expect(contBody.rows).toEqual([]);
  });

  it('leaderboard shell continue expires when existing raw FKOJUNST_Status rowData is updated in place', async () => {
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        name: 'FKOJUNST_Status_Test',
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['FKOJUN', 'FKOTEICD', 'FSEZONO', 'FUPDTEDT'],
        enabled: true
      },
      update: {}
    });

    const mailRow = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        occurredAt: new Date('2026-04-13T13:02:46.000Z'),
        dataHash: `pcr-mail-update-${randomUUID()}`,
        rowData: {
          FSEZONO: 'GEN0002',
          FKOJUN: '210',
          FKOTEICD: '1',
          FKOJUNST: 'R',
          FUPDTEDT: '04/13/2026 13:02:46'
        }
      }
    });

    const shell = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/leaderboard-shell?pageSize=160',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(shell.statusCode).toBe(200);
    const shellBody = shell.json() as { rows: Array<{ id: string }>; snapshotId?: string };
    expect(shellBody.snapshotId).toBeTruthy();
    expect(shellBody.rows.length).toBeGreaterThan(0);

    await prisma.csvDashboardRow.update({
      where: { id: mailRow.id },
      data: {
        rowData: {
          FSEZONO: 'GEN0002',
          FKOJUN: '210',
          FKOTEICD: '1',
          FKOJUNST: 'C',
          FUPDTEDT: '04/13/2026 13:02:46'
        }
      }
    });

    const cont = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/leaderboard-shell/continue',
      headers: { 'x-client-key': CLIENT_KEY, 'content-type': 'application/json' },
      payload: {
        excludeRowIds: shellBody.rows.map((r) => r.id),
        pageSize: 160,
        snapshotId: shellBody.snapshotId
      }
    });
    expect(cont.statusCode).toBe(200);
    const contBody = cont.json() as { rows: unknown[]; snapshotExpired?: boolean };
    expect(contBody.snapshotExpired).toBe(true);
    expect(contBody.rows).toEqual([]);
  });

  it('max ProductNo winner materialization equals correlated winner filter (seeded dashboard)', async () => {
    const materialized = await fetchMaxProductNoWinnerRowIdsForDashboard({
      prisma,
      csvDashboardId: DASHBOARD_ID
    });
    const correlatedRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "CsvDashboardRow"."id"::text AS "id"
      FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
    `);
    expect(new Set(materialized)).toEqual(new Set(correlatedRows.map((r) => r.id)));
  });

  it('filters by q with comma-separated tokens (OR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q= A , ,B ',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; FSEIBAN?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001', '0002']);
    expect(body.rows.map((r) => r.rowData.FSEIBAN)).toEqual(['A', 'A', 'B']);
  });

  it('filters by resourceCd and assigned-only with AND to q', async () => {
    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { createdAt: 'asc' }
    });
    const target = rows.find((r) => (r.rowData as any).ProductNo === '0000');
    expect(target).toBeDefined();

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${target?.id}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: '1', orderNumber: 1 }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A&resourceAssignedOnlyCds=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; FSEIBAN?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000']);
  });

  it('does not search when only resourceCd is specified (without query text)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?resourceCds=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    // 資源CD単独では検索されない（空の結果を返す）
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('searches when only resourceAssignedOnlyCds is specified (without query text)', async () => {
    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { createdAt: 'asc' }
    });
    const target = rows.find((r) => (r.rowData as any).ProductNo === '0000');
    expect(target).toBeDefined();

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${target?.id}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: '1', orderNumber: 1 }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?resourceAssignedOnlyCds=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000']);
  });

  it('returns production-schedule resources in ascending order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/resources',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      resources: string[];
      resourceItems: Array<{ resourceCd: string; excluded: boolean }>;
      resourceNameMap: Record<string, string[]>;
    };
    expect(body.resources).toEqual(['1', '2']);
    expect(body.resourceItems).toEqual([
      { resourceCd: '1', excluded: false },
      { resourceCd: '2', excluded: false }
    ]);
    expect(body.resourceNameMap['1']).toEqual(['1号機', '1号機-予備']);
    expect(body.resourceNameMap['2']).toEqual(['2号機']);
  });

  it('returns order usage grouped by resourceCd and supports resource filter', async () => {
    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { createdAt: 'asc' }
    });
    const row1 = rows.find((r) => (r.rowData as any).ProductNo === '0000');
    const row2 = rows.find((r) => (r.rowData as any).ProductNo === '0001');
    const row3 = rows.find((r) => (r.rowData as any).ProductNo === '0002');
    expect(row1).toBeDefined();
    expect(row2).toBeDefined();
    expect(row3).toBeDefined();

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row1?.id}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: '1', orderNumber: 1 }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row2?.id}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: '1', orderNumber: 2 }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row3?.id}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: '2', orderNumber: 1 }
    });

    const filteredRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-usage?resourceCds=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(filteredRes.statusCode).toBe(200);
    const filteredBody = filteredRes.json() as { usage: Record<string, number[]> };
    expect(filteredBody.usage).toEqual({ '1': [1, 2] });

    const allRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-usage',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(allRes.statusCode).toBe(200);
    const allBody = allRes.json() as { usage: Record<string, number[]> };
    expect(allBody.usage).toEqual({ '1': [1, 2], '2': [1] });
  });

  it('reassigns order numbers within the same resourceCd on complete', async () => {
    const created = await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-3',
          rowData: { ProductNo: '0003', FSEIBAN: 'C', FHINCD: 'W', FSIGENCD: '1', FKOJUN: '5', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-4',
          rowData: { ProductNo: '0004', FSEIBAN: 'D', FHINCD: 'V', FSIGENCD: '1', FKOJUN: '5', progress: '' }
        }
      ]
    });
    expect(created.count).toBe(2);

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const list = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: DASHBOARD_ID },
      orderBy: { createdAt: 'asc' }
    });
    const row1 = list.find((r) => (r.rowData as any).ProductNo === '0000')!;
    const row2 = list.find((r) => (r.rowData as any).ProductNo === '0001')!;
    const row3 = list.find((r) => (r.rowData as any).ProductNo === '0003')!;
    const row4 = list.find((r) => (r.rowData as any).ProductNo === '0004')!;

    await app.inject({ method: 'PUT', url: `/api/kiosk/production-schedule/${row1.id}/order`, headers: { 'x-client-key': CLIENT_KEY }, payload: { resourceCd: '1', orderNumber: 1 } });
    await app.inject({ method: 'PUT', url: `/api/kiosk/production-schedule/${row2.id}/order`, headers: { 'x-client-key': CLIENT_KEY }, payload: { resourceCd: '1', orderNumber: 2 } });
    await app.inject({ method: 'PUT', url: `/api/kiosk/production-schedule/${row3.id}/order`, headers: { 'x-client-key': CLIENT_KEY }, payload: { resourceCd: '1', orderNumber: 3 } });
    await app.inject({ method: 'PUT', url: `/api/kiosk/production-schedule/${row4.id}/order`, headers: { 'x-client-key': CLIENT_KEY }, payload: { resourceCd: '1', orderNumber: 4 } });

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row3.id}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });

    const assignments = await prisma.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardId: DASHBOARD_ID, location: 'Test', resourceCd: '1' },
      orderBy: { orderNumber: 'asc' }
    });
    expect(assignments.map((a) => a.orderNumber)).toEqual([1, 2, 3]);
    const row4Assignment = assignments.find((a) => a.csvDashboardRowId === row4.id);
    expect(row4Assignment?.orderNumber).toBe(3);
  });

  it('reconcile releases stale order assignments for externally completed rows (A)', async () => {
    const row = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(row).toBeDefined();
    if (!row) return;

    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: 'Test',
        siteKey: 'Test',
        resourceCd: '1',
        orderNumber: 1,
      },
    });
    await prisma.productionScheduleExternalCompletion.upsert({
      where: { csvDashboardRowId: row.id },
      create: {
        csvDashboardRowId: row.id,
        csvDashboardId: DASHBOARD_ID,
        isExternallyCompleted: true,
        externallyCompletedFromFkojunstMailStatus: true,
      },
      update: {
        isExternallyCompleted: true,
        externallyCompletedFromFkojunstMailStatus: true,
      },
    });

    const result = await reconcileStaleProductionScheduleOrderAssignments();
    expect(result.released).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardRowId: row.id, location: 'Test' },
    });
    expect(remaining).toHaveLength(0);
  });

  it('reconcile releases stale order assignments without fkmail (alpha)', async () => {
    const row = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(row).toBeDefined();
    if (!row) return;

    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: { csvDashboardRowId: row.id },
    });
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: 'Test',
        siteKey: 'Test',
        resourceCd: '1',
        orderNumber: 2,
      },
    });

    await reconcileStaleProductionScheduleOrderAssignments();

    const remaining = await prisma.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardRowId: row.id, location: 'Test' },
    });
    expect(remaining).toHaveLength(0);
  });

  it('reconcile retains order assignments for visible incomplete rows', async () => {
    const row = await prisma.csvDashboardRow.findFirst({
      where: {
        csvDashboardId: DASHBOARD_ID,
        rowData: { path: ['ProductNo'], equals: '0001' },
      },
      select: { id: true },
    });
    expect(row).toBeDefined();
    if (!row) return;

    await prisma.productionScheduleExternalCompletion.deleteMany({
      where: { csvDashboardRowId: row.id },
    });
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: 'Test',
        siteKey: 'Test',
        resourceCd: '1',
        orderNumber: 3,
      },
    });

    await reconcileStaleProductionScheduleOrderAssignments();

    const remaining = await prisma.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardRowId: row.id, location: 'Test' },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.orderNumber).toBe(3);
  });

  it('stores and returns shared search state across kiosks', async () => {
    const initialGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(initialGet.statusCode).toBe(200);
    const initialEtag = initialGet.headers['etag'];
    expect(initialEtag).toBeTruthy();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': initialEtag },
      payload: {
        state: {
          history: ['A']
        }
      }
    });
    expect(putRes.statusCode).toBe(200);
    const updatedEtag = putRes.headers['etag'];
    expect(updatedEtag).toBeTruthy();

    const secondPut = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': updatedEtag },
      payload: {
        state: {
          history: ['B']
        }
      }
    });
    expect(secondPut.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { state: { history?: string[]; inputQuery?: string } };
    expect(body.state?.history).toEqual(['B']);
    expect(body.state?.inputQuery).toBeUndefined();
  });

  it('rejects search-state update without If-Match', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        state: {
          history: ['C']
        }
      }
    });
    expect(res.statusCode).toBe(428);
  });

  it('returns conflict when If-Match is stale', async () => {
    const initialGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const initialEtag = initialGet.headers['etag'];
    expect(initialEtag).toBeTruthy();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': initialEtag },
      payload: { state: { history: ['X'] } }
    });
    expect(putRes.statusCode).toBe(200);

    const stalePut = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': initialEtag },
      payload: { state: { history: ['Y'] } }
    });
    expect(stalePut.statusCode).toBe(409);
  });

  it('returns history progress map for shared history', async () => {
    const initialGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const initialEtag = initialGet.headers['etag'];
    expect(initialEtag).toBeTruthy();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': initialEtag },
      payload: {
        state: {
          history: ['A', 'B', 'C']
        }
      }
    });
    expect(putRes.statusCode).toBe(200);

    const progressRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/history-progress',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    expect(progressRes.statusCode).toBe(200);
    const body = progressRes.json() as {
      history: string[];
      progressBySeiban: Record<
        string,
        { total: number; completed: number; status: 'complete' | 'incomplete'; machineName: string | null }
      >;
    };
    expect(body.history).toEqual(['A', 'B', 'C']);
    expect(body.progressBySeiban.A).toMatchObject({
      total: 2,
      completed: 0,
      status: 'incomplete',
    });
    expect(body.progressBySeiban.B).toMatchObject({
      total: 1,
      completed: 1,
      status: 'complete',
    });
    expect(body.progressBySeiban.C).toMatchObject({
      total: 0,
      completed: 0,
      status: 'incomplete',
    });
    expect(body.progressBySeiban.A).toHaveProperty('machineName');
    expect(body.progressBySeiban.B).toHaveProperty('machineName');
    expect(body.progressBySeiban.C).toHaveProperty('machineName');
  });

  it('updates seiban due date and writes back row dueDate', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-10' }
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json() as { success: boolean; dueDate: string | null; affectedRows: number };
    expect(putBody.success).toBe(true);
    expect(putBody.dueDate).toContain('2026-03-10');
    expect(putBody.affectedRows).toBe(2);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { rows: Array<{ dueDate?: string | null }> };
    expect(listBody.rows).toHaveLength(2);
    expect(listBody.rows.every((row) => String(row.dueDate ?? '').includes('2026-03-10'))).toBe(true);
  });

  it('applies and clears processing-type due-date override with seiban fallback', async () => {
    const processingRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/parts/X/processing',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { processingType: 'LSLH' }
    });
    expect(processingRes.statusCode).toBe(200);

    const seibanDueDateRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-30' }
    });
    expect(seibanDueDateRes.statusCode).toBe(200);

    const overrideRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/processing/LSLH/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-10' }
    });
    expect(overrideRes.statusCode).toBe(200);

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/summary',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(summaryRes.statusCode).toBe(200);
    const summaryA = (summaryRes.json() as { summaries: Array<{ fseiban: string; dueDate: string | null }> }).summaries.find(
      (item) => item.fseiban === 'A'
    );
    expect(summaryA?.dueDate).toContain('2026-03-10');

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json() as {
      detail: {
        processingTypeDueDates: Array<{ processingType: string; dueDate: string | null }>;
        parts: Array<{ fhincd: string; effectiveDueDate: string | null }>;
      };
    };
    expect(detailBody.detail.processingTypeDueDates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          processingType: 'LSLH',
          dueDate: expect.stringContaining('2026-03-10')
        })
      ])
    );
    const partX = detailBody.detail.parts.find((part) => part.fhincd === 'X');
    expect(partX?.effectiveDueDate).toContain('2026-03-10');

    const seibanUpdateRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-20' }
    });
    expect(seibanUpdateRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const rows = (listRes.json() as {
      rows: Array<{ rowData: { FHINCD?: string }; dueDate?: string | null }>;
    }).rows;
    const rowX = rows.find((row) => row.rowData.FHINCD === 'X');
    const rowZ = rows.find((row) => row.rowData.FHINCD === 'Z');
    expect(rowX?.dueDate).toContain('2026-03-10');
    expect(rowZ?.dueDate).toContain('2026-03-20');

    const clearRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/processing/LSLH/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '' }
    });
    expect(clearRes.statusCode).toBe(200);

    const listAfterClearRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listAfterClearRes.statusCode).toBe(200);
    const rowsAfterClear = (listAfterClearRes.json() as {
      rows: Array<{ rowData: { FHINCD?: string }; dueDate?: string | null }>;
    }).rows;
    const rowXAfterClear = rowsAfterClear.find((row) => row.rowData.FHINCD === 'X');
    expect(rowXAfterClear?.dueDate).toContain('2026-03-20');
  });

  it('returns due-management summary and seiban detail', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-11' }
    });

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/summary',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(summaryRes.statusCode).toBe(200);
    const summaryBody = summaryRes.json() as {
      summaries: Array<{ fseiban: string; dueDate: string | null; partsCount: number; processCount: number }>;
    };
    const seibanA = summaryBody.summaries.find((row) => row.fseiban === 'A');
    expect(seibanA).toBeDefined();
    expect(seibanA?.dueDate).toContain('2026-03-11');
    expect(seibanA?.partsCount).toBe(2);
    expect(seibanA?.processCount).toBe(2);

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json() as {
      detail: {
        fseiban: string;
        dueDate: string | null;
        parts: Array<{ fhincd: string; processes: Array<{ resourceCd: string; resourceNames: string[] }> }>;
      };
    };
    expect(detailBody.detail.fseiban).toBe('A');
    expect(detailBody.detail.parts[0]).toHaveProperty('productNo');
    expect(detailBody.detail.parts.map((part) => part.fhincd).sort()).toEqual(['X', 'Z']);
    const partX = detailBody.detail.parts.find((part) => part.fhincd === 'X');
    expect(partX?.processes[0]?.resourceNames).toEqual(['1号機', '1号機-予備']);
  });

  it('due-management seiban detail falls back to CSV plannedEndDate and exposes supplement fields', async () => {
    const rowX = await prisma.csvDashboardRow.findFirst({
      where: { csvDashboardId: DASHBOARD_ID, rowData: { path: ['FHINCD'], equals: 'X' } },
      select: { id: true }
    });
    expect(rowX).toBeTruthy();
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowX!.id,
        sourceCsvDashboardId: ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
        productNo: '0001',
        resourceCd: '1',
        processOrder: '210',
        plannedQuantity: 7,
        plannedStartDate: new Date('2026-05-01T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-10T00:00:00.000Z')
      }
    });

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json() as {
      detail: {
        parts: Array<{
          fhincd: string;
          effectiveDueDate?: string | null;
          effectiveDueDateSource?: string | null;
          plannedQuantity?: number | null;
          plannedStartDate?: string | null;
          plannedEndDate?: string | null;
        }>;
      };
    };
    const partX = detailBody.detail.parts.find((part) => part.fhincd === 'X');
    expect(partX?.effectiveDueDate).toContain('2026-05-10');
    expect(partX?.effectiveDueDateSource).toBe('csv');
    expect(partX?.plannedQuantity).toBe(7);
    expect(partX?.plannedStartDate).toContain('2026-05-01');
    expect(partX?.plannedEndDate).toContain('2026-05-10');
  });

  it('filters out MH/SH parts and excluded resourceCds in due-management detail', async () => {
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-mh-item',
          rowData: { ProductNo: '0010', FSEIBAN: 'A', FHINCD: 'MH0001', FHINMEI: 'Model Name', FSIGENCD: '1', FKOJUN: '1', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-excluded-resource',
          rowData: { ProductNo: '0011', FSEIBAN: 'A', FHINCD: 'X', FHINMEI: 'Part X', FSIGENCD: 'MSZ', FKOJUN: '2', progress: '' }
        }
      ]
    });

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json() as {
      detail: {
        parts: Array<{ fhincd: string; processes: Array<{ resourceCd: string }> }>;
      };
    };
    expect(detailBody.detail.parts.map((part) => part.fhincd)).not.toContain('MH0001');
    const partX = detailBody.detail.parts.find((part) => part.fhincd === 'X');
    expect(partX?.processes.some((process) => process.resourceCd === 'MSZ')).toBe(false);
  });

  it('saves part priorities and returns currentPriorityRank', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/part-priorities',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFhincds: ['Z', 'X'] }
    });
    expect(putRes.statusCode).toBe(200);

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json() as {
      detail: { parts: Array<{ fhincd: string; currentPriorityRank: number | null }> };
    };
    const rankMap = new Map(detailBody.detail.parts.map((part) => [part.fhincd, part.currentPriorityRank]));
    expect(rankMap.get('Z')).toBe(1);
    expect(rankMap.get('X')).toBe(2);
  });

  it('returns due-management triage zones from shared history', async () => {
    const currentDate = new Date();
    const today = currentDate.toISOString().slice(0, 10);
    const after7days = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const stateGetRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(stateGetRes.statusCode).toBe(200);
    const etag = stateGetRes.headers.etag;
    expect(typeof etag).toBe('string');

    const statePutRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': String(etag) },
      payload: { state: { history: ['A', 'B'] } }
    });
    expect(statePutRes.statusCode).toBe(200);

    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: today }
    });
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/B/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: after7days }
    });
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/parts/X/processing',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { processingType: 'LSLH' }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/triage',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      zones: {
        danger: Array<{ fseiban: string; reasons: Array<{ code: string }> }>;
        caution: Array<{ fseiban: string; reasons: Array<{ code: string }> }>;
        safe: Array<{ fseiban: string; reasons: Array<{ code: string }> }>;
      };
      selectedFseibans: string[];
    };
    expect(body.selectedFseibans).toEqual([]);
    expect(body.zones.danger.map((item) => item.fseiban)).toContain('A');
    expect(body.zones.safe.map((item) => item.fseiban)).toContain('B');
    const itemA = body.zones.danger.find((item) => item.fseiban === 'A');
    expect(itemA?.reasons.some((reason) => reason.code === 'DUE_DATE_TODAY')).toBe(true);
    expect(itemA?.reasons.some((reason) => reason.code === 'SURFACE_PRIORITY')).toBe(true);
  });

  it('filters due-management read endpoints by resourceCd', async () => {
    const stateGetRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const etag = stateGetRes.headers.etag;
    expect(typeof etag).toBe('string');

    const statePutRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': String(etag) },
      payload: { state: { history: ['A', 'B'] } }
    });
    expect(statePutRes.statusCode).toBe(200);

    const saveSelectionRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/triage/selection',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { selectedFseibans: ['A', 'B'] }
    });
    expect(saveSelectionRes.statusCode).toBe(200);

    const savePlanRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A', 'B'] }
    });
    expect(savePlanRes.statusCode).toBe(200);

    const saveRankRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A', 'B'] }
    });
    expect(saveRankRes.statusCode).toBe(200);

    const summaryFilteredRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/summary?resourceCd=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(summaryFilteredRes.statusCode).toBe(200);
    const summaryFilteredBody = summaryFilteredRes.json() as { summaries: Array<{ fseiban: string }> };
    expect(summaryFilteredBody.summaries.map((item) => item.fseiban)).toEqual(['A']);

    const triageFilteredRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/triage?resourceCd=2',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(triageFilteredRes.statusCode).toBe(200);
    const triageFilteredBody = triageFilteredRes.json() as {
      zones: {
        danger: Array<{ fseiban: string }>;
        caution: Array<{ fseiban: string }>;
        safe: Array<{ fseiban: string }>;
      };
    };
    const triageFseibans = [
      ...triageFilteredBody.zones.danger,
      ...triageFilteredBody.zones.caution,
      ...triageFilteredBody.zones.safe
    ].map((item) => item.fseiban);
    expect(triageFseibans).toEqual(['B']);

    const dailyPlanFilteredRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan?resourceCd=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(dailyPlanFilteredRes.statusCode).toBe(200);
    const dailyPlanFilteredBody = dailyPlanFilteredRes.json() as { orderedFseibans: string[] };
    expect(dailyPlanFilteredBody.orderedFseibans).toEqual(['A']);

    const globalRankFilteredRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank?resourceCd=2',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(globalRankFilteredRes.statusCode).toBe(200);
    const globalRankFilteredBody = globalRankFilteredRes.json() as { orderedFseibans: string[] };
    expect(globalRankFilteredBody.orderedFseibans).toEqual(['B']);
  });

  it('updates due-management triage selection and returns selected state', async () => {
    const stateGetRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const etag = stateGetRes.headers.etag;
    expect(typeof etag).toBe('string');

    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY, 'if-match': String(etag) },
      payload: { state: { history: ['A', 'B'] } }
    });

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/triage/selection',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { selectedFseibans: ['B'] }
    });
    expect(updateRes.statusCode).toBe(200);
    expect((updateRes.json() as { selectedFseibans: string[] }).selectedFseibans).toEqual(['B']);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/triage',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as {
      zones: {
        danger: Array<{ fseiban: string; isSelected: boolean }>;
        caution: Array<{ fseiban: string; isSelected: boolean }>;
        safe: Array<{ fseiban: string; isSelected: boolean }>;
      };
      selectedFseibans: string[];
    };
    expect(listBody.selectedFseibans).toEqual(['B']);
    const triageItems = [...listBody.zones.danger, ...listBody.zones.caution, ...listBody.zones.safe];
    const itemA = triageItems.find((item) => item.fseiban === 'A');
    const itemB = triageItems.find((item) => item.fseiban === 'B');
    expect(itemA?.isSelected).toBe(false);
    expect(itemB?.isSelected).toBe(true);
  });

  it('saves and returns due-management daily plan order', async () => {
    const selectionRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/triage/selection',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { selectedFseibans: ['B', 'A'] }
    });
    expect(selectionRes.statusCode).toBe(200);

    const beforeSaveRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(beforeSaveRes.statusCode).toBe(200);
    expect((beforeSaveRes.json() as { orderedFseibans: string[] }).orderedFseibans.sort()).toEqual(['A', 'B']);

    const saveRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A', 'B'] }
    });
    expect(saveRes.statusCode).toBe(200);
    const saveBody = saveRes.json() as {
      success: boolean;
      status: string;
      orderedFseibans: string[];
      planDate: string;
    };
    expect(saveBody.success).toBe(true);
    expect(saveBody.status).toBe('draft');
    expect(saveBody.orderedFseibans).toEqual(['A', 'B']);
    expect(saveBody.planDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { orderedFseibans: string[]; status: string };
    expect(getBody.status).toBe('draft');
    expect(getBody.orderedFseibans).toEqual(['A', 'B']);
  });

  it('marks unselected daily-plan items as carryover', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A', 'B'] }
    });

    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/triage/selection',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { selectedFseibans: ['A'] }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orderedFseibans: string[];
      items: Array<{ fseiban: string; isInTodayTriage: boolean; isCarryover: boolean }>;
    };
    expect(body.orderedFseibans).toEqual(['A', 'B']);
    expect(body.items).toEqual([
      { fseiban: 'A', isInTodayTriage: true, isCarryover: false },
      { fseiban: 'B', isInTodayTriage: false, isCarryover: true }
    ]);
  });

  it('persists due-management global rank and updates from daily-plan save', async () => {
    const saveRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['B', 'A'] }
    });
    expect(saveRes.statusCode).toBe(200);

    const rankFromDailyPlan = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(rankFromDailyPlan.statusCode).toBe(200);
    expect((rankFromDailyPlan.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['B', 'A']);

    const putRank = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A', 'B'] }
    });
    expect(putRank.statusCode).toBe(200);
    expect((putRank.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['A', 'B']);

    const getRank = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(getRank.statusCode).toBe(200);
    expect((getRank.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['A', 'B']);
  });

  it('shares global rank across clients when targetLocation is specified', async () => {
    const putRank = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        orderedFseibans: ['B', 'A'],
        targetLocation: '第2工場',
        rankingScope: 'globalShared'
      }
    });
    expect(putRank.statusCode).toBe(200);

    const getRankFromOther = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    expect(getRankFromOther.statusCode).toBe(200);
    expect((getRankFromOther.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['B', 'A']);
  });

  it('applies localTemporary override with explicit scope', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        orderedFseibans: ['A', 'B'],
        targetLocation: '第2工場',
        rankingScope: 'globalShared'
      }
    });

    const tempPut = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        orderedFseibans: ['B', 'A'],
        targetLocation: '第2工場',
        rankingScope: 'localTemporary'
      }
    });
    expect(tempPut.statusCode).toBe(200);

    const tempGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=localTemporary',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(tempGet.statusCode).toBe(200);
    expect((tempGet.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['B', 'A']);

    const sharedGet = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(sharedGet.statusCode).toBe(200);
    expect((sharedGet.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['A', 'B']);
  });

  it('builds global-rank proposal and returns explanation', async () => {
    await prisma.productionScheduleSeibanDueDate.createMany({
      data: [
        { csvDashboardId: DASHBOARD_ID, fseiban: 'A', dueDate: new Date('2026-03-10T00:00:00.000Z') },
        { csvDashboardId: DASHBOARD_ID, fseiban: 'B', dueDate: new Date('2026-03-11T00:00:00.000Z') }
      ]
    });

    const proposalRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank/proposal',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(proposalRes.statusCode).toBe(200);
    const proposalBody = proposalRes.json() as {
      orderedFseibans: string[];
      candidateCount: number;
      items: Array<{ fseiban: string; score: number; breakdown: { reasons: string[] } }>;
    };
    expect(proposalBody.candidateCount).toBeGreaterThan(0);
    expect(proposalBody.orderedFseibans.length).toBe(proposalBody.candidateCount);
    expect(proposalBody.items[0]?.breakdown.reasons.length).toBeGreaterThan(0);

    const explainRes = await app.inject({
      method: 'GET',
      url: `/api/kiosk/production-schedule/due-management/global-rank/explanation/${encodeURIComponent(
        proposalBody.items[0]?.fseiban ?? 'A'
      )}`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(explainRes.statusCode).toBe(200);
    const explainBody = explainRes.json() as { found: boolean; item: { fseiban: string } | null };
    expect(explainBody.found).toBe(true);
    expect(explainBody.item?.fseiban).toBeTruthy();
  });

  it('auto-generates and persists due-management global rank', async () => {
    await prisma.productionScheduleSeibanDueDate.createMany({
      data: [
        { csvDashboardId: DASHBOARD_ID, fseiban: 'A', dueDate: new Date('2026-03-10T00:00:00.000Z') },
        { csvDashboardId: DASHBOARD_ID, fseiban: 'B', dueDate: new Date('2026-03-11T00:00:00.000Z') }
      ]
    });

    const autoRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank/auto-generate',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        minCandidateCount: 1,
        maxReorderDeltaRatio: 1,
        keepExistingTail: true
      }
    });
    expect(autoRes.statusCode).toBe(200);
    const autoBody = autoRes.json() as {
      success: boolean;
      applied: boolean;
      orderedFseibans: string[];
      proposal: { orderedFseibans: string[] };
    };
    expect(autoBody.success).toBe(true);
    expect(autoBody.applied).toBe(true);
    expect(autoBody.orderedFseibans.length).toBeGreaterThan(0);
    expect(autoBody.proposal.orderedFseibans).toEqual(autoBody.orderedFseibans);

    const rankRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(rankRes.statusCode).toBe(200);
    const rankBody = rankRes.json() as { orderedFseibans: string[] };
    expect(rankBody.orderedFseibans).toEqual(autoBody.orderedFseibans);
  });

  it('records learning events and returns learning report', async () => {
    await prisma.productionScheduleSeibanDueDate.createMany({
      data: [
        { csvDashboardId: DASHBOARD_ID, fseiban: 'A', dueDate: new Date('2026-03-10T00:00:00.000Z') },
        { csvDashboardId: DASHBOARD_ID, fseiban: 'B', dueDate: new Date('2026-03-11T00:00:00.000Z') }
      ]
    });

    const autoRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank/auto-generate',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        minCandidateCount: 1,
        maxReorderDeltaRatio: 1,
        keepExistingTail: true
      }
    });
    expect(autoRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const rowId = (listRes.json() as { rows: Array<{ id: string }> }).rows[0]?.id ?? null;
    expect(rowId).not.toBeNull();
    if (!rowId) {
      throw new Error('rowId is missing');
    }

    const completeRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(completeRes.statusCode).toBe(200);

    const reportRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank/learning-report',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(reportRes.statusCode).toBe(200);
    const reportBody = reportRes.json() as {
      summary: {
        proposalCount: number;
        decisionCount: number;
        outcomeCount: number;
      };
      recommendation: { primaryObjective: string };
    };
    expect(reportBody.summary.proposalCount).toBeGreaterThan(0);
    expect(reportBody.summary.decisionCount).toBeGreaterThan(0);
    expect(reportBody.summary.outcomeCount).toBeGreaterThan(0);
    expect(reportBody.recommendation.primaryObjective).toBe('minimize_due_delay');
  });

  it('limits proposal to due-configured seibans and removes due-unset from existing rank on auto-generate', async () => {
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        occurredAt: new Date(),
        dataHash: 'hash-c-no-due',
        rowData: { ProductNo: '0003', FSEIBAN: 'C', FHINCD: 'C1', FSIGENCD: '3', FKOJUN: '10', progress: '' }
      }
    });

    await prisma.productionScheduleSeibanDueDate.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        fseiban: 'A',
        dueDate: new Date('2026-03-10T00:00:00.000Z')
      }
    });

    await prisma.productionScheduleGlobalRank.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          location: 'shared-global-rank',
          fseiban: 'C',
          priorityOrder: 1,
          sourceType: 'manual'
        },
        {
          csvDashboardId: DASHBOARD_ID,
          location: 'shared-global-rank',
          fseiban: 'A',
          priorityOrder: 2,
          sourceType: 'manual'
        }
      ]
    });

    const proposalRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/global-rank/proposal',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(proposalRes.statusCode).toBe(200);
    const proposalBody = proposalRes.json() as { orderedFseibans: string[] };
    expect(proposalBody.orderedFseibans).toEqual(['A']);

    const autoRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/global-rank/auto-generate',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        minCandidateCount: 1,
        maxReorderDeltaRatio: 1,
        keepExistingTail: true
      }
    });
    expect(autoRes.statusCode).toBe(200);
    const autoBody = autoRes.json() as {
      applied: boolean;
      orderedFseibans: string[];
      previousOrderedFseibans: string[];
      proposal: { orderedFseibans: string[] };
    };
    expect(autoBody.applied).toBe(true);
    expect(autoBody.proposal.orderedFseibans).toEqual(['A']);
    expect(autoBody.previousOrderedFseibans).toEqual(['A']);
    expect(autoBody.orderedFseibans).toEqual(['A']);
  });

  it('isolates due-management daily plan by location', async () => {
    const saveTest = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { orderedFseibans: ['A'] }
    });
    expect(saveTest.statusCode).toBe(200);

    const saveOther = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY_2 },
      payload: { orderedFseibans: ['B'] }
    });
    expect(saveOther.statusCode).toBe(200);

    const testPlan = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const otherPlan = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/daily-plan',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });

    expect((testPlan.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['A']);
    expect((otherPlan.json() as { orderedFseibans: string[] }).orderedFseibans).toEqual(['B']);
  });

  it('excludes configured resourceCd from cutting category results', async () => {
    await prisma.productionScheduleResourceCategoryConfig.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        location: 'Test',
        cuttingExcludedResourceCds: ['2']
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=B&resourceCategory=cutting',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }>; total: number };
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('marks configured excluded resources in resources API', async () => {
    await prisma.productionScheduleResourceCategoryConfig.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        location: 'Test',
        cuttingExcludedResourceCds: ['2']
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/resources',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      resourceItems: Array<{ resourceCd: string; excluded: boolean }>;
    };
    expect(body.resourceItems.find((item) => item.resourceCd === '2')?.excluded).toBe(true);
  });

  it('uses shared exclusions when site config is missing in resources API', async () => {
    await prisma.productionScheduleResourceCategoryConfig.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        location: 'shared',
        cuttingExcludedResourceCds: ['2']
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/resources',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      resourceItems: Array<{ resourceCd: string; excluded: boolean }>;
    };
    expect(body.resourceItems.find((item) => item.resourceCd === '2')?.excluded).toBe(true);
  });

  it('paginates results in sorted order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?page=2&pageSize=1',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0001']);
  });

  it('saves and returns row note (PUT note, GET includes note)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const list = (listRes.json() as { rows: Array<{ id: string; note?: string | null }> }).rows;
    const rowId = list[0].id;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: 'テスト備考' }
    });
    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as { success: boolean; note: string | null }).note).toBe('テスト備考');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rows = (getRes.json() as { rows: Array<{ id: string; note?: string | null }> }).rows;
    const row = rows.find((r) => r.id === rowId);
    expect(row?.note).toBe('テスト備考');

    const putEmptyRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '   ' }
    });
    expect(putEmptyRes.statusCode).toBe(200);
    expect((putEmptyRes.json() as { note: string | null }).note).toBeNull();

    const getAfterRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rowsAfter = (getAfterRes.json() as { rows: Array<{ id: string; note?: string | null }> }).rows;
    expect(rowsAfter.find((r) => r.id === rowId)?.note).toBeNull();
  });

  it('shares row note/processing/dueDate across locations', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const rowId = (listRes.json() as { rows: Array<{ id: string }> }).rows[0].id;

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '共有備考' }
    });

    const otherListAfterNote = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    const noteRow = (otherListAfterNote.json() as { rows: Array<{ id: string; note?: string | null }> }).rows.find(
      (row) => row.id === rowId
    );
    expect(noteRow?.note).toBe('共有備考');

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/processing`,
      headers: { 'x-client-key': CLIENT_KEY_2 },
      payload: { processingType: '塗装' }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY_2 },
      payload: { dueDate: '2026-02-15' }
    });

    const ownerView = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const sharedRow = (
      ownerView.json() as { rows: Array<{ id: string; processingType?: string | null; dueDate?: string | null }> }
    ).rows.find((row) => row.id === rowId);
    expect(sharedRow?.processingType).toBe('塗装');
    expect(sharedRow?.dueDate).toContain('2026-02-15');
  });

  it('saves due-management part note and syncs all rows by fseiban+fhincd', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/parts/X/note',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '部品備考同期テスト' }
    });
    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as { success: boolean; note: string | null; affectedRows: number }).success).toBe(true);

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = (detailRes.json() as { detail: { parts: Array<{ fhincd: string; note: string | null }> } }).detail;
    const partX = detail.parts.find((part) => part.fhincd === 'X');
    expect(partX?.note).toBe('部品備考同期テスト');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(listRes.statusCode).toBe(200);
    const listRows = (listRes.json() as { rows: Array<{ rowData: { FHINCD?: string }; note?: string | null }> }).rows;
    const rowX = listRows.filter((row) => row.rowData.FHINCD === 'X');
    expect(rowX.length).toBeGreaterThan(0);
    expect(rowX.every((row) => row.note === '部品備考同期テスト')).toBe(true);
  });

  it('shares due-management dueDate/note/processing across locations', async () => {
    const dueDateRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/due-date',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-03-20' }
    });
    expect(dueDateRes.statusCode).toBe(200);

    const partNoteRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/parts/X/note',
      headers: { 'x-client-key': CLIENT_KEY_2 },
      payload: { note: '共有部品備考' }
    });
    expect(partNoteRes.statusCode).toBe(200);

    const partProcessingRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/due-management/seiban/A/parts/X/processing',
      headers: { 'x-client-key': CLIENT_KEY_2 },
      payload: { processingType: 'LSLH' }
    });
    expect(partProcessingRes.statusCode).toBe(200);

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/summary',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    expect(summaryRes.statusCode).toBe(200);
    const summaryItem = (
      summaryRes.json() as { summaries: Array<{ fseiban: string; dueDate?: string | null }> }
    ).summaries.find((item) => item.fseiban === 'A');
    expect(summaryItem?.dueDate).toContain('2026-03-20');

    const detailRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/due-management/seiban/A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(detailRes.statusCode).toBe(200);
    const part = (
      detailRes.json() as { detail: { parts: Array<{ fhincd: string; note: string | null; processingType: string | null }> } }
    ).detail.parts.find((item) => item.fhincd === 'X');
    expect(part?.note).toBe('共有部品備考');
    expect(part?.processingType).toBe('LSLH');
  });

  it('verifies due-management access password (default/shared)', async () => {
    const okRes = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/due-management/verify-access-password',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { password: '2520' }
    });
    expect(okRes.statusCode).toBe(200);
    expect((okRes.json() as { success: boolean }).success).toBe(true);

    const ngRes = await app.inject({
      method: 'POST',
      url: '/api/kiosk/production-schedule/due-management/verify-access-password',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { password: '0000' }
    });
    expect(ngRes.statusCode).toBe(200);
    expect((ngRes.json() as { success: boolean }).success).toBe(false);
  });

  it('saves and returns row processing type (PUT processing, GET includes processingType)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string }> }).rows;
    const rowId = list[0].id;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/processing`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { processingType: '塗装' }
    });
    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as { success: boolean; processingType: string | null }).processingType).toBe('塗装');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rows = (getRes.json() as { rows: Array<{ id: string; processingType?: string | null }> }).rows;
    const row = rows.find((r) => r.id === rowId);
    expect(row?.processingType).toBe('塗装');
  });

  it('keeps processingType when note is cleared', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string }> }).rows;
    const rowId = list[0].id;

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/processing`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { processingType: 'カニゼン' }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '備考あり' }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '   ' }
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rows = (getRes.json() as { rows: Array<{ id: string; note?: string | null; processingType?: string | null }> }).rows;
    const row = rows.find((r) => r.id === rowId);
    expect(row?.note).toBeNull();
    expect(row?.processingType).toBe('カニゼン');
  });

  it('rejects invalid processing type', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string }> }).rows;
    const rowId = list[0].id;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/processing`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { processingType: 'INVALID' }
    });
    expect(putRes.statusCode).toBe(400);
  });

  it('saves and returns row due date (PUT due-date, GET includes dueDate)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string }> }).rows;
    const rowId = list[0].id;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-02-01' }
    });
    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as { success: boolean; dueDate: string | null }).dueDate).toContain('2026-02-01');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rows = (getRes.json() as { rows: Array<{ id: string; dueDate?: string | null }> }).rows;
    const row = rows.find((r) => r.id === rowId);
    expect(row?.dueDate).toContain('2026-02-01');
  });

  it('keeps dueDate when note is cleared', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string }> }).rows;
    const rowId = list[0].id;

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '備考あり' }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-02-02' }
    });
    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${rowId}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '   ' }
    });

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const rows = (getRes.json() as { rows: Array<{ id: string; note?: string | null; dueDate?: string | null }> }).rows;
    const row = rows.find((r) => r.id === rowId);
    expect(row?.note).toBeNull();
    expect(row?.dueDate).toContain('2026-02-02');
  });

  it('hasDueDateOnly=true returns only rows with a dueDate', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string; rowData: { ProductNo?: string } }> }).rows;
    const row0 = list.find((r) => r.rowData.ProductNo === '0000')!;

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row0.id}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-02-03' }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?hasDueDateOnly=true',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string; rowData: { ProductNo?: string } }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe(row0.id);
  });

  it('hasNoteOnly=true returns only rows with a note', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const list = (listRes.json() as { rows: Array<{ id: string; rowData: { ProductNo?: string } }> }).rows;
    const row0 = list.find((r) => r.rowData.ProductNo === '0000')!;

    await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${row0.id}/note`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { note: '備考あり' }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?hasNoteOnly=true',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string; rowData: { ProductNo?: string } }> };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe(row0.id);
    expect(body.rows[0].rowData.ProductNo).toBe('0000');
  });

  it('applies resourceCategory with q filter (grinding only)', async () => {
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-grinding-305',
          rowData: { ProductNo: '0010', FSEIBAN: 'CAT1', FHINCD: 'G1', FSIGENCD: '305', FKOJUN: '10', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-cutting-100',
          rowData: { ProductNo: '0011', FSEIBAN: 'CAT1', FHINCD: 'C1', FSIGENCD: '100', FKOJUN: '10', progress: '' }
        }
      ]
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?q=CAT1&resourceCategory=grinding',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; FSIGENCD?: string } }> };
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0010']);
    expect(body.rows[0]?.rowData.FSIGENCD).toBe('305');
  });

  it('allows machineName + resource filters without q and returns matching machine seiban rows', async () => {
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-machine-a',
          rowData: {
            ProductNo: '0090',
            FSEIBAN: 'CATM',
            FHINCD: 'P1',
            FHINMEI: '部品A',
            FSIGENCD: '305',
            FKOJUN: '10',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-machine-a-tag',
          rowData: {
            ProductNo: '0091',
            FSEIBAN: 'CATM',
            FHINCD: 'MH001',
            FHINMEI: 'MACHINE-A',
            FSIGENCD: '999',
            FKOJUN: '20',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-machine-b',
          rowData: {
            ProductNo: '0092',
            FSEIBAN: 'CATN',
            FHINCD: 'P2',
            FHINMEI: '部品B',
            FSIGENCD: '305',
            FKOJUN: '10',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-machine-b-tag',
          rowData: {
            ProductNo: '0093',
            FSEIBAN: 'CATN',
            FHINCD: 'MH002',
            FHINMEI: 'MACHINE-B',
            FSIGENCD: '999',
            FKOJUN: '20',
            progress: ''
          }
        }
      ]
    });

    await seedDefaultVisibleFkojunstMailStatusForAllDashboardRows();

    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?resourceCategory=grinding&resourceCds=305&machineName=MACHINE-A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }>; total: number };
    expect(body.rows.map((row) => row.rowData.ProductNo)).toEqual(['0090']);
    expect(body.total).toBe(1);
  });

  it('does not search when only resourceCategory is specified (without q/assignedOnly)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule?resourceCategory=grinding',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string } }>; total: number };
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  describe('process change residual filter', () => {
    async function ensureFkojunstStatusMailDashboard(): Promise<void> {
      await prisma.csvDashboard.upsert({
        where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
        create: {
          id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          name: 'FKOJUNST_Status_Test',
          columnDefinitions: [],
          templateType: 'TABLE',
          templateConfig: {},
          ingestMode: 'APPEND',
          enabled: true
        },
        update: {}
      });
    }

    async function seedRawFkojunstStatusMailRows(
      rows: Array<{
        fsezono: string;
        fkojun: string;
        fkoteicd: string;
        status: string;
        fupdtedt: string;
        hashSuffix: string;
      }>
    ): Promise<void> {
      await ensureFkojunstStatusMailDashboard();
      await prisma.csvDashboardRow.createMany({
        data: rows.map((row, index) => ({
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `pcr-mail-${row.hashSuffix}`,
          sourceRowOrdinal: index + 1,
          rowData: {
            FSEZONO: row.fsezono,
            FKOJUN: row.fkojun,
            FKOTEICD: row.fkoteicd,
            FKOJUNST: row.status,
            FUPDTEDT: row.fupdtedt
          }
        }))
      });
    }

    it('separates strong process change residual from normal leaderboard-board rows', async () => {
      const residualRow = await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'pcr-main-residual',
          rowData: {
            ProductNo: 'PCR0001',
            FSEIBAN: 'PCR-S1',
            FHINCD: 'PCR-P1',
            FHINMEI: 'PCR Part',
            FSIGENCD: '1',
            FKOJUN: '210',
            progress: ''
          }
        }
      });
      await prisma.productionScheduleFkojunstMailStatus.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: residualRow.id,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          fkojun: '210',
          fkoteicd: '1',
          fsezono: 'PCR0001',
          statusCode: 'R',
          sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z')
        }
      });
      await seedRawFkojunstStatusMailRows([
        {
          fsezono: 'PCR0001',
          fkojun: '210',
          fkoteicd: '1',
          status: 'R',
          fupdtedt: '04/13/2026 13:02:46',
          hashSuffix: 'old-r'
        },
        {
          fsezono: 'PCR0001',
          fkojun: '210',
          fkoteicd: '2',
          status: 'C',
          fupdtedt: '05/12/2026 06:46:56',
          hashSuffix: 'new-c'
        }
      ]);

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
      const body = board.json() as {
        rows: Array<{ id: string; rowData: { ProductNo?: string } }>;
        processChangeResidualTotal?: number;
        processChangeResidualRows?: Array<{
          id: string;
          processChangeResidualSuspected?: boolean;
          processChangeResidualEvidence?: { completedOtherResource: { resourceCd: string; status: string } };
        }>;
      };
      expect(body.rows.some((row) => row.id === residualRow.id)).toBe(false);
      expect(body.processChangeResidualTotal).toBe(1);
      expect(body.processChangeResidualRows?.some((row) => row.id === residualRow.id)).toBe(true);
      expect(body.processChangeResidualRows?.[0]?.processChangeResidualSuspected).toBe(true);
      expect(body.processChangeResidualRows?.[0]?.processChangeResidualEvidence?.completedOtherResource).toEqual(
        expect.objectContaining({ resourceCd: '2', status: 'C' })
      );
    });

    it('does not separate when other resource completed but FUPDTEDT comparison is impossible', async () => {
      const row = await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'pcr-main-weak',
          rowData: {
            ProductNo: 'PCR0002',
            FSEIBAN: 'PCR-S2',
            FHINCD: 'PCR-P2',
            FHINMEI: 'PCR Part 2',
            FSIGENCD: '1',
            FKOJUN: '210',
            progress: ''
          }
        }
      });
      await prisma.productionScheduleFkojunstMailStatus.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: row.id,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          fkojun: '210',
          fkoteicd: '1',
          fsezono: 'PCR0002',
          statusCode: 'R',
          sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z')
        }
      });
      await seedRawFkojunstStatusMailRows([
        {
          fsezono: 'PCR0002',
          fkojun: '210',
          fkoteicd: '1',
          status: 'R',
          fupdtedt: 'not-a-date',
          hashSuffix: 'bad-r'
        },
        {
          fsezono: 'PCR0002',
          fkojun: '210',
          fkoteicd: '2',
          status: 'C',
          fupdtedt: '05/12/2026 06:46:56',
          hashSuffix: 'good-c'
        }
      ]);

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
      const body = board.json() as {
        rows: Array<{ id: string }>;
        processChangeResidualTotal?: number;
      };
      expect(body.rows.some((r) => r.id === row.id)).toBe(true);
      expect(body.processChangeResidualTotal ?? 0).toBe(0);
    });

    it('does not separate when completed other resource has different FKOJUN', async () => {
      const row = await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'pcr-main-diff-fkojun',
          rowData: {
            ProductNo: 'PCR0003',
            FSEIBAN: 'PCR-S3',
            FHINCD: 'PCR-P3',
            FHINMEI: 'PCR Part 3',
            FSIGENCD: '1',
            FKOJUN: '210',
            progress: ''
          }
        }
      });
      await prisma.productionScheduleFkojunstMailStatus.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: row.id,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          fkojun: '210',
          fkoteicd: '1',
          fsezono: 'PCR0003',
          statusCode: 'R',
          sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z')
        }
      });
      await seedRawFkojunstStatusMailRows([
        {
          fsezono: 'PCR0003',
          fkojun: '210',
          fkoteicd: '1',
          status: 'R',
          fupdtedt: '04/13/2026 13:02:46',
          hashSuffix: 'r210'
        },
        {
          fsezono: 'PCR0003',
          fkojun: '220',
          fkoteicd: '2',
          status: 'C',
          fupdtedt: '05/12/2026 06:46:56',
          hashSuffix: 'c220'
        }
      ]);

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
      const body = board.json() as {
        rows: Array<{ id: string }>;
        processChangeResidualTotal?: number;
      };
      expect(body.rows.some((r) => r.id === row.id)).toBe(true);
      expect(body.processChangeResidualTotal ?? 0).toBe(0);
    });

    it('does not separate when latest raw row has unparseable FUPDTEDT even if older parseable S/R exists', async () => {
      const row = await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'pcr-main-unparseable-latest',
          rowData: {
            ProductNo: 'PCR0004',
            FSEIBAN: 'PCR-S4',
            FHINCD: 'PCR-P4',
            FHINMEI: 'PCR Part 4',
            FSIGENCD: '1',
            FKOJUN: '210',
            progress: ''
          }
        }
      });
      await prisma.productionScheduleFkojunstMailStatus.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: row.id,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          fkojun: '210',
          fkoteicd: '1',
          fsezono: 'PCR0004',
          statusCode: 'R',
          sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z')
        }
      });
      await seedRawFkojunstStatusMailRows([
        {
          fsezono: 'PCR0004',
          fkojun: '210',
          fkoteicd: '1',
          status: 'R',
          fupdtedt: '04/13/2026 13:02:46',
          hashSuffix: 'parseable-old-r'
        },
        {
          fsezono: 'PCR0004',
          fkojun: '210',
          fkoteicd: '1',
          status: 'S',
          fupdtedt: 'not-a-date',
          hashSuffix: 'unparseable-new-s'
        },
        {
          fsezono: 'PCR0004',
          fkojun: '210',
          fkoteicd: '2',
          status: 'C',
          fupdtedt: '05/12/2026 06:46:56',
          hashSuffix: 'other-c'
        }
      ]);

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
      const body = board.json() as {
        rows: Array<{ id: string }>;
        processChangeResidualTotal?: number;
      };
      expect(body.rows.some((r) => r.id === row.id)).toBe(true);
      expect(body.processChangeResidualTotal ?? 0).toBe(0);
    });

    it('materializes residual strong evidence when raw mail row has invalid ISO FUPDTEDT suffix', async () => {
      await ensureFkojunstStatusMailDashboard();
      await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `pcr-mail-garbage-iso-${randomUUID()}`,
          rowData: {
            FSEZONO: 'PCRISO1',
            FKOJUN: '210',
            FKOTEICD: '1',
            FKOJUNST: 'R',
            FUPDTEDT: '2026-04-23T15:50:35 garbage'
          }
        }
      });

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
    });

    it('does not fail leaderboard-board when raw mail row has invalid calendar ISO FUPDTEDT', async () => {
      await ensureFkojunstStatusMailDashboard();
      await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `pcr-mail-invalid-iso-${randomUUID()}`,
          rowData: {
            FSEZONO: 'PCRISO2',
            FKOJUN: '210',
            FKOTEICD: '1',
            FKOJUNST: 'R',
            FUPDTEDT: '2026-13-01T00:00:00'
          }
        }
      });

      const board = await app.inject({
        method: 'GET',
        url: '/api/kiosk/production-schedule/leaderboard-board?boardResourceCds=1&pageSize=160&allowResourceOnly=true&includeDecorations=false',
        headers: { 'x-client-key': CLIENT_KEY }
      });
      expect(board.statusCode).toBe(200);
    });
  });
});

