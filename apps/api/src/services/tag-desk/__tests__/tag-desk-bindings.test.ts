import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTagUid, TagDeskService } from '../tag-desk.service.js';

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  employee: { findUnique: vi.fn(), update: vi.fn() },
  item: { findUnique: vi.fn(), update: vi.fn() },
  measuringInstrument: { findUnique: vi.fn() },
  riggingGear: { findUnique: vi.fn() },
  measuringInstrumentTag: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  riggingGearTag: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  machineNfcTag: { findUnique: vi.fn(), delete: vi.fn() },
  inventoryNfcTag: { findUnique: vi.fn(), delete: vi.fn() },
  nfcTagBindingEvent: { create: vi.fn(), findMany: vi.fn() },
  loan: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: db }));

const service = new TagDeskService();
const events = () => db.nfcTagBindingEvent.create.mock.calls.map(([arg]) => arg.data);

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  for (const model of [db.employee, db.item, db.measuringInstrumentTag, db.riggingGearTag, db.machineNfcTag, db.inventoryNfcTag]) {
    model.findUnique.mockResolvedValue(null);
  }
  db.loan.findMany.mockResolvedValue([]);
  db.loan.count.mockResolvedValue(0);
});

describe('normalizeTagUid', () => {
  it('trims reader noise but keeps case and inner characters', () => {
    expect(normalizeTagUid('  04:aB:12\r\n')).toBe('04:aB:12');
  });
});

