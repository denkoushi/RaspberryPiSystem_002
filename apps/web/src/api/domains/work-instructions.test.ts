import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import {
  getWorkInstructionGroup,
  getWorkInstructionGroupsByPartNumber,
  getWorkInstructionPartCandidates,
  type WorkInstructionGroup,
  type WorkInstructionGroupSummary
} from './work-instructions';

vi.mock('../http', () => ({
  api: { get: vi.fn() }
}));

const apiGet = vi.mocked(api.get);

function summary(shootingTarget: string, rowCount = 1): WorkInstructionGroupSummary {
  return {
    partNumber: 'PART-1',
    shootingTarget,
    rowCount,
    stepCount: rowCount,
    latestModified: '2026-08-31T00:00:00.000Z'
  };
}

describe('work-instructions API client', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('fetches 100-item pages until a short page and keeps one summary per target', async () => {
    const firstPage = [
      summary('研削'),
      summary('581', 11),
      ...Array.from({ length: 98 }, () => summary('581', 99))
    ];
    const secondPage = [summary('切削'), summary('10'), summary('2'), summary('581', 22)];
    apiGet
      .mockResolvedValueOnce({ data: { groups: firstPage, limit: 100, offset: 0 } } as never)
      .mockResolvedValueOnce({ data: { groups: secondPage, limit: 100, offset: 100 } } as never);

    const result = await getWorkInstructionGroupsByPartNumber('  ｐａｒｔ－１ ');

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet).toHaveBeenNthCalledWith(1, '/work-instructions/groups', {
      params: { partNumber: 'PART-1', limit: 100, offset: 0 }
    });
    expect(apiGet).toHaveBeenNthCalledWith(2, '/work-instructions/groups', {
      params: { partNumber: 'PART-1', limit: 100, offset: 100 }
    });
    expect(result.map((group) => group.shootingTarget)).toEqual([
      '研削',
      '切削',
      '2',
      '10',
      '581'
    ]);
    expect(result.find((group) => group.shootingTarget === '581')?.rowCount).toBe(11);
  });

  it('does not request groups for a blank scanned part number', async () => {
    await expect(getWorkInstructionGroupsByPartNumber('  ')).resolves.toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('maps the selected shooting target to the backend resource query', async () => {
    const group: WorkInstructionGroup = {
      partNumber: 'PART-1',
      shootingTarget: '581',
      rows: [],
      steps: []
    };
    apiGet.mockResolvedValueOnce({ data: group } as never);

    await expect(getWorkInstructionGroup(' ｐａｒｔ－１ ', ' ５８１ ')).resolves.toEqual(group);
    expect(apiGet).toHaveBeenCalledWith('/work-instructions/group', {
      params: { partNumber: 'PART-1', resource: '581' }
    });
  });

  it('normalizes and requests a bounded part-candidate page', async () => {
    const page = {
      matchedPrefix: 'PART-',
      candidates: [{ partNumber: 'PART-1', partName: '部品A', shootingTargets: ['研削'] }],
      limit: 20,
      offset: 0,
      hasMore: false
    };
    apiGet.mockResolvedValueOnce({ data: page } as never);
    const controller = new AbortController();

    await expect(getWorkInstructionPartCandidates(
      { prefix: ' ｐａｒｔ－ ', fallback: true },
      controller.signal
    )).resolves.toEqual(page);

    expect(apiGet).toHaveBeenCalledWith('/work-instructions/part-candidates', {
      params: { prefix: 'PART-', fallback: true, limit: 20, offset: 0 },
      signal: controller.signal
    });
  });

  it('does not request candidates for a prefix shorter than two characters', async () => {
    await expect(getWorkInstructionPartCandidates({ prefix: 'A' })).resolves.toEqual({
      matchedPrefix: null,
      candidates: [],
      limit: 20,
      offset: 0,
      hasMore: false
    });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
