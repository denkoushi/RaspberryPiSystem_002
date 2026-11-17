import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planSessakuPieceQuantities, type QuantityPiece } from '../piece-quantity.js';

const pieceInputs = fc.array(fc.record({
  quantity: fc.integer({ min: 1, max: 100 }),
  isCompleted: fc.boolean(),
  protected: fc.boolean()
}), { maxLength: 60 }).chain((entries) =>
  fc.shuffledSubarray(entries.map((_, index) => index + 1), {
    minLength: entries.length, maxLength: entries.length
  }).map((positions) => ({
    pieces: entries.map((entry, index): QuantityPiece => ({
      id: `existing-${index}`, position: positions[index], quantity: entry.quantity, isCompleted: entry.isCompleted
    })),
    protectedIds: new Set(entries.flatMap((entry, index) => entry.protected ? [`existing-${index}`] : []))
  })));

const input = fc.record({
  existing: pieceInputs,
  allUnits: fc.boolean(),
  externalCompleted: fc.boolean(),
  unitSplitEnabled: fc.boolean(),
  positionGap: fc.integer({ min: 1, max: 100 }),
  nextTotal: fc.integer({ min: 0, max: 10000 })
}).map(({ existing, allUnits, positionGap, ...rest }) => ({
  ...rest,
  pieces: existing.pieces.map((piece) => ({ ...piece, quantity: allUnits ? 1 : piece.quantity })),
  protectedIds: existing.protectedIds,
  nextPosition: existing.pieces.length + positionGap
}));

const idSequence = () => {
  let count = 0;
  return () => `new-${++count}`;
};
type Input = typeof input extends fc.Arbitrary<infer T> ? T : never;
const plan = (value: Input, createId = idSequence()) =>
  planSessakuPieceQuantities(value.pieces, value.nextTotal, value.externalCompleted,
    value.nextPosition, value.protectedIds, value.unitSplitEnabled, createId);

const sortedPositive = (pieces: readonly QuantityPiece[]) =>
  pieces.filter((piece) => piece.quantity > 0).sort((a, b) => a.position - b.position);

