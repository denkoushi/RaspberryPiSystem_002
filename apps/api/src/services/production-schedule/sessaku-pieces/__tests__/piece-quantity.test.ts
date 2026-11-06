import { describe, it, expect } from 'vitest';
import { planSessakuPieceQuantities } from '../piece-quantity.js';
const pieces = (completed = true) => [{ id: 'a', position: 1, quantity: 2, isCompleted: completed }, { id: 'b', position: 2, quantity: 3, isCompleted: false }];
describe('sessaku piece quantity reconciliation', () => {
  it.each([[7, [2, 5]], [4, [2, 2]], [2, [2]]])('keeps completed quantities and absorbs total %s at the tail', (total, expected) => {
    const result = planSessakuPieceQuantities(pieces(), total, false, 3);
    expect(result.pieces.map((p) => p.quantity)).toEqual(expected);
    expect(result.quantityWarning).toBeNull();
  });
  it('preserves every ID, quantity and position if completed quantity exceeds plan', () => {
    const result = planSessakuPieceQuantities(pieces(), 1, false, 3);
    expect(result.pieces).toEqual(pieces());
    expect(result.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
  });
  it('reduces unfinished quantities backwards and deletes zero pieces', () => {
    expect(planSessakuPieceQuantities(pieces(false), 1, false, 3).pieces).toEqual([{ id: 'a', position: 1, quantity: 1, isCompleted: false }]);
    expect(planSessakuPieceQuantities(pieces(false), 0, false, 3).pieces).toEqual([]);
  });
  it('adds a fresh unfinished tail after all pieces were completed', () => {
    const source = pieces().map((p) => ({ ...p, isCompleted: true }));
    const result = planSessakuPieceQuantities(source, 7, false, 3);
    expect(result.pieces.slice(0, 2)).toEqual(source);
    expect(result.pieces[2]).toMatchObject({ position: 3, quantity: 2, isCompleted: false });
    expect(result.nextPosition).toBe(4);
    expect(planSessakuPieceQuantities(result.pieces, 7, false, 4)).toEqual(result);
  });
  it('keeps an empty tombstone empty', () => expect(planSessakuPieceQuantities([], 5, false, 3).pieces).toEqual([]));
  it.each([null, -1, 1.5, NaN, Infinity])('warns for invalid quantity %s', (total) => {
    expect(planSessakuPieceQuantities(pieces(), total, false, 3)).toMatchObject({ pieces: pieces(), quantityWarning: 'INVALID_PLANNED_QUANTITY' });
  });
  it('external completion protects quantities and correction allows reconciliation', () => {
    expect(planSessakuPieceQuantities(pieces(), 4, true, 3)).toMatchObject({ pieces: pieces(), quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN' });
    expect(planSessakuPieceQuantities(pieces(), 4, false, 3)).toMatchObject({ quantityWarning: null, pieces: [{ quantity: 2 }, { quantity: 2 }] });
  });
});

describe('empty piece-set quantity warnings', () => {
  it.each([null, -1, NaN, 0, 7])('keeps tombstones warning-free for total %s', (total) => {
    expect(planSessakuPieceQuantities([], total, false, 3)).toEqual({ pieces: [], quantityWarning: null, nextPosition: 3 });
  });
});