describe('TagDeskService.link', () => {
  it('rejects a UID shorter than 4 characters after trimming, without opening a transaction', async () => {
    await expect(service.link({ kind: 'item', targetId: 'i', uid: '  abc  ', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 400,
      code: 'TAG_UID_INVALID',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a tag already bound to an employee and names where it is used', async () => {
    db.employee.findUnique.mockImplementation(async ({ where }: { where: { nfcTagUid?: string } }) =>
      where.nfcTagUid === 'TAG01' ? { displayName: '山田' } : null);
    await expect(service.link({ kind: 'item', targetId: 'i', uid: ' TAG01 ', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 409,
      code: 'TAG_IN_USE',
      details: { usedBy: '山田' },
      message: 'このタグは「山田」で使われています。先に外してください',
    });
    expect(db.item.update).not.toHaveBeenCalled();
    expect(db.nfcTagBindingEvent.create).not.toHaveBeenCalled();
  });

  it('labels inventory tags by their kind when reporting usage', async () => {
    db.inventoryNfcTag.findUnique.mockResolvedValue({ kind: 'RESTOCK' });
    await expect(service.findUsage(db as never, 'TAG01')).resolves.toBe('補充タグ');
  });

  it('returns 404 TARGET_NOT_FOUND for a missing employee', async () => {
    await expect(service.link({ kind: 'employee', targetId: 'e', uid: 'TAG01', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 404,
      code: 'TARGET_NOT_FOUND',
      message: '社員が見つかりません',
    });
  });

  it('binds a free tag to an employee, records LINK with the trimmed UID and returns the resolved binding', async () => {
    db.employee.findUnique.mockImplementation(async ({ where }: { where: { id?: string; nfcTagUid?: string } }) => {
      if (where.id === 'e') return { id: 'e', displayName: '山田', nfcTagUid: null };
      return null;
    });
    await service.link({ kind: 'employee', targetId: 'e', uid: ' TAG01 ', clientDeviceId: 'kiosk-1' });
    expect(db.employee.update).toHaveBeenCalledWith({ where: { id: 'e' }, data: { nfcTagUid: 'TAG01' } });
    expect(events()).toEqual([
      { uid: 'TAG01', action: 'LINK', targetKind: 'employee', targetId: 'e', targetLabel: '山田', clientDeviceId: 'kiosk-1' },
    ]);
  });

  it('refuses to overwrite an existing employee tag unless replace is set', async () => {
    db.employee.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === 'e' ? { id: 'e', displayName: '山田', nfcTagUid: 'OLD01' } : null);
    await expect(service.link({ kind: 'employee', targetId: 'e', uid: 'NEW01', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 409,
      code: 'TARGET_HAS_TAG',
      message: '山田 には別のタグが付いています',
    });
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  it('with replace, records UNLINK of the old item tag before LINK of the new one', async () => {
    db.item.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === 'i' ? { id: 'i', name: 'スパナ', nfcTagUid: 'OLD01' } : null);
    await service.link({ kind: 'item', targetId: 'i', uid: 'NEW01', replace: true, clientDeviceId: 'kiosk-1' });
    expect(db.item.update).toHaveBeenCalledWith({ where: { id: 'i' }, data: { nfcTagUid: 'NEW01' } });
    expect(events()).toEqual([
      { uid: 'OLD01', action: 'UNLINK', targetKind: 'item', targetId: 'i', targetLabel: 'スパナ', clientDeviceId: 'kiosk-1' },
      { uid: 'NEW01', action: 'LINK', targetKind: 'item', targetId: 'i', targetLabel: 'スパナ', clientDeviceId: 'kiosk-1' },
    ]);
  });

  it('adds an extra tag to an instrument (multi-tag assets) without the replace flag', async () => {
    db.measuringInstrument.findUnique.mockResolvedValue({ id: 'm', name: 'ノギス' });
    await service.link({ kind: 'instrument', targetId: 'm', uid: 'RFID01', clientDeviceId: null });
    expect(db.measuringInstrumentTag.create).toHaveBeenCalledWith({ data: { measuringInstrumentId: 'm', rfidTagUid: 'RFID01' } });
    expect(events()).toEqual([expect.objectContaining({ action: 'LINK', targetKind: 'instrument', targetLabel: 'ノギス' })]);
  });

  it('returns 404 for a missing rigging gear', async () => {
    await expect(service.link({ kind: 'rigging', targetId: 'r', uid: 'RFID01', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 404,
      message: '吊具が見つかりません',
    });
  });

  it('maps a unique-constraint race from another terminal to TAG_IN_USE', async () => {
    db.riggingGear.findUnique.mockResolvedValue({ id: 'r', name: 'スリング' });
    db.riggingGearTag.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.link({ kind: 'rigging', targetId: 'r', uid: 'RFID01', clientDeviceId: null })).rejects.toMatchObject({
      statusCode: 409,
      code: 'TAG_IN_USE',
      message: 'このタグは別の場所で使われています。先に外してください',
    });
  });
});

describe('TagDeskService.unlink', () => {
  it.each(['employee', 'item', 'instrument', 'rigging', 'machine', 'inventory'] as const)(
    'reports BINDING_NOT_FOUND for an already removed %s binding',
    async (kind) => {
      await expect(service.unlink({ kind, bindingId: 'b', clientDeviceId: null })).rejects.toMatchObject({
        statusCode: 404,
        code: 'BINDING_NOT_FOUND',
      });
      expect(db.nfcTagBindingEvent.create).not.toHaveBeenCalled();
    },
  );

  it('treats an employee without a tag as already unlinked', async () => {
    db.employee.findUnique.mockResolvedValue({ id: 'e', displayName: '山田', nfcTagUid: null });
    await expect(service.unlink({ kind: 'employee', bindingId: 'e', clientDeviceId: null })).rejects.toMatchObject({ code: 'BINDING_NOT_FOUND' });
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  it('clears an employee tag and records the removed UID', async () => {
    db.employee.findUnique.mockResolvedValue({ id: 'e', displayName: '山田', nfcTagUid: 'TAG01' });
    await service.unlink({ kind: 'employee', bindingId: 'e', clientDeviceId: 'kiosk-1' });
    expect(db.employee.update).toHaveBeenCalledWith({ where: { id: 'e' }, data: { nfcTagUid: null } });
    expect(events()).toEqual([
      { uid: 'TAG01', action: 'UNLINK', targetKind: 'employee', targetId: 'e', targetLabel: '山田', clientDeviceId: 'kiosk-1' },
    ]);
  });

  it('deletes an inventory tag and falls back to the kind label when no compartment item exists', async () => {
    db.inventoryNfcTag.findUnique.mockResolvedValue({ id: 't', uid: 'INV01', kind: 'QUANTITY', compartmentId: null, compartment: null });
    await service.unlink({ kind: 'inventory', bindingId: 't', clientDeviceId: null });
    expect(db.inventoryNfcTag.delete).toHaveBeenCalledWith({ where: { id: 't' } });
    expect(events()).toEqual([
      { uid: 'INV01', action: 'UNLINK', targetKind: 'inventory', targetId: null, targetLabel: '数量タグ', clientDeviceId: null },
    ]);
  });
});

describe('TagDeskService.resolve', () => {
  it('returns no bindings for a blank UID without querying', async () => {
    await expect(service.resolve('   ')).resolves.toEqual([]);
    expect(db.employee.findUnique).not.toHaveBeenCalled();
  });

  it('builds the recent-use history newest first, skipping cancelled loans and keeping three entries', async () => {
    db.item.findUnique.mockResolvedValue({ id: 'i', itemCode: 'T001', name: 'スパナ', storageLocation: '棚A', status: 'IN_USE' });
    db.loan.count.mockResolvedValue(1);
    db.loan.findMany.mockResolvedValue([
      { borrowedAt: new Date('2026-11-03T09:00:00Z'), returnedAt: null, cancelledAt: null, employee: { displayName: '山田' } },
      { borrowedAt: new Date('2026-11-02T09:00:00Z'), returnedAt: null, cancelledAt: new Date('2026-11-02T09:01:00Z'), employee: { displayName: '誤読' } },
      { borrowedAt: new Date('2026-11-01T09:00:00Z'), returnedAt: new Date('2026-11-01T17:00:00Z'), cancelledAt: null, employee: { displayName: '佐藤' } },
      { borrowedAt: new Date('2026-10-30T09:00:00Z'), returnedAt: new Date('2026-10-30T12:00:00Z'), cancelledAt: null, employee: null },
    ]);
    const [binding] = await service.resolve('TAG01');
    expect(binding).toMatchObject({ kind: 'item', bindingId: 'i', targetId: 'i', code: 'T001', activeLoans: 1 });
    expect(binding.recent).toEqual([
      { at: '2026-11-03T09:00:00.000Z', action: 'BORROW', label: '山田' },
      { at: '2026-11-01T17:00:00.000Z', action: 'RETURN', label: '佐藤' },
      { at: '2026-11-01T09:00:00.000Z', action: 'BORROW', label: '佐藤' },
    ]);
    expect(db.loan.count).toHaveBeenCalledWith({ where: { itemId: 'i', returnedAt: null, cancelledAt: null } });
  });

  it('labels employee history by asset, falling back to 写真持出 for photo loans', async () => {
    db.employee.findUnique.mockResolvedValue({ id: 'e', employeeCode: '0001', displayName: '山田', department: '製造', section: '', status: 'ACTIVE' });
    db.loan.findMany.mockResolvedValue([
      { borrowedAt: new Date('2026-11-03T09:00:00Z'), returnedAt: null, cancelledAt: null, item: null, measuringInstrument: null, riggingGear: null },
      { borrowedAt: new Date('2026-11-02T09:00:00Z'), returnedAt: null, cancelledAt: null, item: null, measuringInstrument: { name: 'ノギス' }, riggingGear: null },
    ]);
    const [binding] = await service.resolve('TAG01');
    expect(binding).toMatchObject({ kind: 'employee', sub: '製造', sub2: null });
    expect(binding.recent.map((use) => use.label)).toEqual(['写真持出', 'ノギス']);
  });

  it('reports every domain a duplicated UID is bound to, in a fixed order', async () => {
    db.employee.findUnique.mockResolvedValue({ id: 'e', employeeCode: '0001', displayName: '山田', department: null, section: null, status: 'ACTIVE' });
    db.inventoryNfcTag.findUnique.mockResolvedValue({
      id: 'inv', kind: 'QUANTITY', quantity: 5, compartmentId: 'c',
      compartment: { inventoryItem: { name: 'ボルト' }, drawerNumber: 2, drawer: { drawerNumber: 2, shelf: { area: 'A', shelfNumber: 3 } } },
    });
    db.machineNfcTag.findUnique.mockResolvedValue({ id: 'mt', machine: { id: 'm', name: '旋盤', equipmentManagementNumber: 'EQ-1' } });
    const bindings = await service.resolve('TAG01');
    expect(bindings.map((b) => b.kind)).toEqual(['employee', 'inventory', 'machine']);
    expect(bindings[1]).toMatchObject({ code: '数量タグ', name: '数量タグ 5', sub: 'A 棚3-2', targetId: 'c', activeLoans: 0 });
    expect(bindings[2]).toMatchObject({ code: 'EQ-1', name: '加工機 旋盤', targetId: 'm' });
  });
});

describe('TagDeskService.listEvents', () => {
  it('returns the newest binding events with ISO timestamps', async () => {
    db.nfcTagBindingEvent.findMany.mockResolvedValue([
      { id: '1', uid: 'TAG01', action: 'LINK', targetKind: 'item', targetLabel: 'スパナ', createdAt: new Date('2026-11-03T09:00:00Z'), clientDeviceId: 'x' },
    ]);
    await expect(service.listEvents(5)).resolves.toEqual([
      { id: '1', uid: 'TAG01', action: 'LINK', targetKind: 'item', targetLabel: 'スパナ', createdAt: '2026-11-03T09:00:00.000Z' },
    ]);
    expect(db.nfcTagBindingEvent.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 5 });
  });
});
