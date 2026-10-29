import { describe, expect, it, vi } from 'vitest';
import { ItemInventoryService } from '../item-inventory.service.js';

const location = (area: string) => ({ drawer: { shelf: { area } } });
const items = [
  { id: 'machine', area: '生産技術課', maker: '共通', compartments: [location('機械課 北')] },
  { id: 'seigi', area: '機械課', maker: '共通', compartments: [location('生産技術課 西')] },
  { id: 'mixed', area: null, maker: '共通', compartments: [location('生産技術課 北'), location('組立課 南')] },
  { id: 'unplaced', area: '生産技術課', maker: '共通', compartments: [] },
];
function fixture() {
  const rows = structuredClone(items);
  const presets = [{ scope: 'default', field: 'maker', value: '標準専用' }, { scope: 'seigi', field: 'maker', value: '生技専用' }];
  const db = {
    inventoryItem: {
      findMany: vi.fn(async (args: any) => {
        if (args.select.id) return rows;
        const field = Object.keys(args.select)[0];
        const ids = args.where.AND[0].id.in;
        return rows.filter(row => ids.includes(row.id)).map(row => ({ [field]: row[field as 'maker'] ?? null }));
      }),
      groupBy: vi.fn(async (args: any) => {
        const field = args.by[0];
        const count = rows.filter(row => args.where.AND[0].id.in.includes(row.id)).length;
        return field === 'maker' ? [{ maker: '共通', _count: { _all: count } }] : [];
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows) if (where.id.in.includes(row.id) && row.maker === where.maker) { row.maker = data.maker; count++; }
        return { count };
      }),
      count: vi.fn(async ({ where }: any) => rows.filter(row => where.id.in.includes(row.id) && row.maker === where.maker).length),
    },
    inventoryToolFieldPreset: {
      findMany: vi.fn(async ({ where }: any) => presets.filter(row => row.scope === where.scope)),
      upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryToolValueDistinct: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(work => work(db));
  return { rows, db, service: new ItemInventoryService(db as never) };
}

describe('inventory tool choices scoped by first displayed placement', () => {
  it.each(['default', 'seigi'] as const)('isolates options, counts and presets for %s', async scope => {
    const { service, db } = fixture();
    const ownPreset = scope === 'seigi' ? '生技専用' : '標準専用';
    const otherPreset = scope === 'seigi' ? '標準専用' : '生技専用';
    const options = await service.listToolFieldOptions(scope);
    expect(options.maker).toEqual(expect.arrayContaining(['共通', ownPreset]));
    expect(options.maker).not.toContain(otherPreset);
    const values = await service.listToolFieldValues(scope);
    expect(values.maker).toEqual(expect.arrayContaining([{ value: '共通', count: 2 }, { value: ownPreset, count: 0 }]));
    const ids = scope === 'seigi' ? ['seigi', 'mixed'] : ['machine', 'unplaced'];
    expect(db.inventoryItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ deletedAt: null, id: { in: ids } }, { deletedAt: null, maker: { not: null } }] } }));
    expect(db.inventoryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, compartments: expect.objectContaining({ take: 1, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) } }));
  });

  it.each(['default', 'seigi'] as const)('renames and merges only %s items and presets', async scope => {
    const { service, rows, db } = fixture();
    expect(await service.mergeToolValueVariants('maker', '修正', ['共通', '共通'], scope)).toEqual({ updatedItems: 2 });
    expect(rows.filter(row => row.maker === '修正').map(row => row.id)).toEqual(scope === 'seigi' ? ['seigi', 'mixed'] : ['machine', 'unplaced']);
    expect(db.inventoryToolFieldPreset.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { scope, field: 'maker', value: '共通' } });
    expect(db.inventoryToolFieldPreset.upsert).toHaveBeenCalledWith({ where: { scope_field_value: { scope, field: 'maker', value: '修正' } }, create: { scope, field: 'maker', value: '修正' }, update: {} });
  });

  it('checks usage only inside the requested scope and defaults omitted scope', async () => {
    const { service, db } = fixture();
    await service.renameToolFieldValue('maker', '共通', '生技の値', 'seigi');
    await expect(service.deleteToolFieldValue('maker', '生技の値')).resolves.toEqual({ field: 'maker', value: '生技の値' });
    await expect(service.deleteToolFieldValue('maker', '生技の値', 'seigi')).rejects.toThrow('2件');
    await service.addToolFieldValue('maker', '追加', 'seigi');
    expect(db.inventoryToolFieldPreset.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { scope: 'seigi', field: 'maker', value: '追加' } }));
    await service.toolValueVariants('seigi');
    expect(db.inventoryToolFieldPreset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: 'seigi' } }));
    expect(db.inventoryToolValueDistinct.findMany).toHaveBeenCalledWith({ select: { field: true, valueA: true, valueB: true } });
  });
});

