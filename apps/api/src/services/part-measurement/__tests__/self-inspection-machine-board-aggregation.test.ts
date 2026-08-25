import { describe, expect, it } from 'vitest';

import {
  aggregateSelfInspectionMachineBoardCards,
  aggregateSelfInspectionMachineBoardResources,
  buildSelfInspectionMachineBoardCardKey,
} from '../self-inspection-machine-board-aggregation.js';

function row(input: Partial<Parameters<typeof aggregateSelfInspectionMachineBoardResources>[0][number]> = {}) {
  return {
    scheduleRowId: 'row-1',
    fseiban: 'S1',
    productNo: 'P1',
    fhincd: 'H1',
    fhinmei: '部品1',
    machineName: ' Machine A ',
    resourceCd: 'R1',
    dueDate: null,
    isScheduled: false,
    confirmedEntryCount: 1,
    requiredEntryCount: 2,
    ...input,
  };
}

describe('self-inspection machine board aggregation', () => {
  it('uses the normalized machine name in the internal card key', () => {
    expect(
      buildSelfInspectionMachineBoardCardKey({
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        machineName: ' ａ machine ｂ ',
      })
    ).toBe('S1::P1::H1::A MACHINE B');
  });

  it('sums CONFIRMED and required counts per resource CD', () => {
    const resources = aggregateSelfInspectionMachineBoardResources([
      row({ scheduleRowId: 'a', confirmedEntryCount: 1, requiredEntryCount: 2 }),
      row({ scheduleRowId: 'b', confirmedEntryCount: 2, requiredEntryCount: 3 }),
      row({ resourceCd: 'R2', confirmedEntryCount: 0, requiredEntryCount: 1 }),
    ]);

    expect(resources).toMatchObject([
      {
        resourceCd: 'R1',
        confirmedEntryCount: 3,
        requiredEntryCount: 5,
        progressLabel: '3/5',
        status: 'in_progress',
      },
      {
        resourceCd: 'R2',
        confirmedEntryCount: 0,
        requiredEntryCount: 1,
        status: 'not_started',
      },
    ]);
  });

  it('groups resources into one card and elevates the highest-priority outcome', () => {
    const cards = aggregateSelfInspectionMachineBoardCards([
      row({
        scheduleRowId: 'r1',
        resourceCd: 'R1',
        confirmedEntryCount: 2,
        requiredEntryCount: 2,
        outcome: { confirmedEntryCount: 2, requiredEntryCount: 2, judgementResults: ['PASS'] },
      }),
      row({
        scheduleRowId: 'r2',
        resourceCd: 'R2',
        confirmedEntryCount: 1,
        requiredEntryCount: 1,
        outcome: { confirmedEntryCount: 1, requiredEntryCount: 1, judgementResults: ['FAIL'] },
      }),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cardKey: 'S1::P1::H1::MACHINE A',
      resourceCds: ['R1', 'R2'],
      completedEntryCount: 3,
      requiredEntryCount: 3,
      outcome: 'rejected',
    });
    expect(cards[0]?.resources.map((resource) => resource.status)).toEqual(['pass', 'rejected']);
  });
});
