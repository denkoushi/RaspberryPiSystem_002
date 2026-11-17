import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import type { GrindingPlanningBoardProjectionInput } from '../grinding-planning-board-projection-input.types.js';
import { encodeSessakuPieceKey, sessakuPieceKeyFromRow, type SessakuPieceSet } from '../sessaku-pieces/piece-key.js';

const stamp = new Date('2026-09-01T00:00:00.000Z');
const parts = fc.uniqueArray(fc.record({
  position: fc.integer({ min: 1, max: 100 }),
  quantity: fc.integer({ min: 1, max: 1000 }),
  isCompleted: fc.boolean()
}), { minLength: 2, maxLength: 12, selector: (part) => part.position });

function buildInput(pieces: Array<{ position: number; quantity: number; isCompleted: boolean }>, perUnitMinutes: number, setupMinutes: number, originalMinutes = 100): GrindingPlanningBoardProjectionInput {
  const row = { id: 'row', updatedAt: stamp, rowData: {
    FSEIBAN: 'S-001', ProductNo: '10', FHINCD: 'P-001', FSIGENCD: '021', FKOJUN: '20', FSIGENSHOYORYO: String(originalMinutes)
  } };
  const key = sessakuPieceKeyFromRow(row.rowData);
  const plannedQuantity = pieces.reduce((sum, piece) => sum + piece.quantity, 0);
  const set: SessakuPieceSet = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1,
    nextPosition: 101, sourcePieceSetId: null, plannedQuantity, quantityWarning: null, autoUnitSplitHeldAt: null,
    createdAt: stamp, updatedAt: stamp,
    pieces: pieces.map((piece, index) => ({ ...piece, id: `p${index}`, pieceSetId: 'set', sourcePieceId: null,
      completedAt: piece.isCompleted ? stamp : null, createdAt: stamp, updatedAt: stamp })) };
  return {
    rows: [row], details: new Map([['row', { updatedAt: stamp, rowNotes: [],
      orderSupplements: [{ plannedQuantity, plannedEndDate: null }],
      productionScheduleProgress: null, productionScheduleExternalCompletion: null }]]),
    ranks: { rows: new Map() }, overrides: new Map(), category: 'grinding', seibanOrder: ['S-001'],
    includePieces: true, pieceSets: new Map([[encodeSessakuPieceKey(key), set]]),
    resourceMinutes: { ownSourceResourceCds: ['021'],
      values: [{ resourceCd: '021', fhincd: 'P-001', perUnitMinutes, setupMinutes }] }
  };
}

describe('projectGrindingPlanningBoard properties', () => {
  it('preserves positive original minutes across proportional pieces without own minutes and leaves zero minutes unknown', () => {
    fc.assert(fc.property(parts, fc.integer({ min: 1, max: 60000 }), (pieces, originalHundredths) => {
      const original = originalHundredths / 100;
      const quantity = pieces.reduce((sum, piece) => sum + piece.quantity, 0);
      for (const resourceMinutes of [
        { ownSourceResourceCds: ['021'], values: [] },
        { ownSourceResourceCds: [], values: [{ resourceCd: '021', fhincd: 'P-001', perUnitMinutes: 10, setupMinutes: 20 }] }
      ]) {
        for (const minutes of [original, 0]) {
          const input = buildInput(pieces, 10, 20, minutes);
          input.resourceMinutes = resourceMinutes;
          const items = projectGrindingPlanningBoard(input).items;
          expect(items).toHaveLength(pieces.length);
          for (const item of items) {
            expect(item.requiredMinutesSource).toBe('original');
            if (minutes === 0) {
              expect(item.requiredMinutes).toBeNull();
            } else {
              expect(item.requiredMinutes).not.toBeNull();
              expect(item.requiredMinutes).toBeCloseTo(minutes * item.quantity! / quantity, 8);
            }
          }
          if (minutes > 0) {
            expect(Math.abs(items.reduce((sum, item) => sum + item.requiredMinutes!, 0) - minutes))
              .toBeLessThanOrEqual(1e-9 * Math.max(1, minutes));
          }
        }
      }
    }), { numRuns: 1000 });
  });

  it('charges own unit minutes for all quantities and setup only at minimum position regardless of completion', () => {
    fc.assert(fc.property(parts, fc.integer({ min: 0, max: 60000 }), fc.integer({ min: 1, max: 60000 }),
      (pieces, unitHundredths, setupHundredths) => {
        const unit = unitHundredths / 100;
        const setup = setupHundredths / 100;
        const before = projectGrindingPlanningBoard(buildInput(pieces, unit, setup)).items;
        const after = projectGrindingPlanningBoard(buildInput(pieces.map((p) => ({ ...p, isCompleted: !p.isCompleted })), unit, setup)).items;
        const first = Math.min(...pieces.map((p) => p.position));
        const expected = unit * pieces.reduce((sum, p) => sum + p.quantity, 0) + setup;
        for (const items of [before, after]) {
          expect(items).toHaveLength(pieces.length);
          expect(Math.abs(items.reduce((sum, item) => sum + item.requiredMinutes!, 0) - expected))
            .toBeLessThanOrEqual(1e-9 * Math.max(1, expected));
          for (const item of items) {
            const expectedSetup = item.piecePosition === first ? setup : 0;
            expect(item.requiredMinutesSource).toBe('own');
            expect(item.setupMinutes).toBe(expectedSetup);
            expect(item.requiredMinutes).toBeCloseTo(unit * item.quantity! + expectedSetup, 8);
            const counterpart = after.find((other) => other.pieceId === item.pieceId)!;
            expect(counterpart.requiredMinutes).toBe(item.requiredMinutes);
          }
        }
        for (const item of before) {
          expect(after.find((other) => other.pieceId === item.pieceId)!.isCompleted).toBe(!item.isCompleted);
        }
      }), { numRuns: 1000 });
  });
});
