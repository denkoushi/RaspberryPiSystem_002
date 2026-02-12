import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createImporterMock } = vi.hoisted(() => ({
  createImporterMock: vi.fn(),
}));

vi.mock('../csv-importer-factory.js', () => ({
  CsvImporterFactory: {
    create: createImporterMock,
  },
}));

import { ApiError } from '../../../lib/errors.js';
import { processCsvImportFromTargets } from '../csv-import-process.service.js';

describe('processCsvImportFromTargets', () => {
  const log = {
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 400 when targets are empty', async () => {
    await expect(processCsvImportFromTargets([], new Map(), false, log)).rejects.toMatchObject({
      statusCode: 400,
      message: 'インポート対象が指定されていません',
    });
  });

  it('throws 400 when cross-type nfcTagUid is duplicated', async () => {
    const employeesImporter = {
      parse: vi.fn().mockResolvedValue([{ employeeCode: '0001', nfcTagUid: 'TAG-DUP' }]),
      import: vi.fn(),
    };
    const itemsImporter = {
      parse: vi.fn().mockResolvedValue([{ itemCode: 'TO0001', nfcTagUid: 'TAG-DUP' }]),
      import: vi.fn(),
    };
    createImporterMock.mockImplementation((type: string) => {
      if (type === 'employees') return employeesImporter;
      if (type === 'items') return itemsImporter;
      throw new Error(`unexpected type: ${type}`);
    });

    const targets = [
      { type: 'employees', source: 'employees.csv' },
      { type: 'items', source: 'items.csv' },
    ] as any;
    const files = new Map<string, Buffer>([
      ['employees', Buffer.from('employees')],
      ['items', Buffer.from('items')],
    ]);

    await expect(processCsvImportFromTargets(targets, files, false, log)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ crossDuplicateTagUids: expect.any(Array) }),
      'タイプ間でタグUIDが重複'
    );
  });

  it('returns summary from each importer when inputs are valid', async () => {
    const employeesImporter = {
      parse: vi.fn().mockResolvedValue([{ employeeCode: '0001', nfcTagUid: 'EMP-TAG' }]),
      import: vi.fn().mockResolvedValue({ processed: 1, created: 1, updated: 0 }),
    };
    const itemsImporter = {
      parse: vi.fn().mockResolvedValue([{ itemCode: 'TO0001', nfcTagUid: 'ITEM-TAG' }]),
      import: vi.fn().mockResolvedValue({ processed: 1, created: 1, updated: 0 }),
    };
    createImporterMock.mockImplementation((type: string) => {
      if (type === 'employees') return employeesImporter;
      if (type === 'items') return itemsImporter;
      throw new Error(`unexpected type: ${type}`);
    });

    const targets = [
      { type: 'employees', source: 'employees.csv' },
      { type: 'items', source: 'items.csv' },
    ] as any;
    const files = new Map<string, Buffer>([
      ['employees', Buffer.from('employees')],
      ['items', Buffer.from('items')],
    ]);

    const result = await processCsvImportFromTargets(targets, files, false, log);
    expect(result.summary).toEqual({
      employees: { processed: 1, created: 1, updated: 0 },
      items: { processed: 1, created: 1, updated: 0 },
    });
    expect(employeesImporter.import).toHaveBeenCalledWith(expect.any(Array), false, log);
    expect(itemsImporter.import).toHaveBeenCalledWith(expect.any(Array), false, log);
  });

  it('rethrows ApiError from importer without wrapping', async () => {
    const importer = {
      parse: vi.fn().mockResolvedValue([{ employeeCode: '0001' }]),
      import: vi.fn().mockRejectedValue(new ApiError(400, 'custom import error')),
    };
    createImporterMock.mockReturnValue(importer);

    const targets = [{ type: 'employees', source: 'employees.csv' }] as any;
    const files = new Map<string, Buffer>([['employees', Buffer.from('employees')]]);

    await expect(processCsvImportFromTargets(targets, files, false, log)).rejects.toMatchObject({
      statusCode: 400,
      message: 'custom import error',
    });
  });
});
