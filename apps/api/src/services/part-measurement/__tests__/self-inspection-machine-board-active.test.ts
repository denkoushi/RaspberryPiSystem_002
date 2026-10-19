import { describe, expect, it } from 'vitest';

import {
  compareSelfInspectionMachineBoardActiveCardsByUpdatedAt,
  mapSelfInspectionMachineBoardActiveSessionsToAggregationRows,
  resolveSelfInspectionMachineBoardResourceDisplayName,
} from '../self-inspection-machine-board-active.js';
import { aggregateSelfInspectionMachineBoardCards } from '../self-inspection-machine-board-aggregation.js';
import type { SelfInspectionMachineBoardActiveSession } from '../self-inspection-machine-board-active.repository.js';

function session(
  overrides: Partial<SelfInspectionMachineBoardActiveSession> = {}
): SelfInspectionMachineBoardActiveSession {
  return {
    id: 'session-1',
    sessionBusinessKey: 'P1::CUTTING::R1::row-1',
    productNo: 'P1',
    processGroup: 'CUTTING',
    resourceCd: 'r1',
    scheduleRowId: 'row-1',
    fseiban: 'S1',
    fhincd: 'H1',
    fhinmei: '品名',
    machineName: '機種 snapshot',
    plannedQuantity: 2,
    expectedEntryCount: 2,
    completedAt: null,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    template: {
      selfInspectionMode: 'FULL',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      items: [{ id: 'item-1' }],
    },
    inspectorRemeasurementRequiredAt: null,
    recordApproval: null,
    entries: [
      {
        entryIndex: 0,
        persistenceStatus: 'CONFIRMED',
        values: [
          {
            judgementResult: null,
            reviewStatus: 'NOT_REQUIRED',
            finalReviewStatus: null,
          },
        ],
      },
    ],
    inspectorEntries: [],
    ...overrides,
  };
}

describe('self-inspection-machine-board-active', () => {
  it('joins multiple resource master names and falls back to the CD when absent', () => {
    expect(
      resolveSelfInspectionMachineBoardResourceDisplayName('r1', {
        R1: ['旋盤', '複合旋盤', '旋盤'],
      })
    ).toBe('旋盤 / 複合旋盤');
    expect(resolveSelfInspectionMachineBoardResourceDisplayName('r2', {})).toBe('名称未登録');
  });

  it('prefers session machine snapshot and only falls back for missing snapshots', () => {
    const rows = mapSelfInspectionMachineBoardActiveSessionsToAggregationRows(
      [session(), session({ id: 'session-2', fseiban: 'S2', machineName: null })],
      { machineNameByFseiban: { S1: 'fallback-1', S2: 'fallback-2' } }
    );

    expect(rows.map((row) => row.machineName)).toEqual(['機種 snapshot', 'fallback-2']);
  });

  it('keeps DRAFT-only sessions active while excluding their entries from progress', () => {
    const rows = mapSelfInspectionMachineBoardActiveSessionsToAggregationRows([
      session({
        entries: [
          {
            entryIndex: 0,
            persistenceStatus: 'DRAFT',
            values: [
              {
                judgementResult: 'FAIL',
                reviewStatus: 'PENDING',
                finalReviewStatus: null,
              },
            ],
          },
        ],
      }),
    ]);
    const cards = aggregateSelfInspectionMachineBoardCards(rows);

    expect(rows[0]).toMatchObject({
      confirmedEntryCount: 0,
      completedEntryCount: 0,
      requiredEntryCount: 2,
    });
    expect(cards[0]).toMatchObject({
      outcome: 'in_progress',
      completedEntryCount: 0,
      requiredEntryCount: 2,
    });
  });

  it('does not treat APPROVED as pending and exposes the resource display name', () => {
    const rows = mapSelfInspectionMachineBoardActiveSessionsToAggregationRows(
      [
        session({
          entries: [
            {
              entryIndex: 0,
              persistenceStatus: 'CONFIRMED',
              values: [
                {
                  judgementResult: 'PASS',
                  reviewStatus: 'PENDING',
                  finalReviewStatus: 'APPROVED',
                },
              ],
            },
          ],
        }),
      ],
      { resourceNameMap: { R1: ['旋盤'] } }
    );
    const cards = aggregateSelfInspectionMachineBoardCards(rows);

    expect(cards[0]?.outcome).toBe('in_progress');
    expect(cards[0]?.resources[0]).toMatchObject({
      resourceCd: 'R1',
      resourceDisplayName: '旋盤',
    });
  });

  it('keeps a fully measured active session pending until final confirmation', () => {
    const rows = mapSelfInspectionMachineBoardActiveSessionsToAggregationRows([
      session({
        plannedQuantity: 1,
        expectedEntryCount: 1,
        inspectorRemeasurementRequiredAt: new Date('2026-07-28T11:50:00.000Z'),
        entries: [
          {
            entryIndex: 0,
            persistenceStatus: 'CONFIRMED',
            values: [
              {
                judgementResult: 'PASS',
                reviewStatus: 'PENDING',
                finalReviewStatus: 'APPROVED',
              },
            ],
          },
        ],
        inspectorEntries: [
          {
            entryIndex: 0,
            values: [
              {
                templateItemId: 'item-1',
                inspectorValue: 130.18,
                inspectorJudgementResult: null,
              },
            ],
          },
        ],
      }),
    ]);

    expect(aggregateSelfInspectionMachineBoardCards(rows)[0]?.outcome).toBe('pending');
  });

  it('sorts active cards by newest updatedAt with a stable card-key tie-break', () => {
    const cards = aggregateSelfInspectionMachineBoardCards(
      mapSelfInspectionMachineBoardActiveSessionsToAggregationRows([
        session({ id: 'old', fseiban: 'S2', updatedAt: new Date('2026-08-24T00:00:00Z') }),
        session({ id: 'new-b', fseiban: 'S3', updatedAt: new Date('2026-08-25T00:00:00Z') }),
        session({ id: 'new-a', fseiban: 'S1', updatedAt: new Date('2026-08-25T00:00:00Z') }),
      ])
    );

    cards.sort(compareSelfInspectionMachineBoardActiveCardsByUpdatedAt);

    expect(cards.map((card) => card.fseiban)).toEqual(['S1', 'S3', 'S2']);
  });
});
