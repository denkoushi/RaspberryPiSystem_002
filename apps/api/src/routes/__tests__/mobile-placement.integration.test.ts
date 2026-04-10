import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import {
  createTestClientDevice,
  createTestItem,
  expectApiError
} from './helpers.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-mobile-placement';
process.env.SIGNAGE_RENDER_DIR ??= '/tmp/test-mobile-placement/signage';

describe('mobile-placement API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) await closeServer();
  });

  beforeEach(async () => {
    await prisma.mobilePlacementEvent.deleteMany();
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
    });
    await prisma.csvDashboard.deleteMany({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID }
    });
    await prisma.item.deleteMany({
      where: { itemCode: { in: ['MP-TEST-ITEM-001', 'MP-REG-001', 'ABCD1234', 'OTHER-ITEM-9'] } }
    });
    await prisma.clientDevice.deleteMany({
      where: { name: { startsWith: 'Test Client ' } }
    });
  });

  it('GET /api/mobile-placement/resolve-item returns item when itemCode matches', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const item = await createTestItem({ itemCode: 'MP-TEST-ITEM-001' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/resolve-item?barcode=mp-test-item-001',
      headers: { 'x-client-key': clientApiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matchKind).toBe('itemCode');
    expect(body.item?.id).toBe(item.id);
  });

  it('POST /api/mobile-placement/register updates storage and creates event', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const item = await createTestItem({
      itemCode: 'MP-REG-001',
      name: 'Placement test'
    });
    const shelf = 'SHELF-A1';

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: shelf,
        itemBarcodeRaw: item.itemCode
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item.storageLocation).toBe(shelf);
    expect(body.event.newStorageLocation).toBe(shelf);
    expect(body.event.itemId).toBe(item.id);

    const fromDb = await prisma.item.findUnique({ where: { id: item.id } });
    expect(fromDb?.storageLocation).toBe(shelf);
  });

  it('POST /api/mobile-placement/register validates schedule row when csvDashboardRowId set', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    await createTestItem({ itemCode: 'ABCD1234' });
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      update: {},
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'test production schedule',
        columnDefinitions: {},
        templateConfig: {}
      }
    });
    const row = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999001',
          FSEIBAN: 'ABCD1234',
          FHINCD: 'FH-XYZ',
          FHINMEI: 'demo'
        }
      }
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'S1',
        itemBarcodeRaw: 'ABCD1234',
        csvDashboardRowId: row.id
      }
    });
    expect(ok.statusCode).toBe(200);

    const otherItem = await createTestItem({ itemCode: 'OTHER-ITEM-9' });
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'S2',
        itemBarcodeRaw: otherItem.itemCode,
        csvDashboardRowId: row.id
      }
    });
    expectApiError(mismatch, 400);

    await prisma.csvDashboardRow.deleteMany({ where: { id: row.id } });
  });

  it('returns 401 without client key for resolve-item', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/resolve-item?barcode=x'
    });
    expect(res.statusCode).toBe(401);
  });
});
