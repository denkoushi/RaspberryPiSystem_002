import { describe, expect, it } from 'vitest';

import {
  buildFlatMachineBoardPages,
  groupPartsBySeiban,
  sanitizeSelfInspectionMachineBoardDetailTopN,
  sanitizeSelfInspectionMachineBoardPartsPerPage,
  summaryPartsPageCount,
} from './pagination.js';

describe('self-inspection-machine-board pagination', () => {
  it('sanitizes partsPerPage and detailTopN', () => {
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(Number.NaN)).toBe(12);
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(0)).toBe(1);
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(999)).toBe(12);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(Number.NaN)).toBe(5);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(-1)).toBe(0);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(99)).toBe(20);
  });

  it('builds flat summary + detail pages', () => {
    const parts = Array.from({ length: 5 }, (_, index) => ({
      scheduleRowId: `row-${index}`,
      fseiban: `S-${index % 2}`,
      productNo: `P-${index}`,
      fhincd: `H-${index}`,
      fhinmei: `Name-${index}`,
      status: 'not_started' as const,
      completedEntryCount: 0,
      requiredEntryCount: 3,
      progressLabel: '0/3',
      dueDate: index % 2 === 0 ? new Date('2026-06-01T00:00:00Z') : null,
      isScheduled: index % 2 === 0,
    }));

    const pages = buildFlatMachineBoardPages({
      machineName: 'L300KP',
      updatedAt: new Date('2026-06-08T00:00:00Z'),
      orderedParts: parts,
      detailPages: [
        {
          kind: 'detail',
          machineName: 'L300KP',
          updatedAt: new Date('2026-06-08T00:00:00Z'),
          fseiban: 'S-0',
          fhincd: 'H-0',
          fhinmei: 'Name-0',
          status: 'in_progress',
          progressLabel: '1/3',
          measurementPoints: [],
          pageIndex: 0,
          pageCount: 0,
        },
      ],
      partsPerPage: 2,
    });

    expect(summaryPartsPageCount(parts.length, 2)).toBe(3);
    expect(pages).toHaveLength(4);
    expect(pages[0]?.kind).toBe('summary');
    expect(pages[3]?.kind).toBe('detail');
    expect(pages[3]?.pageCount).toBe(4);
  });

  it('groups page parts by seiban and scheduled flag', () => {
    const grouped = groupPartsBySeiban([
      {
        scheduleRowId: 'a',
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        fhinmei: 'N1',
        status: 'completed',
        completedEntryCount: 2,
        requiredEntryCount: 2,
        progressLabel: '2/2',
        dueDate: new Date('2026-06-02T00:00:00Z'),
        isScheduled: true,
      },
      {
        scheduleRowId: 'b',
        fseiban: 'S2',
        productNo: 'P2',
        fhincd: 'H2',
        fhinmei: 'N2',
        status: 'not_started',
        completedEntryCount: 0,
        requiredEntryCount: 1,
        progressLabel: '0/1',
        dueDate: null,
        isScheduled: false,
      },
    ]);

    expect(grouped.scheduled).toHaveLength(1);
    expect(grouped.unscheduled).toHaveLength(1);
  });
});
