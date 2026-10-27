import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { requireClientDevice } from '../../../routes/kiosk/shared.js';
import { registerMobilePlacementRoutes } from '../../../routes/mobile-placement/index.js';
import * as notices from '../../kiosk-inquiry/system-notice.service.js';
import { listScheduleRowsByProductNo } from '../../production-schedule/production-schedule-lookup.service.js';
import { findPurchaseOrderLookupRows } from '../../purchase-order-lookup/purchase-order-lookup-query.service.js';
import { registerEdgeScan } from '../edge-scan.service.js';
import { registerOrderPlacement } from '../mobile-placement-order-placement.service.js';

const noticeTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(), kioskInquiryThread: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
}));
vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  clientDevice: { findUnique: vi.fn() }, orderPlacementEvent: { findUnique: vi.fn() },
  $transaction: (fn: (tx: typeof noticeTx) => unknown) => fn(noticeTx)
} }));
vi.mock('../../../routes/kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({ listScheduleRowsByProductNo: vi.fn() }));
vi.mock('../../purchase-order-lookup/purchase-order-lookup-query.service.js', () => ({ findPurchaseOrderLookupRows: vi.fn() }));
vi.mock('../mobile-placement-order-placement.service.js', () => ({ registerOrderPlacement: vi.fn() }));

const device = { id: 'device', name: 'zero-shelf-01', location: '組立', haizenEdgeEnabled: true, haizenPresetShelfCodeRaw: ' A-1 ' };
const input = {
  clientDeviceId: 'device', clientRecordId: '00000000-0000-4000-8000-000000000001',
  scannedAt: '2026-10-27T10:00:00+09:00', orderNumber: ' 1234567890 ', branchNo: 0
};
const result = { action: 'created', event: { id: 'event' }, branchState: { branchNo: 0, shelfCodeRaw: 'A-1' } };
const purchase = { seiban: 'S', purchasePartCodeRaw: 'P', purchasePartName: '部品' };
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(device as never);
  vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue(null);
  vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([{ rowId: 'schedule' }] as never);
  vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([]);
  vi.mocked(registerOrderPlacement).mockResolvedValue(result as never);
  vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: 'device' } } as never);
  noticeTx.kioskInquiryThread.findFirst.mockResolvedValue(null);
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ message: error.message, code: (error as ApiError).code });
  });
  await registerMobilePlacementRoutes(app);
});
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

function post(payload: Record<string, unknown> = input) {
  return app.inject({ method: 'POST', url: '/mobile-placement/edge-scans', headers: { 'x-client-key': 'test-key' }, payload });
}

