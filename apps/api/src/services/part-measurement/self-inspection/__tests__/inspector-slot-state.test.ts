import { describe, expect, it } from 'vitest';

import {
  buildInspectorMeasurementCompletion,
  buildInspectorSlotStates
} from '../inspector-slot-state.js';

const template = {
  selfInspectionMode: 'FULL' as const,
  selfInspectionFixedCount: null
};

const completeValues = (itemIds: string[]) =>
  itemIds.map((templateItemId) => ({
    templateItemId,
    inspectorValue: null,
    inspectorJudgementResult: 'PASS'
  }));

describe('inspector slot state', () => {
  it('classifies missing, draft and confirmed operator slots', () => {
    expect(
      buildInspectorSlotStates({
        template,
        plannedQuantity: 5,
        itemIds: ['item-1'],
        operatorEntries: [
          { entryIndex: 1, persistenceStatus: 'DRAFT' },
          { entryIndex: 2, persistenceStatus: 'CONFIRMED' }
        ]
      }).map((slot) => slot.operatorState)
    ).toEqual(['missing', 'draft', 'confirmed', 'missing', 'missing']);
  });

  it('distinguishes not started, in progress and complete inspector slots', () => {
    expect(
      buildInspectorSlotStates({
        template,
        plannedQuantity: 3,
        itemIds: ['item-1', 'item-2'],
        operatorEntries: [
          { entryIndex: 0, persistenceStatus: 'CONFIRMED' },
          { entryIndex: 1, persistenceStatus: 'CONFIRMED' },
          { entryIndex: 2, persistenceStatus: 'CONFIRMED' }
        ],
        inspectorEntries: [
          { entryIndex: 1, values: [{ templateItemId: 'item-1', inspectorValue: null, inspectorJudgementResult: null }] },
          { entryIndex: 2, values: completeValues(['item-1', 'item-2']) }
        ]
      }).map((slot) => slot.inspectorState)
    ).toEqual(['not_started', 'in_progress', 'complete']);
  });

  it('does not count inspector values attached to an unconfirmed operator slot', () => {
    const result = buildInspectorMeasurementCompletion({
      inspectorRemeasurementRequiredAt: new Date(),
      template: { ...template, itemIds: ['item-1'] },
      plannedQuantity: 2,
      operatorEntries: [
        { entryIndex: 0, persistenceStatus: 'CONFIRMED' },
        { entryIndex: 1, persistenceStatus: 'DRAFT' }
      ],
      inspectorEntries: [
        { entryIndex: 0, values: completeValues(['item-1']) },
        { entryIndex: 1, values: completeValues(['item-1']) }
      ]
    });

    expect(result.completedRequiredEntryCount).toBe(1);
    expect(result.missingRequiredEntryCount).toBe(1);
    expect(result.state).toBe('in_progress');
  });

  it.each([
    ['FULL', 5, [0, 1, 2, 3, 4]],
    ['FIXED_COUNT', 5, [0, 1]],
    ['FIRST_LAST', 5, [0, 4]]
  ] as const)('supports sparse required slots for %s', (mode, plannedQuantity, expected) => {
    const result = buildInspectorSlotStates({
      template: {
        selfInspectionMode: mode as 'FULL' | 'FIXED_COUNT' | 'FIRST_LAST',
        selfInspectionFixedCount: mode === 'FIXED_COUNT' ? 2 : null
      },
      plannedQuantity,
      itemIds: ['item-1']
    });
    expect(result.map((slot) => slot.entryIndex)).toEqual(expected);
  });
});

