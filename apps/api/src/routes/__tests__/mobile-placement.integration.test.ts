vi.mock('../../config/env/load-dotenv.js', () => ({}));

import { resetKnownFseibanCache } from '../../services/mobile-placement/known-fseiban-cache.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    resetKnownFseibanCache();
    await prisma.orderPlacementBranchState.deleteMany();
    await prisma.orderPlacementEvent.deleteMany();
    await prisma.mobilePlacementEvent.deleteMany();
    await prisma.haizenScanEvent.deleteMany();
    await prisma.haizenCurrentPlacement.deleteMany();
    await prisma.mobilePlacementShelf.deleteMany();
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
          ProductNo: ' 999001 ',
          FSEIBAN: ' abcd1234 ',
          FHINCD: 123,
          FHINMEI: false
        }
      }
    });
    const scheduleRowRead = vi.spyOn(prisma.csvDashboardRow, 'findFirst');
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
    expect(ok.json().resolveMatchKind).toBe('itemCode');
    expect(scheduleRowRead).toHaveBeenCalledExactlyOnceWith({
      where: { id: row.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { rowData: true }
    });
    const event = await prisma.mobilePlacementEvent.findFirst({
      where: { csvDashboardRowId: row.id },
      select: { scheduleSnapshot: true }
    });
    expect(event?.scheduleSnapshot).toEqual({
      ProductNo: ' 999001 ',
      FSEIBAN: ' abcd1234 ',
      FHINCD: 123,
      FHINMEI: false
    });
    vi.restoreAllMocks();

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
    expectApiError(mismatch, 400, 'スキャン値が選択したスケジュール行');

    await prisma.csvDashboardRow.deleteMany({ where: { id: row.id } });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/register',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': clientApiKey
      },
      payload: {
        shelfCodeRaw: 'S3',
        itemBarcodeRaw: 'ABCD1234',
        csvDashboardRowId: row.id
      }
    });
    expectApiError(missing, 404, '指定のスケジュール行が見つかりません');
  });

  it.each([undefined, '', 'H-1'])('POST /api/mobile-placement/verify-slip-match accepts optional parts (%s)', async (parts) => {
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
        transferPartBarcodeRaw: parts,
        actualOrderBarcodeRaw: '999777',
        actualFseibanRaw: '',
        actualPartBarcodeRaw: parts
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'productNo', expected: { fseiban: 'SEI-001', fhincd: 'H-1', partName: '部品名一致' } });
  });

  it('POST /api/mobile-placement/verify-slip-match resolves actual slip by purchase order', async () => {
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

    const purchaseRow = await prisma.purchaseOrderLookupRow.create({
      data: {
        sourceCsvDashboardId: 'mobile-placement-test-purchase', purchaseOrderNo: '1234567890',
        seiban: 'sei-001', purchasePartCodeRaw: 'H-002', purchasePartCodeNormalized: 'H-002',
        purchasePartCodeMatchKey: 'H', purchasePartName: 'test'
      }
    });
    try {
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
          actualOrderBarcodeRaw: '1234567890',
          actualFseibanRaw: '',
          actualPartBarcodeRaw: 'H-1'
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder' });
    } finally {
      await prisma.purchaseOrderLookupRow.delete({ where: { id: purchaseRow.id } });
    }
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
    expect(res.json()).toMatchObject({ ok: false, reason: 'different_part', legacyReason: 'TRANSFER_PART_MISMATCH', actualResolvedBy: 'productNo' });
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
    expect(res.json()).toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'fseiban' });
  });

  it.each([['BE1N9321', 'exact', false], ['8E1N9321', 'corrected', false], ['8E1N9321', 'corrected', true]] as const)('POST /api/mobile-placement/parse-actual-slip-image snaps %s (%s, neighbour row: %s)', async (raw, match, withNeighbour) => {
    await prisma.csvDashboard.create({ data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'test schedule', columnDefinitions: {}, templateConfig: {} } });
    await prisma.csvDashboardRow.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
      rowData: { ProductNo: '0002178005', FSEIBAN: ' BE1N9321 ', FHINCD: 'H-1', FSIGENCD: 'G1', FKOJUN: '1' } } });
    const { apiKey: clientApiKey } = await createTestClientDevice();
    if (withNeighbour) {
      await prisma.csvDashboardRow.create({ data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
        rowData: { ProductNo: '0002178006', FSEIBAN: 'BE1N9327', FHINCD: 'H-2', FSIGENCD: 'G1', FKOJUN: '1' }
      } });
    }
    const prev = process.env.IMAGE_OCR_STUB_TEXT;
    process.env.IMAGE_OCR_STUB_TEXT = `製造オーダNo 0002178005\n製番 ${raw}`;
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
      expect(j).toMatchObject({ fseibanRaw: raw, fseibanMatch: match, fseibanCandidates: withNeighbour && match === 'corrected' ? ['BE1N9321', 'BE1N9327'] : ['BE1N9321'] });
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

  it.each([
    ['BE1N9321', 'exact', 'BE1N9321'],
    ['8E1N9321', 'corrected', 'BE1N9321'],
    ['ZZ999999', 'none', 'ZZ999999']
  ] as const)('POST /api/mobile-placement/snap-fseiban-tokens snaps %s (%s)', async (raw, match, expected) => {
    await prisma.csvDashboard.create({ data: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'test schedule', columnDefinitions: {}, templateConfig: {}
    } });
    await prisma.csvDashboardRow.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
      rowData: { ProductNo: '0002178005', FSEIBAN: ' BE1N9321 ', FHINCD: 'H-1', FSIGENCD: 'G1', FKOJUN: '1' }
    } });
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const text = `製造オーダNo 0002178005\n製番 ${raw}`;
    const res = await app.inject({
      method: 'POST', url: '/api/mobile-placement/snap-fseiban-tokens',
      headers: { 'x-client-key': clientApiKey }, payload: { tokens: [raw], text }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      engine: 'device', ocrText: text, ocrPreviewSafe: expect.any(String),
      manufacturingOrder10: '0002178005', fseibanRaw: raw, fseibanMatch: match,
      fseibanCandidates: match === 'none' ? [] : ['BE1N9321'], fseiban: expected
    });
  });

  it('POST /api/mobile-placement/snap-fseiban-tokens accepts omitted text', async () => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const res = await app.inject({
      method: 'POST', url: '/api/mobile-placement/snap-fseiban-tokens',
      headers: { 'x-client-key': clientApiKey }, payload: { tokens: ['BA1S3332'] }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ engine: 'device', ocrText: '', manufacturingOrder10: null });
  });

  it('POST /api/mobile-placement/snap-fseiban-tokens requires a client key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/mobile-placement/snap-fseiban-tokens', payload: { tokens: ['BE1N9321'] }
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it.each([
    {}, { tokens: [] }, { tokens: [''] }, { tokens: ['A'.repeat(33)] },
    { tokens: Array.from({ length: 51 }, () => 'BE1N9321') }, { tokens: [123] },
    { tokens: ['BE1N9321'], text: 'a'.repeat(4001) }, { tokens: ['BE1N9321'], text: 123 }
  ])('POST /api/mobile-placement/snap-fseiban-tokens rejects invalid body %#', async (payload) => {
    const { apiKey: clientApiKey } = await createTestClientDevice();
    const res = await app.inject({
      method: 'POST', url: '/api/mobile-placement/snap-fseiban-tokens',
      headers: { 'x-client-key': clientApiKey }, payload
    });
    expect(res.statusCode).toBe(400);
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

  it('GET /api/mobile-placement/registered-shelves returns shelf master rows with structure metadata', async () => {
    const client = await createTestClientDevice();
    await prisma.mobilePlacementShelf.create({
      data: { shelfCodeRaw: 'TEMP-A' }
    });
    await prisma.mobilePlacementShelf.create({
      data: { shelfCodeRaw: '西-北-01', createdByClientDeviceId: client.id }
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

  it('POST /api/mobile-placement/shelves registers structured shelf and rejects duplicate', async () => {
    const { apiKey } = await createTestClientDevice();
    const created = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/shelves',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': apiKey
      },
      payload: { shelfCodeRaw: '東-南-05' }
    });
    expect(created.statusCode).toBe(200);
    const cj = created.json() as { shelf: { shelfCodeRaw: string; isStructured: boolean } };
    expect(cj.shelf.shelfCodeRaw).toBe('東-南-05');
    expect(cj.shelf.isStructured).toBe(true);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/shelves',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': apiKey
      },
      payload: { shelfCodeRaw: '東-南-05' }
    });
    expect(dup.statusCode).toBe(409);
  });

  it('GET /api/mobile-placement/haizen-target-devices returns zero2w candidates only', async () => {
    const actor = await createTestClientDevice();
    await prisma.clientDevice.create({
      data: {
        name: 'Test Client zero2w-tanaban01',
        apiKey: 'client-key-zero2w-tanaban01-edge1',
        haizenEdgeEnabled: true,
        haizenPresetShelfCodeRaw: '西-北-01'
      }
    });
    await prisma.clientDevice.create({
      data: {
        name: 'Test Client Android kiosk',
        apiKey: 'client-key-android-kiosk-1'
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/haizen-target-devices',
      headers: { 'x-client-key': actor.apiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      devices: Array<{ name: string; shelfCodeRaw: string | null }>;
    };
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({
      name: 'Test Client zero2w-tanaban01',
      shelfCodeRaw: '西-北-01'
    });
  });

  it('PUT /api/mobile-placement/haizen-target-devices/:id/preset-shelf updates selected zero2w shelf', async () => {
    const actor = await createTestClientDevice();
    const target = await prisma.clientDevice.create({
      data: {
        name: 'Test Client zero2w-tanaban01',
        apiKey: 'client-key-zero2w-tanaban01-edge1',
        haizenEdgeEnabled: true
      }
    });
    await prisma.mobilePlacementShelf.create({
      data: { shelfCodeRaw: '西-北-02', createdByClientDeviceId: actor.id }
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/mobile-placement/haizen-target-devices/${target.id}/preset-shelf`,
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': actor.apiKey
      },
      payload: { shelfCodeRaw: '西-北-02' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shelfCodeRaw: '西-北-02' });

    const fromDb = await prisma.clientDevice.findUnique({ where: { id: target.id } });
    expect(fromDb?.haizenPresetShelfCodeRaw).toBe('西-北-02');
  });

  it('PUT /api/mobile-placement/haizen-target-devices/:id/preset-shelf clears preset with null', async () => {
    const actor = await createTestClientDevice();
    const target = await prisma.clientDevice.create({
      data: {
        name: 'Test Client zero2w-clear',
        apiKey: 'client-key-zero2w-clear-1',
        haizenEdgeEnabled: true,
        haizenPresetShelfCodeRaw: '西-北-01'
      }
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/mobile-placement/haizen-target-devices/${target.id}/preset-shelf`,
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': actor.apiKey
      },
      payload: { shelfCodeRaw: null }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shelfCodeRaw: null });

    const fromDb = await prisma.clientDevice.findUnique({ where: { id: target.id } });
    expect(fromDb?.haizenPresetShelfCodeRaw).toBeNull();
  });

  it('PATCH /api/mobile-placement/haizen-preset-shelf rejects shelf not in master', async () => {
    const actor = await createTestClientDevice('client-key-zero2w-patch-self-1');
    await prisma.mobilePlacementShelf.create({
      data: { shelfCodeRaw: '西-北-20', createdByClientDeviceId: actor.id }
    });
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/mobile-placement/haizen-preset-shelf',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'client-key-zero2w-patch-self-1'
      },
      payload: { shelfCodeRaw: '西-北-20' }
    });
    expect(ok.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/mobile-placement/haizen-preset-shelf',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'client-key-zero2w-patch-self-1'
      },
      payload: { shelfCodeRaw: '西-北-99' }
    });
    expect(bad.statusCode).toBe(400);
    const bj = bad.json() as { errorCode?: string };
    expect(bj.errorCode).toBe('HAIZEN_PRESET_SHELF_NOT_REGISTERED');
  });

  it('GET /api/mobile-placement/haizen-current accepts shelfCodeRaw query alias', async () => {
    const actor = await createTestClientDevice();
    const a = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/haizen-current?shelfCodeRaw=西-北-01&limit=5',
      headers: { 'x-client-key': actor.apiKey }
    });
    const b = await app.inject({
      method: 'GET',
      url: '/api/mobile-placement/haizen-current?shelfCode=西-北-01&limit=5',
      headers: { 'x-client-key': actor.apiKey }
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
  });

  it('POST /api/mobile-placement/haizen-scans records scan with preset', async () => {
    const edge = await createTestClientDevice('client-key-zero2w-scan-int-1');
    await prisma.mobilePlacementShelf.create({
      data: { shelfCodeRaw: '西-北-30', createdByClientDeviceId: edge.id }
    });
    await prisma.clientDevice.update({
      where: { id: edge.id },
      data: { haizenPresetShelfCodeRaw: '西-北-30' }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/haizen-scans',
      headers: {
        'Content-Type': 'application/json',
        'x-client-key': 'client-key-zero2w-scan-int-1'
      },
      payload: { manufacturingOrderBarcodeRaw: 'ORD-SCAN-1' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { resolutionStatus: string; current: { manufacturingOrderBarcodeRaw: string } | null };
    expect(body.resolutionStatus).toBe('UNRESOLVED');
    expect(body.current?.manufacturingOrderBarcodeRaw).toBe('ORD-SCAN-1');
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

  it('returns 401 without client key for POST shelves', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mobile-placement/shelves',
      headers: { 'Content-Type': 'application/json' },
      payload: { shelfCodeRaw: '西-北-01' }
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

    const resAnd = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('テーブル 脚')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(resAnd.statusCode).toBe(200);
    const bodyAnd = resAnd.json() as { currentPlacements: Array<{ displayName: string }> };
    expect(bodyAnd.currentPlacements.length).toBeGreaterThan(0);
    expect(bodyAnd.currentPlacements[0].displayName).toContain('脚');

    const resAndMiss = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('テーブル ボルト')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(resAndMiss.statusCode).toBe(200);
    const bodyMiss = resAndMiss.json() as { currentPlacements: unknown[] };
    expect(bodyMiss.currentPlacements).toHaveLength(0);
  });

  it('GET /api/mobile-placement/part-search/suggest AND-filters by machineName (MH/SH machine display)', async () => {
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
          ProductNo: '999880',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'MH001',
          FHINMEI: 'DAD3350MACHINE',
          FSIGENCD: '',
          FKOJUN: ''
        }
      }
    });
    const partRow = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999881',
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
        manufacturingOrderBarcodeRaw: '0000999881',
        branchNo: 1,
        shelfCodeRaw: '東-南-01',
        csvDashboardRowId: partRow.id,
        scheduleSnapshot: {
          ProductNo: '999881',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'FH-PST',
          FHINMEI: 'テーブル脚'
        }
      }
    });

    const ok = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('テーブル')}&machineName=${encodeURIComponent('DAD3350')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(ok.statusCode).toBe(200);
    const bodyOk = ok.json() as { currentPlacements: Array<{ matchedQuery: string }> };
    expect(bodyOk.currentPlacements.length).toBeGreaterThan(0);
    expect(bodyOk.currentPlacements[0].matchedQuery).toContain('テーブル');
    expect(bodyOk.currentPlacements[0].matchedQuery).toContain('DAD3350');

    const miss = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('テーブル')}&machineName=${encodeURIComponent('NOMATCH999')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(miss.statusCode).toBe(200);
    const bodyMiss = miss.json() as { currentPlacements: unknown[] };
    expect(bodyMiss.currentPlacements).toHaveLength(0);
  });

  it('GET /api/mobile-placement/part-search/suggest finds ナットホルダー when q is ナット (sokuon comparable)', async () => {
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
          ProductNo: '999882',
          FSEIBAN: 'PSTESTNUT',
          FHINCD: 'FH-NUT',
          FHINMEI: 'ナットホルダー',
          FSIGENCD: '',
          FKOJUN: ''
        }
      }
    });
    await prisma.orderPlacementBranchState.create({
      data: {
        manufacturingOrderBarcodeRaw: '0000999882',
        branchNo: 1,
        shelfCodeRaw: '東-南-99',
        csvDashboardRowId: row.id,
        scheduleSnapshot: {
          ProductNo: '999882',
          FSEIBAN: 'PSTESTNUT',
          FHINCD: 'FH-NUT',
          FHINMEI: 'ナットホルダー'
        }
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=${encodeURIComponent('ナット')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { currentPlacements: Array<{ displayName: string; shelfCodeRaw: string | null }> };
    expect(body.currentPlacements.length).toBeGreaterThan(0);
    expect(body.currentPlacements[0].displayName).toContain('ナット');
    expect(body.currentPlacements[0].shelfCodeRaw).toBe('東-南-99');
  });

  it('GET /api/mobile-placement/part-search/suggest filters by machineName only when q is empty', async () => {
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
          ProductNo: '999880',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'MH001',
          FHINMEI: 'DAD3350MACHINE',
          FSIGENCD: '',
          FKOJUN: ''
        }
      }
    });
    const partRow = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: {
          ProductNo: '999881',
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
        manufacturingOrderBarcodeRaw: '0000999881',
        branchNo: 1,
        shelfCodeRaw: '東-南-01',
        csvDashboardRowId: partRow.id,
        scheduleSnapshot: {
          ProductNo: '999881',
          FSEIBAN: 'PSTEST01',
          FHINCD: 'FH-PST',
          FHINMEI: 'テーブル脚'
        }
      }
    });

    const ok = await app.inject({
      method: 'GET',
      url: `/api/mobile-placement/part-search/suggest?q=&machineName=${encodeURIComponent('DAD3350')}`,
      headers: { 'x-client-key': clientApiKey }
    });
    expect(ok.statusCode).toBe(200);
    const bodyOk = ok.json() as { currentPlacements: Array<{ matchedQuery: string; displayName: string }> };
    expect(bodyOk.currentPlacements.length).toBeGreaterThan(0);
    expect(bodyOk.currentPlacements[0].matchedQuery).toContain('DAD3350');
    expect(bodyOk.currentPlacements[0].displayName).toContain('脚');
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
  it('verify requires an actual order or fseiban even when parts are omitted', async () => {
    const { apiKey } = await createTestClientDevice();
    const res = await app.inject({ method: 'POST', url: '/api/mobile-placement/verify-slip-match', headers: { 'x-client-key': apiKey }, payload: { transferOrderBarcodeRaw: '1234567890' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates a photo shelf, reads authenticated bytes, updates memo and photo metadata', async () => {
    const { apiKey, id } = await createTestClientDevice();
    const headers = { 'x-client-key': apiKey };
    const path = `/api/mobile-placement/shelves/${encodeURIComponent('西-北-09')}`;
    const created = await app.inject({ method: 'POST', url: '/api/mobile-placement/shelves', headers, payload: { shelfCodeRaw: '西-北-09', displayLabel: '  南 上段  ' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().shelf.displayLabel).toBe('南 上段');
    expect((await app.inject({ method: 'GET', url: `${path}/photo`, headers })).statusCode).toBe(404);
    const uploaded = await app.inject({ method: 'PUT', url: `${path}/photo`, headers, payload: { contentType: 'image/png', dataBase64: MIN_PNG.toString('base64') } });
    expect(uploaded.statusCode).toBe(200);
    const fetched = await app.inject({ method: 'GET', url: `${path}/photo?v=${uploaded.json().photoUpdatedAt}`, headers });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.rawPayload).toEqual(MIN_PNG);
    expect(fetched.headers['content-type']).toBe('image/png');
    expect(fetched.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const patched = await app.inject({ method: 'PATCH', url: path, headers, payload: { displayLabel: '  ロボドリル01  ' } });
    expect(patched.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/api/mobile-placement/registered-shelves', headers });
    expect(listed.json().shelves).toContainEqual(expect.objectContaining({ shelfCodeRaw: '西-北-09', displayLabel: 'ロボドリル01', photoUpdatedAt: uploaded.json().photoUpdatedAt }));
    const shelf = await prisma.mobilePlacementShelf.findUniqueOrThrow({ where: { shelfCodeRaw: '西-北-09' }, include: { photo: true } });
    expect(shelf.photo).toMatchObject({ byteSize: MIN_PNG.length, updatedByClientDeviceId: id });
    expect((await app.inject({ method: 'PATCH', url: path, headers, payload: { displayLabel: null } })).statusCode).toBe(200);
    await prisma.mobilePlacementShelf.delete({ where: { id: shelf.id } });
    expect(await prisma.mobilePlacementShelfPhoto.findUnique({ where: { shelfId: shelf.id } })).toBeNull();
  });

  it('photo JSON accepts 1 MB decoded bytes but rejects excessive size, malformed data and MIME mismatch', async () => {
    const { apiKey } = await createTestClientDevice();
    const headers = { 'x-client-key': apiKey };
    await prisma.mobilePlacementShelf.create({ data: { shelfCodeRaw: '西-北-08' } });
    const url = `/api/mobile-placement/shelves/${encodeURIComponent('西-北-08')}/photo`;
    const bytes = Buffer.alloc(1024 * 1024); MIN_PNG.copy(bytes);
    expect((await app.inject({ method: 'PUT', url, headers, payload: { contentType: 'image/png', dataBase64: bytes.toString('base64') } })).statusCode).toBe(200);
    for (const payload of [
      { contentType: 'image/png', dataBase64: Buffer.alloc(1024 * 1024 + 1).toString('base64') },
      { contentType: 'image/jpeg', dataBase64: MIN_PNG.toString('base64') },
      { contentType: 'image/svg+xml', dataBase64: MIN_PNG.toString('base64') },
      { contentType: 'image/png', dataBase64: '!!!' }
    ]) expect((await app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(400);
  });

  it('photo and memo routes require a client key and reject unknown shelves / long memo', async () => {
    const { apiKey } = await createTestClientDevice();
    const path = '/api/mobile-placement/shelves/MISSING';
    const photo = { contentType: 'image/png', dataBase64: MIN_PNG.toString('base64') };
    for (const request of [
      { method: 'GET' as const, url: `${path}/photo` },
      { method: 'PUT' as const, url: `${path}/photo`, payload: photo },
      { method: 'PATCH' as const, url: path, payload: { displayLabel: null } }
    ]) {
      expect((await app.inject({ ...request, headers: { 'x-client-key': 'invalid-client-key' } })).statusCode).toBe(401);
      expect((await app.inject({ ...request, headers: { 'x-client-key': apiKey } })).statusCode).toBe(404);
    }
    for (const request of [
      { method: 'POST' as const, url: '/api/mobile-placement/shelves', payload: { shelfCodeRaw: '西-北-01', displayLabel: 'a'.repeat(61) } },
      { method: 'PATCH' as const, url: path, payload: { displayLabel: 'a'.repeat(61) } }
    ]) expect((await app.inject({ ...request, headers: { 'x-client-key': apiKey } })).statusCode).toBe(400);
  });

});
