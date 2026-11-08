import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployeeCsvImporter } from '../importers/employee.js';
import type { CsvImportConfigService } from '../csv-import-config.service.js';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(),
  loans: vi.fn(), transaction: vi.fn(),
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));
const config = { getEffectiveConfig: vi.fn() };
const importer = () => new EmployeeCsvImporter(config as unknown as CsvImportConfigService);

describe('EmployeeCsvImporter position column', () => {
  beforeEach(() => { vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.loans.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async run => run({ employee: mocks, loan: { findMany: mocks.loans } }));
    config.getEffectiveConfig.mockResolvedValue(null); mocks.findUnique.mockResolvedValue({
    id: 'e1', employeeCode: '0001', displayName: '山田太郎', lastName: '山田', firstName: '太郎', positionName: '以前の職位',
    department: null, section: null, nfcTagUid: null, status: 'ACTIVE',
  }); });
  it.each(['positionName', '職位'])('imports the optional %s column', async column => {
    const service = importer();
    const rows = await service.parse(Buffer.from(`employeeCode,lastName,firstName,${column}\n0001,山田,太郎,主任\n`));
    await service.import(rows, false);
    expect(mocks.update).toHaveBeenCalledWith({ where: { employeeCode: '0001' }, data: { positionName: '主任' } });
  });
  it('preserves positionName when the CSV has no position column', async () => {
    const service = importer(); await service.import(await service.parse(Buffer.from('employeeCode,lastName,firstName\n0001,山田,太郎\n')), false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('clears positionName when the column is blank', async () => {
    const service = importer(); await service.import(await service.parse(Buffer.from('employeeCode,lastName,firstName,職位\n0001,山田,太郎,\n')), false);
    expect(mocks.update).toHaveBeenCalledWith({ where: { employeeCode: '0001' }, data: { positionName: null } });
  });
  it('preserves omitted positions when replacement recreates an existing employee', async () => {
    mocks.findMany.mockResolvedValue([{ employeeCode: '0001', positionName: '以前の職位' }]); mocks.findUnique.mockResolvedValue(null);
    const service = importer(); await service.import(await service.parse(Buffer.from('employeeCode,lastName,firstName\n0001,山田,太郎\n')), true);
    expect(mocks.deleteMany).toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ positionName: '以前の職位' }) });
  });
  it('creates an employee with positionName', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const service = importer(); await service.import(await service.parse(Buffer.from('employeeCode,lastName,firstName,positionName\n0001,山田,太郎,主事\n')), false);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ positionName: '主事' }) });
  });
  it.each(['職位', null])('adds the optional definition to older configured imports (%s)', async column => {
    config.getEffectiveConfig.mockResolvedValue({ columnDefinitions: ['employeeCode', 'lastName', 'firstName'].map((internalName, order) => ({
      internalName, displayName: internalName, csvHeaderCandidates: [internalName], dataType: 'string', order,
    })) });
    const service = importer();
    const rows = await service.parse(Buffer.from(`employeeCode,lastName,firstName${column ? ',' + column : ''}\n0001,山田,太郎${column ? ',主任' : ''}\n`));
    await service.import(rows, false);
    if (column) expect(mocks.update).toHaveBeenCalledWith({ where: { employeeCode: '0001' }, data: { positionName: '主任' } });
    else expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('EmployeeCsvImporter replacement transaction', () => {
  const rows = [
    { employeeCode: '0001', lastName: '山田', firstName: '太郎' },
    { employeeCode: '0002', lastName: '田中', firstName: '花子' }
  ];
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.loans.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async run => run({ employee: mocks, loan: { findMany: mocks.loans } }));
  });
  it('rejects duplicate CSV tags with 400 before starting replacement', async () => {
    const service = importer();
    const parsed = await service.parse(Buffer.from('employeeCode,lastName,firstName,nfcTagUid\n0001,山田,太郎,TAG\n0002,田中,花子,TAG\n'));
    await expect(service.import(parsed, true)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it('validates all statuses before starting replacement', async () => {
    await expect(importer().import([rows[0], { ...rows[1], status: 'INVALID' }], true)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('propagates a later row failure from the same transaction as deletion', async () => {
    const error = new Error('row save failed');
    mocks.create.mockResolvedValueOnce({}).mockRejectedValueOnce(error);
    await expect(importer().import(rows, true)).rejects.toBe(error);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000, isolationLevel: 'ReadCommitted' });
    expect(mocks.findMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
    expect(mocks.loans.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
    expect(mocks.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await expect(mocks.transaction.mock.results[0].value).rejects.toBe(error);
  });
  it('keeps employees referenced by loans', async () => {
    mocks.loans.mockResolvedValue([{ employeeId: 'kept' }, { employeeId: null }, { employeeId: 'kept' }]);
    await importer().import(rows, true);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: ['kept'] } } });
  });
  it('does not delete employees without replacement', async () => {
    await importer().import(rows, false);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.loans).not.toHaveBeenCalled();
  });
});
