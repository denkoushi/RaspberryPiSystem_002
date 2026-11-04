import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { CsvImportConfigService } from '../csv-import-config.service.js';
import { RiggingGearCsvImporter } from '../importers/rigging-gear.js';

const mocks = vi.hoisted(() => ({
  riggingGear: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  riggingGearTag: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  loan: { findMany: vi.fn() },
  riggingInspectionRecord: { findMany: vi.fn() },
  machineNfcTag: { findUnique: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => {
  const tx = { riggingGear: mocks.riggingGear, riggingGearTag: mocks.riggingGearTag, machineNfcTag: mocks.machineNfcTag };
  return {
    prisma: {
      riggingGear: mocks.riggingGear,
      loan: mocks.loan,
      riggingInspectionRecord: mocks.riggingInspectionRecord,
      $transaction: async (run: (client: unknown) => unknown) => run(tx),
    },
  };
});

const config = { getEffectiveConfig: vi.fn() };
const importer = () => new RiggingGearCsvImporter(config as unknown as CsvImportConfigService);
const csv = (text: string) => Buffer.from(text, 'utf-8');
const HEADER = 'name,managementNumber,idNum,usableYears,maxLoadTon,lengthMm,widthMm,thicknessMm,startedAt,status';

describe('RiggingGearCsvImporter.parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.getEffectiveConfig.mockResolvedValue(null);
  });

  it('converts numeric and date columns', async () => {
    const [row] = await importer().parse(csv(`${HEADER}\nスリング,RG-001,ID-9,5,2.5,1500,50,6,2024-04-01,in_use\n`));
    expect(row).toMatchObject({
      name: 'スリング',
      managementNumber: 'RG-001',
      idNum: 'ID-9',
      usableYears: 5,
      maxLoadTon: 2.5,
      lengthMm: 1500,
      widthMm: 50,
      thicknessMm: 6,
      startedAt: new Date('2024-04-01T00:00:00.000Z'),
      status: 'IN_USE',
    });
  });

  it('turns blank numeric/date/idNum cells into null and status into AVAILABLE', async () => {
    const [row] = await importer().parse(csv(`${HEADER}\nスリング,RG-001,,,,,,,,\n`));
    expect(row).toMatchObject({
      idNum: null, usableYears: null, maxLoadTon: null, lengthMm: null, widthMm: null, thicknessMm: null, startedAt: null, status: 'AVAILABLE',
    });
  });

  it('silently drops full-width digits to null rather than rejecting the row', async () => {
    const [row] = await importer().parse(csv(`${HEADER}\nスリング,RG-001,,５,２.５,１５００,,,,\n`));
    // NOTE: possible bug: full-width numbers (common in Japanese Excel exports) are lost without any error.
    expect(row.usableYears).toBeNull();
    expect(row.maxLoadTon).toBeNull();
    expect(row.lengthMm).toBeNull();
  });

  it('truncates thousands separators, decimals and unit suffixes via parseInt/parseFloat', async () => {
    const [row] = await importer().parse(csv(`${HEADER}\nスリング,RG-001,,3.9,2.5t,"1,500",50mm,-6,,\n`));
    // NOTE: possible bug: "1,500" becomes 1 (not 1500) and negative sizes are accepted.
    expect(row.usableYears).toBe(3);
    expect(row.maxLoadTon).toBe(2.5);
    expect(row.lengthMm).toBe(1);
    expect(row.widthMm).toBe(50);
    expect(row.thicknessMm).toBe(-6);
  });

  it('turns an unparseable startedAt into null', async () => {
    const [row] = await importer().parse(csv(`${HEADER}\nスリング,RG-001,,,,,,,R6.4.1,\n`));
    expect(row.startedAt).toBeNull();
  });

  it('rejects a blank managementNumber with the row number', async () => {
    const error = await importer().parse(csv('name,managementNumber\nA,RG-1\nB,\n')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('吊具CSVの3行目でエラー');
    expect((error as ApiError).message).toContain('管理番号は必須です');
  });
});

describe('RiggingGearCsvImporter.import', () => {
  const baseRow = { name: 'スリング', managementNumber: 'RG-001', status: 'AVAILABLE' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.machineNfcTag.findUnique.mockResolvedValue(null);
    mocks.riggingGearTag.findFirst.mockResolvedValue(null);
    mocks.loan.findMany.mockResolvedValue([]);
    mocks.riggingInspectionRecord.findMany.mockResolvedValue([]);
  });

  it('creates gear with parsed values and its tag', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    const rows = await importer().parse(csv('name,managementNumber,maxLoadTon,rfidTagUid,storageLocation\nスリング,RG-001,1.6,E2,倉庫\n'));
    const summary = await importer().import(rows, false);
    expect(summary).toEqual({ processed: 1, created: 1, updated: 0 });
    expect(mocks.riggingGear.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managementNumber: 'RG-001', maxLoadTon: 1.6, storageLocation: '倉庫', status: 'AVAILABLE' }),
    });
    expect(mocks.riggingGearTag.create).toHaveBeenCalledWith({ data: { riggingGearId: 'rg-new', rfidTagUid: 'E2' } });
  });

  it('passes every parsed column to create, mapping nulls to undefined', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    const rows = await importer().parse(
      csv(`${HEADER},storageLocation,department,notes\nスリング,RG-001,ID-9,5,2.5,1500,50,6,2024-04-01,in_use,倉庫,製造,備考\nワイヤ,RG-002,,,,,,,,,,,\n`),
    );
    const summary = await importer().import(rows, false);
    expect(summary).toEqual({ processed: 2, created: 2, updated: 0 });
    expect(mocks.riggingGear.create.mock.calls[0][0]).toEqual({
      data: {
        name: 'スリング',
        managementNumber: 'RG-001',
        idNum: 'ID-9',
        storageLocation: '倉庫',
        department: '製造',
        startedAt: new Date('2024-04-01T00:00:00.000Z'),
        usableYears: 5,
        maxLoadTon: 2.5,
        lengthMm: 1500,
        widthMm: 50,
        thicknessMm: 6,
        status: 'IN_USE',
        notes: '備考',
      },
    });
    const blankData = mocks.riggingGear.create.mock.calls[1][0].data;
    expect(blankData).toMatchObject({ name: 'ワイヤ', managementNumber: 'RG-002', status: 'AVAILABLE', storageLocation: '', department: '' });
    for (const key of ['idNum', 'startedAt', 'usableYears', 'maxLoadTon', 'lengthMm', 'widthMm', 'thicknessMm']) {
      expect(blankData[key]).toBeUndefined();
    }
    // No tag cell -> no tag created.
    expect(mocks.riggingGearTag.create).not.toHaveBeenCalled();
  });

  it('skips update entirely when the row matches the existing record', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({
      id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'IN_USE', lengthMm: 1500, maxLoadTon: 2.5,
    });
    const summary = await importer().import([{ ...baseRow, status: 'IN_USE', lengthMm: 1500, maxLoadTon: 2.5 }], false);
    expect(summary).toEqual({ processed: 1, created: 0, updated: 0 });
    expect(mocks.riggingGear.update).not.toHaveBeenCalled();
    expect(mocks.riggingGear.create).not.toHaveBeenCalled();
  });

  it('re-updates an otherwise unchanged row whenever startedAt is present', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({
      id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE', startedAt: new Date('2024-04-01T00:00:00.000Z'),
    });
    const summary = await importer().import([{ ...baseRow, startedAt: new Date('2024-04-01T00:00:00.000Z') }], false);
    // NOTE: possible bug: buildUpdateDiff compares with Object.is, so equal Date instances always count as changed.
    expect(summary.updated).toBe(1);
    expect(mocks.riggingGear.update.mock.calls[0][0].data).toEqual({ startedAt: new Date('2024-04-01T00:00:00.000Z') });
  });

  it('updates only the changed numeric and status fields, from CSV values', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({
      id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE', lengthMm: 1000, widthMm: 50, maxLoadTon: 1.0,
    });
    const summary = await importer().import(
      [{ ...baseRow, status: 'RETIRED', lengthMm: 1500, widthMm: 50, maxLoadTon: 2.5 }],
      false,
    );
    expect(summary).toEqual({ processed: 1, created: 0, updated: 1 });
    expect(mocks.riggingGear.update).toHaveBeenCalledTimes(1);
    expect(mocks.riggingGear.update).toHaveBeenCalledWith({
      where: { managementNumber: 'RG-001' },
      data: { status: 'RETIRED', lengthMm: 1500, maxLoadTon: 2.5 },
    });
  });

  it('does not clear stored numeric values when the CSV cell is blank on update', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({
      id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE', lengthMm: 1000,
    });
    const summary = await importer().import([{ ...baseRow, lengthMm: null }], false);
    // null -> undefined in updateData, and undefined is dropped from the diff only if the existing value is undefined;
    // here the existing value is 1000, so the diff carries lengthMm: undefined (Prisma treats undefined as "no change").
    expect(summary.updated).toBe(1);
    const data = mocks.riggingGear.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['lengthMm']);
    expect(data.lengthMm).toBeUndefined();
  });

  it('rejects a UID already bound to a machine NFC tag with 409 before touching gear', async () => {
    mocks.machineNfcTag.findUnique.mockResolvedValue({ id: 'm1' });
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    const error = await importer().import([{ ...baseRow, rfidTagUid: ' E9 ' }], false).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(409);
    expect((error as ApiError).message).toBe('このUIDは加工機のNFCタグで使用中です');
    expect(mocks.machineNfcTag.findUnique).toHaveBeenCalledWith({ where: { uid: 'E9' }, select: { id: true } });
    expect(mocks.riggingGear.findUnique).not.toHaveBeenCalled();
    expect(mocks.riggingGear.create).not.toHaveBeenCalled();
    expect(mocks.riggingGearTag.create).not.toHaveBeenCalled();
  });

  it('does not consult machine NFC tags for rows without a UID', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    await importer().import([baseRow], false);
    expect(mocks.machineNfcTag.findUnique).not.toHaveBeenCalled();
  });

  it('replaces existing tags (delete then create) when updating with a UID', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({ id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE' });
    await importer().import([{ ...baseRow, rfidTagUid: 'E3' }], false);
    expect(mocks.riggingGearTag.deleteMany).toHaveBeenCalledWith({ where: { riggingGearId: 'rg-1' } });
    expect(mocks.riggingGearTag.create).toHaveBeenCalledWith({ data: { riggingGearId: 'rg-1', rfidTagUid: 'E3' } });
    expect(mocks.riggingGearTag.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.riggingGearTag.create.mock.invocationCallOrder[0],
    );
  });

  it('keeps existing tags when the UID cell is blank', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({ id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE' });
    await importer().import([{ ...baseRow, rfidTagUid: '  ' }], false);
    expect(mocks.riggingGearTag.deleteMany).not.toHaveBeenCalled();
    expect(mocks.riggingGearTag.create).not.toHaveBeenCalled();
  });

  it('writes a blank storageLocation as an empty string (not null) on update', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({
      id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE', storageLocation: '倉庫', department: '製造',
    });
    const rows = await importer().parse(csv('name,managementNumber,storageLocation,department\nスリング,RG-001,,製造\n'));
    const summary = await importer().import(rows, false);
    expect(summary.updated).toBe(1);
    expect(mocks.riggingGear.update).toHaveBeenCalledWith({
      where: { managementNumber: 'RG-001' },
      data: expect.objectContaining({ storageLocation: '' }),
    });
    expect(mocks.riggingGear.update.mock.calls[0][0].data).not.toHaveProperty('department');
  });

  it('rejects updating with a UID owned by another gear', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue({ id: 'rg-1', managementNumber: 'RG-001', name: 'スリング', status: 'AVAILABLE' });
    mocks.riggingGearTag.findFirst.mockResolvedValue({ riggingGearId: 'rg-other', rfidTagUid: 'E3' });
    const error = await importer().import([{ ...baseRow, rfidTagUid: 'E3' }], false).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    // NOTE: possible bug: the message names RG-001 (the row being updated), not the gear that owns the tag.
    expect((error as ApiError).message).toBe('rfidTagUid="E3"は既に他の吊具（managementNumber: RG-001）で使用されています。');
    expect(mocks.riggingGearTag.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects creating with a UID owned by another gear and names the owner', async () => {
    mocks.riggingGear.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'rg-other', managementNumber: 'RG-777' });
    mocks.riggingGearTag.findFirst.mockResolvedValue({ riggingGearId: 'rg-other', rfidTagUid: 'E3' });
    const error = await importer().import([{ ...baseRow, rfidTagUid: 'E3' }], false).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('rfidTagUid="E3"は既に他の吊具（managementNumber: RG-777）で使用されています。');
    expect(mocks.riggingGear.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate UIDs inside the CSV', async () => {
    const error = await importer()
      .import([{ ...baseRow, rfidTagUid: 'E3' }, { ...baseRow, managementNumber: 'RG-002', rfidTagUid: 'E3' }], false)
      .catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toBe('CSV内でrfidTagUidが重複しています: rfidTagUid="E3" (managementNumber: RG-001, RG-002)');
  });

  it('replaceExisting protects gear with active loans or inspection records', async () => {
    mocks.loan.findMany.mockResolvedValue([{ riggingGearId: 'rg-loan' }, { riggingGearId: null }]);
    mocks.riggingInspectionRecord.findMany.mockResolvedValue([{ riggingGearId: 'rg-insp' }]);
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    await importer().import([baseRow], true);
    expect(mocks.loan.findMany).toHaveBeenCalledWith({ where: { returnedAt: null }, select: { riggingGearId: true } });
    expect(mocks.riggingGear.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: ['rg-loan', 'rg-insp'] } } });
  });

  it('replaceExisting with no protected gear deletes all gear without a filter', async () => {
    mocks.loan.findMany.mockResolvedValue([{ riggingGearId: null }]);
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    await importer().import([baseRow], true);
    expect(mocks.riggingGear.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.riggingGear.deleteMany.mock.calls[0]).toEqual([]);
  });

  it('does not delete anything when replaceExisting is false', async () => {
    mocks.riggingGear.findUnique.mockResolvedValue(null);
    mocks.riggingGear.create.mockResolvedValue({ id: 'rg-new' });
    await importer().import([baseRow], false);
    expect(mocks.riggingGear.deleteMany).not.toHaveBeenCalled();
    expect(mocks.loan.findMany).not.toHaveBeenCalled();
  });
});
