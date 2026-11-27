import { describe, expect, it } from 'vitest';
import { aggregateSessakuPieceCompletion, reconcileSessakuPieceProgress } from '../piece-completion.js';
import type { SessakuPieceSet } from '../piece-key.js';
describe('sessaku piece effective completion', () => {
  it('leaves normal row progress to the parent for an empty legacy grinding set', async () => {
    const set = { fsigencd: '581', sourcePieceSetId: 'cutting', pieces: [] } as unknown as SessakuPieceSet;
    await expect(reconcileSessakuPieceProgress({} as never, set, { emptyIsIncomplete: true, source: {
      set, rowId: 'row', externallyCompleted: false, previousCompleted: true, plannedQuantity: 5
    } })).resolves.toBeNull();
  });
  it('does not complete an empty set', () => expect(aggregateSessakuPieceCompletion([], true)).toBe(false));
  it('requires all pieces', () => {
    expect(aggregateSessakuPieceCompletion([{ isCompleted: true, quantity: 2 }, { isCompleted: false, quantity: 1 }], false)).toBe(false);
    expect(aggregateSessakuPieceCompletion([{ isCompleted: true, quantity: 2 }, { isCompleted: true, quantity: 2 }], false)).toBe(true);
  });
  it('requires the known planned quantity before publishing completion', () => {
    const pieces = [{ isCompleted: true, quantity: 2 }];
    expect(aggregateSessakuPieceCompletion(pieces, false, 3)).toBe(false);
    expect(aggregateSessakuPieceCompletion(pieces, false, 2)).toBe(true);
    expect(aggregateSessakuPieceCompletion(pieces, false, 1)).toBe(true);
    expect(aggregateSessakuPieceCompletion(pieces, true, 3)).toBe(true);
  });
  it('uses external completion without destroying manual values', () => {
    const pieces = [{ isCompleted: true, quantity: 2 }, { isCompleted: false, quantity: 1 }];
    expect(aggregateSessakuPieceCompletion(pieces, true)).toBe(true);
    expect(aggregateSessakuPieceCompletion(pieces, false)).toBe(false);
    expect(pieces[1].isCompleted).toBe(false);
  });
});
