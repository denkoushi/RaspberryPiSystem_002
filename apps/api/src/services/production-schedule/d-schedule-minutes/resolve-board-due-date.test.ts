import { describe, expect, it } from 'vitest';

import { resolveBoardDueDate, type BoardDueSource } from './resolve-board-due-date.js';

const times = [null, new Date('2026-10-01Z'), new Date('2026-10-02Z')];

describe('resolveBoardDueDate', () => {
  for (const source of ['scaw', 'excel'] as BoardDueSource[]) {
    it(`${source}: full presence/absence and timestamp truth table (144 cases)`, () => {
      for (let mask = 0; mask < 16; mask++) {
        for (const manualUpdatedAt of times) for (const excelChangedAt of times) {
          const itemOverride = mask & 1 ? '2026-11-01' : null;
          const manualDueDate = mask & 2 ? '2026-11-03' : null;
          const excelDueDate = mask & 4 ? '2026-11-04' : null;
          const scawPlannedEndDate = mask & 8 ? '2026-11-05' : null;
          let parent = manualDueDate ?? scawPlannedEndDate;
          if (source === 'excel' && excelDueDate) {
            parent = manualDueDate && manualUpdatedAt && (!excelChangedAt || manualUpdatedAt > excelChangedAt)
              ? manualDueDate : excelDueDate;
          }
          expect(resolveBoardDueDate({ source, itemOverride, manualDueDate, manualUpdatedAt,
            excelDueDate, excelChangedAt, scawPlannedEndDate })).toBe(itemOverride ?? parent);
        }
      }
    });
  }
});
