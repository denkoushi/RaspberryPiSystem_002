import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployeeCsvImporter } from '../importers/employee.js';
import type { CsvImportConfigService } from '../csv-import-config.service.js';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { employee: mocks, loan: { findMany: async () => [] }, $transaction: async (run: (tx: unknown) => unknown) => run({ employee: mocks }) } }));
const config = { getEffectiveConfig: vi.fn() };
const importer = () => new EmployeeCsvImporter(config as unknown as CsvImportConfigService);

describe('EmployeeCsvImporter position column', () => {
  beforeEach(() => { vi.clearAllMocks(); config.getEffectiveConfig.mockResolvedValue(null); mocks.findUnique.mockResolvedValue({
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