describe('import message dismissal', () => {
  it('preserves the record and outcome, hides it and restores it', async () => {
    const record = { id: 'message', outcome: 'RETRYABLE', dismissedAt: null as Date | null };
    const db = { inventoryImportMessage: {
      findUnique: vi.fn().mockResolvedValue(record),
      update: vi.fn(async ({ data }: any) => Object.assign(record, data)),
      findMany: vi.fn(async ({ where }: any) => record.dismissedAt === where.dismissedAt ? [record] : []),
    } };
    const service = new ItemInventoryService(db as never);
    await service.setImportMessageDismissed('message', true);
    expect(record.dismissedAt).toBeInstanceOf(Date);
    expect(record.outcome).toBe('RETRYABLE');
    expect(await service.listImportMessages()).toEqual([]);
    await service.setImportMessageDismissed('message', false);
    expect(await service.listImportMessages()).toEqual([record]);
    db.inventoryImportMessage.findUnique.mockResolvedValue(null);
    await expect(service.setImportMessageDismissed('missing', true)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('replacement tag usage', () => {
  it('keeps the existing conflict message and adds the actual usage location', async () => {
    const tx = {
      inventoryCompartment: { findUnique: vi.fn().mockResolvedValue({ id: 'target', itemTag: null }) },
      employee: { findFirst: vi.fn() }, item: { findFirst: vi.fn() }, measuringInstrumentTag: { findFirst: vi.fn() }, riggingGearTag: { findFirst: vi.fn() },
      inventoryNfcTag: { findUnique: vi.fn().mockResolvedValue({ compartmentId: 'other', compartment: { inventoryItem: { name: 'ドリル' }, drawer: { drawerNumber: 3, shelf: { area: '生産技術課 北', shelfNumber: 2 } } } }), update: vi.fn() },
    };
    const service = new ItemInventoryService({ $transaction: (work: any) => work(tx) } as never);
    await expect(service.replaceItemTag('target', 'used', {})).rejects.toMatchObject({ statusCode: 409, message: 'このUIDは既に使用されています', details: { usedBy: { itemName: 'ドリル', area: '生産技術課 北', shelfNumber: 2, drawerNumber: 3 } } });
    expect(tx.inventoryNfcTag.update).not.toHaveBeenCalled();
  });

  it('detaches the old tag and records both UIDs on success', async () => {
    const tx = {
      inventoryCompartment: { findUnique: vi.fn().mockResolvedValue({ id: 'target', inventoryItemId: 'item', stockQuantity: 3, itemTag: { id: 'old', uid: 'old-uid' } }) },
      employee: { findFirst: vi.fn() }, item: { findFirst: vi.fn() }, measuringInstrumentTag: { findFirst: vi.fn() }, riggingGearTag: { findFirst: vi.fn() },
      inventoryNfcTag: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn().mockResolvedValue({ uid: 'new-uid' }) },
      inventoryTransaction: { create: vi.fn() },
    };
    const service = new ItemInventoryService({ $transaction: (work: any) => work(tx) } as never);
    await service.replaceItemTag('target', 'new-uid', {});
    expect(tx.inventoryNfcTag.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'old' }, data: { compartmentId: null } });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: { previousUid: 'old-uid', uid: 'new-uid' } }) }));
  });
});