describe('edge scan registration', () => {
  it('authenticates and prefers manufacturing when both lookups could match', async () => {
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase, { ...purchase, seiban: 'OTHER' }] as never);
    const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'created', branchNo: 0, shelfCodeRaw: 'A-1' });
    expect(requireClientDevice).toHaveBeenCalledExactlyOnceWith('test-key');
    expect(listScheduleRowsByProductNo).toHaveBeenCalledExactlyOnceWith('1234567890');
    expect(findPurchaseOrderLookupRows).not.toHaveBeenCalled();
    expect(registerOrderPlacement).toHaveBeenCalledExactlyOnceWith({
      clientDeviceId: 'device', clientRecordId: input.clientRecordId, placedAt: input.scannedAt,
      manufacturingOrderBarcodeRaw: '1234567890', shelfCodeRaw: 'A-1', branchNo: 0, slipKind: 'manufacturing_order'
    });
    expect(noticeTx.kioskInquiryThread.create).not.toHaveBeenCalled();
  });

  it('detects purchase orders and accepts duplicate or empty seiban rows', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase, { ...purchase, seiban: ' S ' }, { ...purchase, seiban: '' }] as never);
    await registerEdgeScan({ ...input, branchNo: 5 });
    expect(findPurchaseOrderLookupRows).toHaveBeenCalledExactlyOnceWith('1234567890');
    expect(registerOrderPlacement).toHaveBeenCalledWith(expect.objectContaining({ slipKind: 'purchase_order', branchNo: 5 }));
  });

  it.each(['created', 'moved', 'unchanged', 'stale'])('returns %s and the current shelf from placement', async (action) => {
    vi.mocked(registerOrderPlacement).mockResolvedValue({ ...result, action, branchState: { branchNo: 2, shelfCodeRaw: 'B-2' } } as never);
    const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: action, branchNo: 2, shelfCodeRaw: 'B-2' });
  });

  it('resends the same clientRecordId through placement replay even after lookup data disappears', async () => {
    const first = await post();
    vi.mocked(prisma.orderPlacementEvent.findUnique).mockResolvedValue({ id: 'event' } as never);
    vi.mocked(listScheduleRowsByProductNo).mockRejectedValue(new Error('lookup unavailable'));
    const replay = await post();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(listScheduleRowsByProductNo).toHaveBeenCalledOnce();
    expect(prisma.orderPlacementEvent.findUnique).toHaveBeenCalledWith({ where: { clientRecordId: input.clientRecordId } });
    expect(registerOrderPlacement).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['shelf', 'EDGE_SHELF_NOT_ASSIGNED', '棚スキャナに棚が割り当てられていません。'],
    ['missing', 'EDGE_ORDER_NOT_FOUND', '読み取った番号が製造予定にも購買データにもありません。'],
    ['ambiguous', 'EDGE_ORDER_AMBIGUOUS', '読み取った注文番号に複数の製番があるため配膳を記録できません。']
  ])('returns 422 for %s and delivers one Chat notice per failure key', async (kind, code, body) => {
    if (kind === 'shelf') vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ ...device, haizenPresetShelfCodeRaw: ' ' } as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    if (kind === 'ambiguous') vi.mocked(findPurchaseOrderLookupRows).mockResolvedValue([purchase, { ...purchase, seiban: 'OTHER' }] as never);
    const deliver = vi.spyOn(notices, 'deliverSystemNotice');
    noticeTx.kioskInquiryThread.findFirst.mockResolvedValueOnce(null).mockResolvedValue({
      id: 'notice', noticeTitle: '組立 棚スキャナ', messages: [{ createdAt: new Date() }]
    });
    for (const orderNumber of ['1234567890', '9876543210']) {
      const response = await post({ ...input, orderNumber });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ code, message: body });
    }
    const key = JSON.stringify(['edge_scan', device.id, code]);
    expect(deliver).toHaveBeenCalledTimes(2);
    const noticeBody = (orderNumber: string) => kind === 'shelf' ? body : `${body}（${orderNumber}）`;
    expect(deliver).toHaveBeenNthCalledWith(1, { key, title: '組立 棚スキャナ', body: noticeBody('1234567890'), state: 'open' });
    expect(deliver).toHaveBeenNthCalledWith(2, { key, title: '組立 棚スキャナ', body: noticeBody('9876543210'), state: 'open' });
    expect(noticeTx.kioskInquiryThread.create).toHaveBeenCalledOnce();
    expect(noticeTx.kioskInquiryThread.update).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it('separates keys by device and failure kind, using the name when location is blank', async () => {
    const deliver = vi.spyOn(notices, 'deliverSystemNotice');
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    await post();
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ ...device, haizenPresetShelfCodeRaw: null } as never);
    await post();
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ ...device, id: 'other', location: ' ' } as never);
    await registerEdgeScan({ ...input, clientDeviceId: 'other' }).catch(() => undefined);
    const keys = deliver.mock.calls.map(([notice]) => notice.key);
    expect(new Set(keys).size).toBe(3);
    expect(deliver.mock.calls[2][0].title).toBe('zero-shelf-01 棚スキャナ');
    expect(noticeTx.kioskInquiryThread.create).toHaveBeenCalledTimes(3);
  });

  it('rejects a disabled device without sending a notice', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ ...device, haizenEdgeEnabled: false } as never);
    const response = await post();
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('EDGE_DEVICE_NOT_ENABLED');
    expect(noticeTx.kioskInquiryThread.create).not.toHaveBeenCalled();
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it.each(['', '123456789', '12345678901', '123456789A', '１２３４５６７８９０', '12345 67890'])('rejects a non-10-digit number (%s) as a permanent failure', async (orderNumber) => {
    const response = await post({ ...input, orderNumber });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'EDGE_ORDER_NOT_FOUND', message: '番号は前後の空白を除いて10桁の数字で読み取ってください。' });
    expect(listScheduleRowsByProductNo).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    expect(noticeTx.kioskInquiryThread.create).toHaveBeenCalledOnce();
  });

  it.each([
    [404, 'ORDER_PLACEMENT_SCHEDULE_NOT_FOUND', 'EDGE_ORDER_NOT_FOUND'],
    [404, 'ORDER_PLACEMENT_PURCHASE_ORDER_NOT_FOUND', 'EDGE_ORDER_NOT_FOUND'],
    [409, 'ORDER_PLACEMENT_PURCHASE_ORDER_AMBIGUOUS', 'EDGE_ORDER_AMBIGUOUS']
  ])('maps placement error %s/%s to %s', async (status, originalCode, code) => {
    vi.mocked(registerOrderPlacement).mockRejectedValue(new ApiError(status, 'lookup changed', undefined, originalCode));
    const response = await post();
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe(code);
    expect(noticeTx.kioskInquiryThread.create).toHaveBeenCalledOnce();
  });

  it('logs notice delivery failures without changing the HTTP failure', async () => {
    const error = new Error('notice database unavailable');
    noticeTx.kioskInquiryThread.findFirst.mockRejectedValue(error);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([]);
    const response = await post();
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('EDGE_ORDER_NOT_FOUND');
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ err: error, key: JSON.stringify(['edge_scan', device.id, 'EDGE_ORDER_NOT_FOUND']) }, 'Failed to deliver edge scan system notice');
  });

  it('leaves transient placement failures as 5xx without a permanent notice', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValue(new ApiError(503, 'database unavailable'));
    const response = await post();
    expect(response.statusCode).toBe(503);
    expect(noticeTx.kioskInquiryThread.create).not.toHaveBeenCalled();
  });

  it('authenticates before accessing data', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    const response = await post();
    expect(response.statusCode).toBe(401);
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });

  it.each([
    { clientRecordId: 'invalid' }, { scannedAt: '2026-10-27T10:00:00' }, { scannedAt: 'invalid' },
    { branchNo: -1 }, { branchNo: 6 }, { branchNo: 0.5 }, { branchNo: '1' }, { branchNo: undefined },
    { orderNumber: 1234567890 }
  ])('validates the zod request body (%j)', async (invalid) => {
    const response = await post({ ...input, ...invalid });
    expect(response.statusCode).toBe(400);
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
    expect(registerOrderPlacement).not.toHaveBeenCalled();
  });
});
