import { describe, expect, it, vi } from 'vitest';

import { BusinessHermesScanResolver } from './business-hermes-scan.service.js';

const row = (overrides: Partial<{
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: number | null;
}> = {}) => ({
  productNo: '',
  fseiban: '',
  fhincd: '',
  fhinmei: '',
  fsigencd: '',
  fkojun: null,
  ...overrides
});

function resolver(input: {
  product?: ReturnType<typeof vi.fn>;
  fseiban?: ReturnType<typeof vi.fn>;
  part?: ReturnType<typeof vi.fn>;
  nonconformity?: ReturnType<typeof vi.fn>;
  groups?: ReturnType<typeof vi.fn>;
  alias?: ReturnType<typeof vi.fn>;
}) {
  return new BusinessHermesScanResolver({
    scheduleByProductNo: input.product ?? vi.fn().mockResolvedValue([]),
    scheduleByFseiban: input.fseiban ?? vi.fn().mockResolvedValue([]),
    scheduleByPartNumber: input.part ?? vi.fn().mockResolvedValue([]),
    nonconformities: { readCurrentByPartNumber: input.nonconformity ?? vi.fn().mockResolvedValue([]) },
    workInstructions: {
      readPublishedGroups: input.groups ?? vi.fn().mockResolvedValue([]),
      readPublishedPartAlias: input.alias ?? vi.fn().mockResolvedValue(null)
    }
  });
}

describe('BusinessHermesScanResolver', () => {
  it('classifies ProductNo from a schedule row even when measurement resource fields are blank', async () => {
    const service = resolver({ product: vi.fn().mockResolvedValue([row({ productNo: 'ORDER-1', fseiban: '' })]) });

    await expect(service.resolve('ORDER-1')).resolves.toMatchObject({
      kind: 'manufacturing_order',
      ambiguous: false,
      candidateCount: 1,
      matches: [{ matchField: 'ProductNo', productNo: 'ORDER-1' }]
    });
  });

  it('keeps FSEIBAN as a serial/other match and preserves related orders', async () => {
    const service = resolver({ fseiban: vi.fn().mockResolvedValue([
      row({ fseiban: 'SERIAL-1', productNo: 'ORDER-1', fhincd: 'PART-1' }),
      row({ fseiban: 'SERIAL-1', productNo: 'ORDER-2', fhincd: 'PART-2' })
    ]) });

    const result = await service.resolve('SERIAL-1');
    expect(result).toMatchObject({ kind: 'other', ambiguous: false, candidateCount: 1 });
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchField: 'FSEIBAN', productNo: 'ORDER-1', partNumber: 'PART-1' }),
      expect.objectContaining({ matchField: 'FSEIBAN', productNo: 'ORDER-2', partNumber: 'PART-2' })
    ]));
  });

  it('treats schedule FHINCD, nonconformity, and work instruction matches as one part candidate', async () => {
    const service = resolver({
      part: vi.fn().mockResolvedValue([row({ fhincd: 'PART-1', productNo: 'ORDER-1' })]),
      nonconformity: vi.fn().mockResolvedValue([{ partName: 'ブラケット' }]),
      groups: vi.fn().mockResolvedValue([{ partNumber: 'PART-1', shootingTarget: '切削' }])
    });

    const result = await service.resolve('PART-1');
    expect(result).toMatchObject({ kind: 'part_number', ambiguous: false, candidateCount: 1, truncated: false });
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'production_schedule', matchField: 'FHINCD' }),
      expect.objectContaining({ source: 'nonconformity', matchField: 'ScawStFutekigoCurrent.partNumber' }),
      expect.objectContaining({ source: 'work_instruction', matchField: 'WorkInstruction.partNumber' })
    ]));
  });

  it('marks a scan ambiguous when the same value is verified as different identifier kinds', async () => {
    const service = resolver({
      product: vi.fn().mockResolvedValue([row({ productNo: 'SAME' })]),
      part: vi.fn().mockResolvedValue([row({ fhincd: 'SAME' })])
    });

    await expect(service.resolve('SAME')).resolves.toMatchObject({ kind: 'unknown', ambiguous: true, candidateCount: 2 });
  });

  it('returns unknown without inferring an identifier from its shape', async () => {
    const service = resolver({});

    await expect(service.resolve('looks-like-a-code')).resolves.toMatchObject({
      kind: 'unknown',
      ambiguous: false,
      candidateCount: 0,
      matches: []
    });
  });

  it('keeps a representative row for each logical candidate when matches are truncated', async () => {
    const service = resolver({
      fseiban: vi.fn().mockResolvedValue([
        ...Array.from({ length: 14 }, (_, index) => row({ fseiban: 'SERIAL-1', productNo: `ORDER-${index}`, fhincd: `PART-${index}` })),
        row({ fseiban: 'SERIAL-1', productNo: 'ORDER-OTHER', fhincd: 'PART-OTHER' })
      ]),
      part: vi.fn().mockResolvedValue([row({ fhincd: 'SERIAL-1', productNo: 'PART-ORDER' })])
    });

    const result = await service.resolve('SERIAL-1');
    expect(result).toMatchObject({ kind: 'unknown', ambiguous: true, candidateCount: 2, truncated: true });
    expect(result.matches).toHaveLength(12);
    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchField: 'FSEIBAN', productNo: 'ORDER-0' }),
      expect.objectContaining({ matchField: 'FHINCD', productNo: 'PART-ORDER' })
    ]));
  });
});
