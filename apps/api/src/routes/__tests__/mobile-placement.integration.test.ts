import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import {
  createTestClientDevice,
  createTestItem,
  expectApiError
} from './helpers.js';
import { prisma } from '../../lib/prisma.js';
import { resetImageOcrPortForTests } from '../../services/ocr/image-ocr-runtime.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.PHOTO_STORAGE_DIR ??= '/tmp/test-mobile-placement';
process.env.SIGNAGE_RENDER_DIR ??= '/tmp/test-mobile-placement/signage';

/** 1x1 PNG（multipart 用） */
const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartImageField(
  fieldName: string,
  filename: string,
  buf: Buffer,
  mime: string
): { body: Buffer; contentType: string } {
  const boundary = `----testMpImg${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${crlf}Content-Type: ${mime}${crlf}${crlf}`
  );
  parts.push(buf);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

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
    await prisma.orderPlacementBranchState.deleteMany();
    await prisma.orderPlacementEvent.deleteMany();
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

  it('POST /api/mobile-placement/verify-slip-match returns ok when slips match', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999777',
          FSEIBAN: 'SEI-001',
          FHINCD: 'H-1',
          FHINMEI: '部品名一致',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/verify-slip-match',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        transferOrderBarcodeRaw: '999777',
        transferPartBarcodeRaw: 'H-1',
        actualOrderBarcodeRaw: '999777',
        actualFseibanRaw: '',
        actualPartBarcodeRaw: 'H-1'
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('POST /api/mobile-placement/verify-slip-match returns part mismatch when order exists', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999778',
          FSEIBAN: 'SEI-002',
          FHINCD: 'H-2',
          FHINMEI: '正しい部品名',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/verify-slip-match',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        transferOrderBarcodeRaw: '999778',
        transferPartBarcodeRaw: 'WRONG-H-2',
        actualOrderBarcodeRaw: '999778',
        actualFseibanRaw: '',
        actualPartBarcodeRaw: 'H-2'
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, reason: 'TRANSFER_PART_MISMATCH' });
  });

  it('POST /api/mobile-placement/verify-slip-match returns ok when actual slip resolves by FSEIBAN only', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999800',
          FSEIBAN: 'SEI-FB-ONLY',
          FHINCD: 'H-80',
          FHINMEI: '部品A',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/verify-slip-match',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        transferOrderBarcodeRaw: '999800',
        transferPartBarcodeRaw: 'H-80',
        actualOrderBarcodeRaw: '',
        actualFseibanRaw: 'SEI-FB-ONLY',
        actualPartBarcodeRaw: 'H-80'
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('POST /api/mobile-placement/parse-actual-slip-image returns parsed fields with stub OCR', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const prev = process.env.IMAGE_OCR_STUB_TEXT;
    process.env.IMAGE_OCR_STUB_TEXT = '製造オーダNo 0002178005\n製番 BE1N9321';
    resetImageOcrPortForTests();
    try {
      const { body, contentType } = buildMultipartImageField('image', 't.png', MIN_PNG, 'image/png');
      const res = await app.inject({
        method: 'POST',
        url: '/api/mobile-placement/parse-actual-slip-image',
        headers: {
          'Content-Type': contentType,
          'x-client-key': clientApiKey
        },
        payload: body
      });
      expect(res.statusCode).toBe(200);
      const j = res.json() as {
        engine: string;
        manufacturingOrder10: string | null;
        fseiban: string | null;
      };
      expect(j.engine).toBe('stub');
      expect(j.manufacturingOrder10).toBe('0002178005');
      expect(j.fseiban).toBe('BE1N9321');
    } finally {
      if (prev === undefined) {
        delete process.env.IMAGE_OCR_STUB_TEXT;
      } else {
        process.env.IMAGE_OCR_STUB_TEXT = prev;
      }
      resetImageOcrPortForTests();
    }
  });

  it('POST /api/mobile-placement/register-order-placement creates event without updating Item', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999888',
          FSEIBAN: 'SEI-888',
          FHINCD: 'H-8',
          FHINMEI: 'x',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register-order-placement',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'TEMP-A',
        manufacturingOrderBarcodeRaw: '999888'
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.event.shelfCodeRaw).toBe('TEMP-A');
    expect(body.event.manufacturingOrderBarcodeRaw).toBe('999888');
    expect(body.event.branchNo).toBe(1);
    expect(body.event.actionType).toBe('CREATE_BRANCH');
    expect(body.branchState.branchNo).toBe(1);

    const count = await prisma.orderPlacementEvent.count();
    expect(count).toBe(1);
    const stateCount = await prisma.orderPlacementBranchState.count();
    expect(stateCount).toBe(1);
  });

  it('GET /api/mobile-placement/order-placement-branches lists current shelves per branch', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999901',
          FSEIBAN: 'SEI-901',
          FHINCD: 'H-9',
          FHINMEI: 'x',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register-order-placement',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'TEMP-A',
        manufacturingOrderBarcodeRaw: '999901'
      }
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register-order-placement',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'TEMP-B',
        manufacturingOrderBarcodeRaw: '999901'
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().event.branchNo).toBe(2);

    const list = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/order-placement-branches?manufacturingOrder=999901',
      headers: { 'x-client-key': clientApiKey }
    });
    expect(list.statusCode).toBe(200);
    const branches = list.json().branches as Array<{ branchNo: number; shelfCodeRaw: string }>;
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({ branchNo: 1, shelfCodeRaw: 'TEMP-A' });
    expect(branches[1]).toMatchObject({ branchNo: 2, shelfCodeRaw: 'TEMP-B' });
  });

  it('PATCH /api/mobile-placement/order-placement-branches/:id/move updates shelf and history', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999902',
          FSEIBAN: 'SEI-902',
          FHINCD: 'H-9',
          FHINMEI: 'x',
          FSIGENCD: 'G1',
          FKOJUN: '1'
        }
      }
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register-order-placement',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: '西-北-01',
        manufacturingOrderBarcodeRaw: '999902'
      }
    });
    expect(created.statusCode).toBe(200);
    const branchStateId = (created.json() as { branchState: { id: string } }).branchState.id;

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/mobile-placement/order-placement-branches/${branchStateId}/move`,
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: { shelfCodeRaw: '西-北-02' }
    });
    expect(moved.statusCode).toBe(200);
    const mj = moved.json() as { event: { actionType: string }; branchState: { shelfCodeRaw: string } };
    expect(mj.event.actionType).toBe('MOVE_BRANCH');
    expect(mj.branchState.shelfCodeRaw).toBe('西-北-02');

    const fromDb = await prisma.orderPlacementBranchState.findUnique({ where: { id: branchStateId } });
    expect(fromDb?.shelfCodeRaw).toBe('西-北-02');
    const evCount = await prisma.orderPlacementEvent.count();
    expect(evCount).toBe(2);
  });

  it('GET /api/mobile-placement/registered-shelves returns distinct shelf codes with structure metadata', async () => {
    const client = await createTestClientDevice();
    await prisma.orderPlacementEvent.create({
      data: {
        clientDeviceId: client.id,
        shelfCodeRaw: 'TEMP-A',
        manufacturingOrderBarcodeRaw: 'ORD-1',
        csvDashboardRowId: null
      }
    });
    await prisma.orderPlacementEvent.create({
      data: {
        clientDeviceId: client.id,
        shelfCodeRaw: '西-北-01',
        manufacturingOrderBarcodeRaw: 'ORD-2',
        csvDashboardRowId: null
      }
    });
    await prisma.orderPlacementEvent.create({
      data: {
        clientDeviceId: client.id,
        shelfCodeRaw: '西-北-01',
        manufacturingOrderBarcodeRaw: 'ORD-3',
        csvDashboardRowId: null
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/registered-shelves',
      headers: { 'x-client-key': client.apiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      shelves: Array<{
        shelfCodeRaw: string;
        isStructured: boolean;
        areaId?: string;
        lineId?: string;
        slot?: number;
      }>;
    };
    expect(body.shelves).toHaveLength(2);
    const temp = body.shelves.find((s) => s.shelfCodeRaw === 'TEMP-A');
    expect(temp).toMatchObject({ shelfCodeRaw: 'TEMP-A', isStructured: false });
    const west = body.shelves.find((s) => s.shelfCodeRaw === '西-北-01');
    expect(west).toMatchObject({
      shelfCodeRaw: '西-北-01',
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 1
    });
  });

  it('returns 401 without client key for resolve-item', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/resolve-item?barcode=x'
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 without client key for part-search suggest', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/part-search/suggest?q=test'
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/mobile-placement/part-search/suggest returns empty for empty q', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/part-search/suggest?q=',
      headers: { 'x-client-key': clientApiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { currentPlacements: unknown[]; scheduleCandidates: unknown[] };
    expect(body.currentPlacements).toEqual([]);
    expect(body.scheduleCandidates).toEqual([]);
  });

  it('GET /api/mobile-placement/part-search/suggest finds current placement and アシ alias', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
          ProductNo: '999880',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'FH-PST',
          FHINMEI: 'テーブル脚',
          FSIGENCD: '',
          FKOJUN: ''
        }
      }
    });
    await prisma.orderPlacementBranchState.create({
      data: {
        manufacturingOrderBarcodeRaw: '0000999880',
        branchNo: 1,
        shelfCodeRaw: '東-南-01',
        csvDashboardRowId: row.id,
        scheduleSnapshot: {
          ProductNo: '999880',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'FH-PST',
          FHINMEI: 'テーブル脚'
        }
      }
    });

    const resAlias = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('アシ')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(resAlias.statusCode).toBe(200);
    const bodyAlias = resAlias.json() as {
      currentPlacements: Array<{ displayName: string; shelfCodeRaw: string | null; aliasMatchedBy: string | null }>;
    };
    expect(bodyAlias.currentPlacements.length).toBeGreaterThan(0);
    expect(bodyAlias.currentPlacements[0].displayName).toContain('脚');
    expect(bodyAlias.currentPlacements[0].shelfCodeRaw).toBe('東-南-01');
    expect(bodyAlias.currentPlacements[0].aliasMatchedBy).toBe('アシ/脚/足');
  });

  it('GET /api/mobile-placement/part-search/suggest returns schedule candidates when no current shelf', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
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
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999881',
          FSEIBAN: 'PSTEST02',
          FHINCD: 'FH-SCH',
          FHINMEI: 'スケジュール専用部品',
          FSIGENCD: '',
          FKOJUN: ''
        }
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('スケジュール')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currentPlacements: unknown[];
      scheduleCandidates: Array<{ matchSource: string; displayName: string }>;
    };
    expect(body.currentPlacements).toHaveLength(0);
    expect(body.scheduleCandidates.length).toBeGreaterThan(0);
    expect(body.scheduleCandidates[0].matchSource).toBe('schedule');
  });
});
