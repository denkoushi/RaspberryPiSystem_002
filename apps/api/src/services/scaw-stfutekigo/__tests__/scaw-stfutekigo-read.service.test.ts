import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';

import { ScawStFutekigoReadService } from '../scaw-stfutekigo-read.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { scawStfutekigoCurrent: { findMany: vi.fn() } }
}));

const findMany = vi.mocked(prisma.scawStfutekigoCurrent.findMany);

describe('ScawStFutekigoReadService', () => {
  beforeEach(() => findMany.mockReset());

  it('reads active persisted projection rows by canonical part number and maps semantic fields', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'case-1',
        nonconformityNo: 'F-0001',
        discoveredOn: new Date('2026-09-02T00:00:00.000Z'),
        originDepartmentName: '製造一課',
        remarks: '備考',
        nonconformityContent: '不適合',
        dispositionContent: '処置',
        correctiveContent1: '是正1',
        correctiveContent2: '是正2',
        partName: '部品A',
        machineName: '機種A'
      }
    ] as never);

    const service = new ScawStFutekigoReadService();
    await expect(service.readCurrentByPartNumber(' ｐａｒｔ－１ ')).resolves.toEqual([
      {
        id: 'case-1',
        discoveredOn: '2026-09-02',
        originDepartmentName: '製造一課',
        remarks: '備考',
        nonconformityContent: '不適合',
        dispositionContent: '処置',
        correctiveContent1: '是正1',
        correctiveContent2: '是正2',
        partName: '部品A',
        machineName: '機種A'
      }
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { partNumber: 'PART-1', isPresentInLatestSnapshot: true },
      select: {
        id: true,
        nonconformityNo: true,
        discoveredOn: true,
        originDepartmentName: true,
        remarks: true,
        nonconformityContent: true,
        dispositionContent: true,
        correctiveContent1: true,
        correctiveContent2: true,
        partName: true,
        machineName: true
      },
      orderBy: [
        { discoveredOn: { sort: 'desc', nulls: 'last' } },
        { nonconformityNo: 'desc' }
      ]
    });
  });

  it('does not query for a blank part number', async () => {
    const service = new ScawStFutekigoReadService();
    await expect(service.readCurrentByPartNumber('  ')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