describe('planSessakuPieceQuantities properties', () => {
  it('returns positive integer quantities and conserves the total without a warning, except for empty input', () => {
    fc.assert(fc.property(input, (value) => {
      const result = plan(value);
      for (const piece of result.pieces) {
        expect(Number.isInteger(piece.quantity)).toBe(true);
        expect(piece.quantity).toBeGreaterThan(0);
      }
      if (value.pieces.length === 0) {
        expect(result).toEqual({ pieces: [], quantityWarning: null, nextPosition: value.nextPosition });
      } else if (result.quantityWarning === null) {
        expect(result.pieces.reduce((sum, piece) => sum + piece.quantity, 0)).toBe(value.nextTotal);
      } else {
        expect(result.pieces).toEqual(sortedPositive(value.pieces));
        expect(result.nextPosition).toBe(value.nextPosition);
      }
    }), { numRuns: 500 });
  });

  it('preserves completed, externally completed and protected pieces', () => {
    fc.assert(fc.property(input, (value) => {
      const result = plan(value);
      for (const piece of value.pieces) {
        if (piece.isCompleted || value.externalCompleted || value.protectedIds.has(piece.id)) {
          expect(result.pieces.find((candidate) => candidate.id === piece.id)).toEqual(piece);
        }
      }
    }), { numRuns: 500 });
  });

  it('keeps positions unique and ascending and uses the supplied ID sequence for every new piece', () => {
    fc.assert(fc.property(input, (value) => {
      const generatedIds: string[] = [];
      const sequence = idSequence();
      const result = plan(value, () => {
        const id = sequence();
        generatedIds.push(id);
        return id;
      });
      const positions = result.pieces.map((piece) => piece.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
      expect(new Set(result.pieces.map((piece) => piece.id)).size).toBe(result.pieces.length);
      const existingIds = new Set(value.pieces.map((piece) => piece.id));
      const added = result.pieces.filter((piece) => !existingIds.has(piece.id));
      expect(added.map((piece) => piece.id)).toEqual(generatedIds);
      expect(added.map((piece) => piece.position)).toEqual(added.map((_, index) => value.nextPosition + index));
      expect(result.nextPosition).toBe(value.nextPosition + added.length);
    }), { numRuns: 500 });
  });

  it('is deterministic with the same ID sequence and does not mutate its input', () => {
    fc.assert(fc.property(input, (value) => {
      const before = value.pieces.map((piece) => ({ ...piece }));
      const protectedBefore = [...value.protectedIds];
      const first = plan(value);
      expect(value.pieces).toEqual(before);
      expect([...value.protectedIds]).toEqual(protectedBefore);
      expect(plan(value)).toEqual(first);
    }), { numRuns: 500 });
  });

  it('does not grow beyond 50 pieces or the existing count when that already exceeds 50', () => {
    fc.assert(fc.property(input, (value) => {
      expect(plan(value).pieces.length).toBeLessThanOrEqual(Math.max(50, value.pieces.length));
    }), { numRuns: 500 });
  });

  it('allocates sequential IDs for unit growth and reserves the last slot for overflow', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 49 }), fc.integer({ min: 1, max: 1000 }),
      fc.boolean(), (count, increase, externalCompleted) => {
        const pieces = Array.from({ length: count }, (_, index) => ({
          id: `existing-${index}`, position: index + 1, quantity: 1, isCompleted: false
        }));
        const result = planSessakuPieceQuantities(pieces, count + increase, externalCompleted,
          count + 5, new Set(), true, idSequence());
        const addedCount = Math.min(increase, 50 - count);
        expect(result.quantityWarning).toBeNull();
        expect(result.pieces.slice(0, count)).toEqual(pieces);
        expect(result.pieces.slice(count)).toEqual(Array.from({ length: addedCount }, (_, index) => ({
          id: `new-${index + 1}`, position: count + 5 + index,
          quantity: index === addedCount - 1 ? increase - index : 1, isCompleted: false
        })));
        expect(result.nextPosition).toBe(count + 5 + addedCount);
      }), { numRuns: 500 });
  });

  it('rejects invalid totals with sorted positive input, while empty input stays warning-free', () => {
    const invalidTotal = fc.oneof(
      fc.constant(null),
      fc.integer({ min: -10000, max: -1 }),
      fc.integer({ min: 0, max: 10000 }).map((value) => value + 0.5),
      fc.integer({ min: 2_147_483_648, max: Number.MAX_SAFE_INTEGER }),
      fc.constantFrom(NaN, Infinity, -Infinity)
    );
    fc.assert(fc.property(input, invalidTotal, fc.integer({ min: -5, max: 0 }), (value, total, nonPositive) => {
      // Also exercise removal of non-positive legacy pieces in the invalid-input path.
      const pieces = value.pieces.map((piece, index) => index % 2 === 0 ? { ...piece, quantity: nonPositive } : piece);
      const generatedIds: string[] = [];
      const result = planSessakuPieceQuantities(pieces, total, value.externalCompleted,
        value.nextPosition, value.protectedIds, value.unitSplitEnabled, () => {
          generatedIds.push('unexpected');
          return 'unexpected';
        });
      expect(result).toEqual({
        pieces: sortedPositive(pieces),
        quantityWarning: pieces.length === 0 ? null : 'INVALID_PLANNED_QUANTITY',
        nextPosition: value.nextPosition
      });
      expect(generatedIds).toEqual([]);
    }), { numRuns: 500 });
  });

  it('defaults to a UUID for a new piece without colliding with an existing ID', () => {
    const pieces = [{ id: 'existing-1', position: 1, quantity: 1, isCompleted: true }];
    const result = planSessakuPieceQuantities(pieces, 2, false, 2);
    expect(result.quantityWarning).toBeNull();
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces[1].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.pieces[1].id).not.toBe(pieces[0].id);
  });
});
