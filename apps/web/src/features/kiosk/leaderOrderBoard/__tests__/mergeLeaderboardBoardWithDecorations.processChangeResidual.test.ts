import { describe, expect, it } from 'vitest';

import {
  createEmptyAccumulatedLeaderboardDecorations,
  mergeLeaderboardBoardWithDecorations
} from '../mergeLeaderboardBoardWithDecorations';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

describe('mergeLeaderboardBoardWithDecorations process change residual', () => {
  it('preserves processChangeResidual fields after decoration merge', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 1,
      rows: [{ id: 'r1', occurredAt: '2026-01-01T00:00:00.000Z', rowData: { ProductNo: 'P1' } }],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }],
      processChangeResidualTotal: 2,
      processChangeResidualRepresentativeLimit: 20,
      processChangeResidualRows: [
        {
          id: 'x1',
          occurredAt: '2026-01-01T00:00:00.000Z',
          rowData: { ProductNo: 'P1', FSIGENCD: '1', FKOJUN: '210' },
          processChangeResidualSuspected: true,
          processChangeResidualEvidence: {
            current: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '1',
              status: 'R',
              fupdtedt: '2026-04-13T13:02:46.000Z'
            },
            completedOtherResource: {
              productNo: 'P1',
              fkojun: '210',
              resourceCd: '2',
              status: 'C',
              fupdtedt: '2026-05-12T06:46:56.000Z'
            }
          }
        }
      ]
    };

    const merged = mergeLeaderboardBoardWithDecorations(board, createEmptyAccumulatedLeaderboardDecorations());
    expect(merged.processChangeResidualTotal).toBe(2);
    expect(merged.processChangeResidualRows).toHaveLength(1);
    expect(merged.processChangeResidualRepresentativeLimit).toBe(20);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]?.id).toBe('r1');
  });
});
