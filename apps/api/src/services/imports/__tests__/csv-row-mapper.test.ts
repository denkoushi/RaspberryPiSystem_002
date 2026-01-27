import { describe, expect, it } from 'vitest';
import { CsvRowMapper } from '../csv-row-mapper.js';
import { EmployeeCsvImporter } from '../importers/employee.js';

describe('CsvRowMapper', () => {
  it('maps headers to internal names using candidates', () => {
    const mapper = new CsvRowMapper();
    const buffer = Buffer.from('employeeCode,lastName,firstName\n0001,Yamada,Taro\n', 'utf-8');
    const columnDefinitions = [
      { internalName: 'employeeCode', displayName: '社員コード', csvHeaderCandidates: ['employeeCode'], dataType: 'string', order: 0 },
      { internalName: 'lastName', displayName: '苗字', csvHeaderCandidates: ['lastName'], dataType: 'string', order: 1 },
      { internalName: 'firstName', displayName: '名前', csvHeaderCandidates: ['firstName'], dataType: 'string', order: 2 }
    ];

    const rows = mapper.mapBuffer(buffer, columnDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      employeeCode: '0001',
      lastName: 'Yamada',
      firstName: 'Taro'
    });
  });
});

describe('EmployeeCsvImporter with mapping', () => {
  it('uses columnDefinitions when config exists', async () => {
    const buffer = Buffer.from('社員コード,苗字,名前\n0001,山田,太郎\n', 'utf-8');
    const configService = {
      getEffectiveConfig: async () => ({
        columnDefinitions: [
          { internalName: 'employeeCode', displayName: '社員コード', csvHeaderCandidates: ['社員コード'], dataType: 'string', order: 0 },
          { internalName: 'lastName', displayName: '苗字', csvHeaderCandidates: ['苗字'], dataType: 'string', order: 1 },
          { internalName: 'firstName', displayName: '名前', csvHeaderCandidates: ['名前'], dataType: 'string', order: 2 }
        ],
      })
    } as unknown as { getEffectiveConfig: () => Promise<{ columnDefinitions: unknown[] } | null> };

    const importer = new EmployeeCsvImporter(configService as never);
    const rows = await importer.parse(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      employeeCode: '0001',
      lastName: '山田',
      firstName: '太郎'
    });
  });

  it('falls back to fixed schema when config is missing', async () => {
    const buffer = Buffer.from('employeeCode,lastName,firstName\n0002,Suzuki,Hanako\n', 'utf-8');
    const configService = {
      getEffectiveConfig: async () => null
    } as unknown as { getEffectiveConfig: () => Promise<null> };

    const importer = new EmployeeCsvImporter(configService as never);
    const rows = await importer.parse(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      employeeCode: '0002',
      lastName: 'Suzuki',
      firstName: 'Hanako'
    });
  });
});
