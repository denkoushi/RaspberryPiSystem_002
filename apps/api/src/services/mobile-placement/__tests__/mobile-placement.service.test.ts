import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { findProductionSchedulePlacementBarcodeSnapshot } from '../../production-schedule/production-schedule-snapshot.service.js';
import { registerPlacement, resolveItemByBarcode } from '../mobile-placement.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  item: { findFirst: vi.fn() },
  clientDevice: { findUnique: vi.fn() },
  $transaction: vi.fn(),
} }));
vi.mock('../../production-schedule/production-schedule-snapshot.service.js', () => ({
  findProductionSchedulePlacementBarcodeSnapshot: vi.fn(),
}));

const tx = {
  mobilePlacementEvent: { create: vi.fn() },
  item: { update: vi.fn() },
};
const tool = { id: 'item-1', itemCode: 'TL-001', name: 'ドリル', storageLocation: 'OLD-SHELF' };

describe('mobile placement registration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'dev-1' } as never);
    vi.mocked(prisma.item.findFirst).mockResolvedValue(tool as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (work: (t: typeof tx) => Promise<unknown>) => work(tx)) as never);
    tx.mobilePlacementEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ev-1', ...data }));
    tx.item.update.mockImplementation(async ({ data }: { data: { storageLocation: string } }) => ({ ...tool, ...data }));
  });

  it('resolveItemByBarcode trims full-width spaces, matches itemCode case-insensitively and skips blank scans', async () => {
    await expect(resolveItemByBarcode('　tl-001　')).resolves.toEqual({ item: tool, matchKind: 'itemCode' });
    expect(prisma.item.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemCode: { equals: 'tl-001', mode: 'insensitive' } },
    }));
    vi.mocked(prisma.item.findFirst).mockClear();
    await expect(resolveItemByBarcode('  　 ')).resolves.toEqual({ item: null, matchKind: 'none' });
    expect(prisma.item.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    [{ shelfCodeRaw: '  ' }, '棚番（スキャン値）が空です'],
    [{ itemBarcodeRaw: '　' }, 'アイテムのバーコードが空です'],
  ])('rejects blank scans with 400 before any lookup (%o)', async (override, message) => {
    await expect(registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A-01', itemBarcodeRaw: 'TL-001', ...override }))
      .rejects.toMatchObject({ statusCode: 400, message });
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown device with 400', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);
    await expect(registerPlacement({ clientDeviceId: 'ghost', shelfCodeRaw: 'A-01', itemBarcodeRaw: 'TL-001' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'クライアント端末が不正です' });
  });

  it('returns 404 MOBILE_PLACEMENT_ITEM_NOT_FOUND without writing when the tool is unknown', async () => {
    vi.mocked(prisma.item.findFirst).mockResolvedValue(null);
    await expect(registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A-01', itemBarcodeRaw: 'NOPE' }))
      .rejects.toMatchObject({ statusCode: 404, code: 'MOBILE_PLACEMENT_ITEM_NOT_FOUND' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('moves the tool to the scanned shelf and records previous/new locations', async () => {
    const result = await registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: ' B-02 ', itemBarcodeRaw: ' TL-001 ', csvDashboardRowId: '  ' });
    expect(tx.mobilePlacementEvent.create).toHaveBeenCalledWith({ data: {
      clientDeviceId: 'dev-1',
      shelfCodeRaw: 'B-02',
      itemBarcodeRaw: 'TL-001',
      itemId: 'item-1',
      csvDashboardRowId: null,
      previousStorageLocation: 'OLD-SHELF',
      newStorageLocation: 'B-02',
    } });
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' }, data: { storageLocation: 'B-02' } }));
    expect(result.item.storageLocation).toBe('B-02');
    expect(result.resolveMatchKind).toBe('itemCode');
    expect(findProductionSchedulePlacementBarcodeSnapshot).not.toHaveBeenCalled();
  });

  it('stores the shelf with full-width spaces converted to half-width', async () => {
    await registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A　01', itemBarcodeRaw: 'TL-001' });
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ data: { storageLocation: 'A 01' } }));
  });

  it('returns 404 when the selected schedule row does not exist', async () => {
    vi.mocked(findProductionSchedulePlacementBarcodeSnapshot).mockResolvedValue(null);
    await expect(registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A', itemBarcodeRaw: 'TL-001', csvDashboardRowId: ' row-1 ' }))
      .rejects.toMatchObject({ statusCode: 404, message: '指定のスケジュール行が見つかりません' });
    expect(findProductionSchedulePlacementBarcodeSnapshot).toHaveBeenCalledWith('row-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a scan that matches neither the schedule row values nor the tool code', async () => {
    vi.mocked(findProductionSchedulePlacementBarcodeSnapshot).mockResolvedValue({
      barcodeMatchValues: ['0001234567', 'SEIBAN1', 'PART-9'], manufacturingOrderNo: '0001234567', seiban: 'SEIBAN1', partCode: 'PART-9', partName: '部品',
    } as never);
    await expect(registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A', itemBarcodeRaw: 'TL-001', csvDashboardRowId: 'row-1' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'MOBILE_PLACEMENT_SCHEDULE_MISMATCH' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  const scheduleRow = {
    barcodeMatchValues: ['0001234567', 'SEIBAN1', 'PART-9'], manufacturingOrderNo: '0001234567', seiban: 'SEIBAN1', partCode: 'PART-9', partName: '部品',
  };

  it('accepts a lower-case scan that matches a schedule value even though the tool code does not, and stores the snapshot', async () => {
    // tool.itemCode is TL-001 (not in barcodeMatchValues): only the scan path can make this pass.
    vi.mocked(findProductionSchedulePlacementBarcodeSnapshot).mockResolvedValue(scheduleRow as never);
    await registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A', itemBarcodeRaw: ' seiban1 ', csvDashboardRowId: 'row-1' });
    expect(tx.mobilePlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      itemId: 'item-1',
      itemBarcodeRaw: 'seiban1',
      csvDashboardRowId: 'row-1',
      scheduleSnapshot: { ProductNo: '0001234567', FSEIBAN: 'SEIBAN1', FHINCD: 'PART-9', FHINMEI: '部品' },
    }) });
  });

  it('accepts a scan that does not match the schedule when the resolved tool code matches a schedule value (trimmed, case-insensitive)', async () => {
    vi.mocked(prisma.item.findFirst).mockResolvedValue({ ...tool, itemCode: ' part-9 ' } as never);
    vi.mocked(findProductionSchedulePlacementBarcodeSnapshot).mockResolvedValue(scheduleRow as never);
    await registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A', itemBarcodeRaw: 'ALIAS-77', csvDashboardRowId: 'row-1' });
    expect(tx.mobilePlacementEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      itemBarcodeRaw: 'ALIAS-77',
      scheduleSnapshot: { ProductNo: '0001234567', FSEIBAN: 'SEIBAN1', FHINCD: 'PART-9', FHINMEI: '部品' },
    }) });
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ data: { storageLocation: 'A' } }));
  });

  it('rejects when neither the lower-case scan nor the tool code matches (near-miss values)', async () => {
    vi.mocked(prisma.item.findFirst).mockResolvedValue({ ...tool, itemCode: 'part-90' } as never);
    vi.mocked(findProductionSchedulePlacementBarcodeSnapshot).mockResolvedValue(scheduleRow as never);
    await expect(registerPlacement({ clientDeviceId: 'dev-1', shelfCodeRaw: 'A', itemBarcodeRaw: 'seiban12', csvDashboardRowId: 'row-1' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'MOBILE_PLACEMENT_SCHEDULE_MISMATCH' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
