import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const CLIENT_KEY = 'client-demo-key';
const CLIENT_KEY_2 = 'client-demo-key-2';

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
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCategoryConfig.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCodeMapping.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    if (closeServer) await closeServer();
  });

  beforeEach(async () => {
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
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCategoryConfig.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleResourceCodeMapping.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });

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

    const body = res.json() as { resources: string[] };
    expect(body.resources).toEqual(['1', '2']);
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
      detail: { fseiban: string; dueDate: string | null; parts: Array<{ fhincd: string }> };
    };
    expect(detailBody.detail.fseiban).toBe('A');
    expect(detailBody.detail.parts[0]).toHaveProperty('productNo');
    expect(detailBody.detail.parts.map((part) => part.fhincd).sort()).toEqual(['X', 'Z']);
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
});

