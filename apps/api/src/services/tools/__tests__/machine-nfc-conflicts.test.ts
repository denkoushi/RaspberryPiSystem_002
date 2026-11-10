import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  machineNfcTag: { findUnique: vi.fn() },
  employee: { findUnique: vi.fn().mockResolvedValue({ id: 'e' }), create: vi.fn(), update: vi.fn() },
  item: { findUnique: vi.fn().mockResolvedValue({ id: 'i' }), create: vi.fn(), update: vi.fn() },
  inventoryNfcTag: { findFirst: vi.fn() },
  measuringInstrument: { create: vi.fn().mockResolvedValue({ id: 'm' }), update: vi.fn().mockResolvedValue({ id: 'm' }) },
  measuringInstrumentTag: { create: vi.fn(), deleteMany: vi.fn() },
  riggingGear: { create: vi.fn().mockResolvedValue({ id: 'r' }), update: vi.fn().mockResolvedValue({ id: 'r' }) },
  riggingGearTag: { create: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: db }));
import { MeasuringInstrumentCsvImporter } from '../../imports/importers/measuring-instrument.js';
import { RiggingGearCsvImporter } from '../../imports/importers/rigging-gear.js';
import { EmployeeService } from '../employee.service.js';
import { ItemService } from '../item.service.js';
import { MeasuringInstrumentService } from '../../measuring-instruments/measuring-instrument.service.js';
import { MeasuringInstrumentTagService } from '../../measuring-instruments/tag.service.js';
import { RiggingGearService } from '../../rigging/rigging-gear.service.js';
import { RiggingGearTagService } from '../../rigging/rigging-gear-tag.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  db.machineNfcTag.findUnique.mockResolvedValue({ id: 'machine-tag' });
  db.$transaction.mockImplementation(async work => work(db));
});

describe('master tag writes respect machine UIDs', () => {
  it.each([
    ['instrument import', () => new MeasuringInstrumentCsvImporter({} as never).import([{ name: '計測器', managementNumber: 'm', rfidTagUid: 'UID1' }], false)],
    ['rigging import', () => new RiggingGearCsvImporter({} as never).import([{ name: '吊具', managementNumber: 'r', rfidTagUid: 'UID1' }], false)],
    ['employee create', () => new EmployeeService().create({ employeeCode: 'e', displayName: '社員', nfcTagUid: ' UID1 ' })],
    ['employee update', () => new EmployeeService().update('e', { nfcTagUid: 'UID1' })],
    ['item create', () => new ItemService().create({ itemCode: 'i', name: '工具', nfcTagUid: 'UID1' })],
    ['item update', () => new ItemService().update('i', { nfcTagUid: 'UID1' })],
    ['instrument create', () => new MeasuringInstrumentService().create({ name: '計測器', managementNumber: 'm', rfidTagUid: 'UID1' })],
    ['instrument update', () => new MeasuringInstrumentService().update('m', { rfidTagUid: 'UID1' })],
    ['instrument tag', () => new MeasuringInstrumentTagService().create({ measuringInstrumentId: 'm', rfidTagUid: 'UID1' })],
    ['rigging create', () => new RiggingGearService().create({ name: '吊具', managementNumber: 'r', rfidTagUid: 'UID1' })],
    ['rigging update', () => new RiggingGearService().update('r', { rfidTagUid: 'UID1' })],
    ['rigging tag', () => new RiggingGearTagService().replaceTagForGear('r', 'UID1')],
  ] as const)('rejects conflicts in %s', async (_name, write) => {
    await expect(write()).rejects.toMatchObject({ statusCode: 409 });
    expect(db.machineNfcTag.findUnique).toHaveBeenCalledWith({ where: { uid: 'UID1' }, select: { id: true } });
    expect(db.measuringInstrumentTag.create).not.toHaveBeenCalled();
    expect(db.riggingGearTag.create).not.toHaveBeenCalled();
    expect(db.riggingGearTag.deleteMany).not.toHaveBeenCalled();
  });
});
