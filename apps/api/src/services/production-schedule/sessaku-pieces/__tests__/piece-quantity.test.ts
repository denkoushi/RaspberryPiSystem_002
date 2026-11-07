import { describe, it, expect } from 'vitest';
import { planLaterProcessPieceQuantities, planSessakuPieceQuantities } from '../piece-quantity.js';
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
  it.each([false, true])('reconciles three pieces on decrease and increase (completed middle=%s)', (completed) => {
    const source = [
      { id: 'a', position: 1, quantity: 3, isCompleted: false },
      { id: 'b', position: 2, quantity: 4, isCompleted: completed },
      { id: 'c', position: 3, quantity: 5, isCompleted: false }
    ];
    const decreased = planSessakuPieceQuantities(source, 6, false, 4);
    expect(decreased.pieces).toEqual(completed
      ? [{ ...source[0], quantity: 2 }, source[1]]
      : [source[0], { ...source[1], quantity: 3 }]);
    expect(decreased.nextPosition).toBe(4); expect(decreased.quantityWarning).toBeNull();
    expect(planSessakuPieceQuantities(source, 15, false, 4)).toEqual({
      pieces: [source[0], source[1], { ...source[2], quantity: 8 }], nextPosition: 4, quantityWarning: null
    });
    expect(source.map((p) => p.quantity)).toEqual([3, 4, 5]);
  });
  it('preserves three completed pieces on decrease and appends a new position on increase', () => {
    const source = [1, 2, 3].map((position) => ({ id: String(position), position, quantity: position, isCompleted: true }));
    expect(planSessakuPieceQuantities(source, 5, false, 4)).toEqual({ pieces: source, nextPosition: 4, quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN' });
    const increased = planSessakuPieceQuantities(source, 8, false, 4);
    expect(increased.pieces.slice(0, 3)).toEqual(source);
    expect(increased.pieces[3]).toMatchObject({ position: 4, quantity: 2, isCompleted: false });
    expect(increased.nextPosition).toBe(5);
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

describe('later process quantity planning', () => {
  const sources = [1, 2, 2].map((quantity, index) => ({ id: `source-${index}`, position: index + 1, quantity, isCompleted: false }));
  const later = sources.map((piece) => ({ ...piece, id: `later-${piece.id}`, sourcePieceId: piece.id }));
  it.each([[7, [1, 2, 4]], [5, [1, 2, 2]], [4, [1, 2, 1]], [2, [1, 1]], [0, []]])('absorbs later total %s from the final unfinished piece', (total, quantities) => {
    const plan = planLaterProcessPieceQuantities(later, sources, total, false, 4);
    expect(plan.pieces.map((piece) => piece.quantity)).toEqual(quantities);
    expect(plan.quantityWarning).toBeNull();
    expect(plan.pieces.every((piece) => piece.sourcePieceId)).toBe(true);
  });
  it.each([-1, 1.5, NaN, Infinity, 2_147_483_648])('keeps existing quantities and positions for invalid later plan %s', (total) => {
    const existing = later.map((piece, index) => ({ ...piece, quantity: index + 3, position: index + 5 }));
    expect(planLaterProcessPieceQuantities(existing, sources, total, false, 9)).toEqual({ pieces: existing, quantityWarning: 'INVALID_PLANNED_QUANTITY', nextPosition: 9 });
  });
  it.each([2, 0])('external completion protects only existing pieces for later total %s', (total) => {
    const existing = planLaterProcessPieceQuantities(later, sources, total, false, 4);
    const plan = planLaterProcessPieceQuantities(existing.pieces as typeof later, sources, total, true, existing.nextPosition);
    expect(plan).toEqual(existing);
    expect(planLaterProcessPieceQuantities(existing.pieces as typeof later, sources, 7, true, existing.nextPosition).pieces).toEqual(existing.pieces);
  });
  it('starts from updated cutting quantities and positions, retaining later identities', () => {
    const next = sources.map((piece, index) => ({ ...piece, quantity: [2, 3, 4][index] }));
    const plan = planLaterProcessPieceQuantities(later, next, 10, false, 4);
    expect(plan.pieces.map((piece) => [piece.id, piece.quantity])).toEqual(later.map((piece, index) => [piece.id, [2, 3, 5][index]]));
    expect(later.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
  });
  it('preserves later completion independently of cutting and warns on impossible totals', () => {
    const completed = later.map((piece) => ({ ...piece, isCompleted: true }));
    const plan = planLaterProcessPieceQuantities(completed, sources, 4, false, 4);
    expect(plan.pieces).toEqual(completed);
    expect(plan.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
    expect(planLaterProcessPieceQuantities(later, sources, null, false, 4).quantityWarning).toBe('INVALID_PLANNED_QUANTITY');
  });  it('retains completed and unfinished tail identities when a later plan grew after completion', () => {
    const completed = later.map((piece) => ({ ...piece, isCompleted: true }));
    const grown = planLaterProcessPieceQuantities(completed, sources, 7, false, 4);
    expect(grown.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2, 2]);
    const again = planLaterProcessPieceQuantities(grown.pieces as typeof later, sources, 7, false, grown.nextPosition);
    expect(again).toEqual(grown);
    const finished = grown.pieces.map((piece) => ({ ...piece, isCompleted: true })) as typeof later;
    expect(planLaterProcessPieceQuantities(finished, sources, 7, false, grown.nextPosition).pieces).toEqual(finished);
  });
  it('removes an unfinished zero tail even when completed quantity exceeds the new plan', () => {
    const source = [{ id: 'a', position: 1, quantity: 3, isCompleted: false }];
    const current = [
      { id: 'done', sourcePieceId: 'a', position: 1, quantity: 3, isCompleted: true },
      { id: 'tail', sourcePieceId: 'a', position: 2, quantity: 2, isCompleted: false }
    ];
    expect(planLaterProcessPieceQuantities(current, source, 2, false, 3)).toMatchObject({
      quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN', pieces: [current[0]]
    });
  });
  it('consolidates only unfinished siblings on structural changes, preserving completed evidence', () => {
    const current = [
      ...later.map((piece) => ({ ...piece, isCompleted: true })),
      { ...later[2], id: 'tail-1', position: 4, quantity: 1 },
      { ...later[2], id: 'tail-2', position: 5, quantity: 1 }
    ];
    const plan = planLaterProcessPieceQuantities(current, sources, 7, false, 6, true);
    expect(plan.pieces.map((piece) => [piece.id, piece.quantity])).toEqual([
      ...later.map((piece) => [piece.id, piece.quantity]), ['tail-1', 2]
    ]);
    expect(plan.pieces.slice(0, 3).every((piece) => piece.isCompleted)).toBe(true);
  });

});
