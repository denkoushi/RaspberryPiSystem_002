import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import {
  getProductionScheduleHistoryProgress,
  getProductionScheduleSearchState,
  updateProductionScheduleSearchHistory,
  updateProductionScheduleSearchState,
} from '../production-schedule-search-state.service.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    kioskProductionScheduleSearchState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../seiban-progress.service.js', () => ({
  fetchSeibanProgressRows: vi.fn(),
}));

describe('production-schedule-search-state.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProductionScheduleSearchState は shared 状態を優先し履歴を正規化して返す', async () => {
    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique).mockResolvedValueOnce({
      state: { history: ['A', 'A', ' ', 'B'] },
      updatedAt: new Date('2026-02-12T00:00:00Z'),
    } as never);

    const result = await getProductionScheduleSearchState('kiosk-1');

    expect(result.state.history).toEqual(['A', 'B']);
    expect(result.etag).toContain('W/');
  });

  it('getProductionScheduleHistoryProgress は進捗を history 順で返す', async () => {
    vi.mocked(prisma.kioskProductionScheduleSearchState.findUnique)
      .mockResolvedValueOnce({
        state: { history: ['S-002', 'S-001'] },
        updatedAt: new Date('2026-02-12T00:00:00Z'),
      } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(fetchSeibanProgressRows).mockResolvedValue([
      { fseiban: 'S-001', total: 3, completed: 3, incompleteProductNames: [] },
      { fseiban: 'S-002', total: 5, completed: 2, incompleteProductNames: ['P1'] },
    ]);

    const result = await getProductionScheduleHistoryProgress('kiosk-1');

    expect(result.history).toEqual(['S-002', 'S-001']);
    expect(result.progressBySeiban['S-002']).toEqual({
      total: 5,
      completed: 2,
      status: 'incomplete',
    });
    expect(result.progressBySeiban['S-001'].status).toBe('complete');
  });

  it('updateProductionScheduleSearchState は If-Match 未指定で428を返す', async () => {
    await expect(
      updateProductionScheduleSearchState({
        locationKey: 'kiosk-1',
        ifMatchHeader: undefined,
        incomingHistory: ['S-001'],
      })
    ).rejects.toThrow(ApiError);
  });

  it('updateProductionScheduleSearchHistory は履歴を正規化して保存する', async () => {
    vi.mocked(prisma.kioskProductionScheduleSearchState.upsert).mockResolvedValue({
      updatedAt: new Date('2026-02-12T00:00:00Z'),
    } as never);

    const result = await updateProductionScheduleSearchHistory({
      locationKey: 'kiosk-1',
      history: ['S-001', 'S-001', '  ', 'S-002'],
    });

    expect(result.history).toEqual(['S-001', 'S-002']);
    expect(prisma.kioskProductionScheduleSearchState.upsert).toHaveBeenCalled();
  });
});
