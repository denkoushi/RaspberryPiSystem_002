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
    await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    if (closeServer) await closeServer();
  });

  beforeEach(async () => {
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
  });

  it('rejects request without x-client-key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kiosk/production-schedule' });
    expect(res.statusCode).toBe(401);
  });

  it('lists all rows including completed ones (for graying out)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; progress?: string } }> };
    // 完了状態のものも含めて全て返す（グレーアウト表示のため）
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0000', '0001', '0002']);
    // 完了状態のものはprogressが'完了'
    const completedRow = body.rows.find((r) => r.rowData.ProductNo === '0002');
    expect(completedRow?.rowData.progress).toBe('完了');
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
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        state: {
          inputQuery: 'A',
          activeQueries: ['A'],
          activeResourceCds: ['1'],
          activeResourceAssignedOnlyCds: ['2']
        }
      }
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/search-state',
      headers: { 'x-client-key': CLIENT_KEY_2 }
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { state: { inputQuery?: string } };
    expect(body.state?.inputQuery).toBe('A');
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
});

