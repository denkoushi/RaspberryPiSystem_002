import { describe, expect, it } from 'vitest';
import { aggregateSessakuPieceCompletion } from '../piece-completion.js';
describe('sessaku piece effective completion', () => {
  it('does not complete an empty set', () => expect(aggregateSessakuPieceCompletion([], true)).toBe(false));
  it('requires all pieces', () => {
    expect(aggregateSessakuPieceCompletion([{ isCompleted: true }, { isCompleted: false }], false)).toBe(false);
    expect(aggregateSessakuPieceCompletion([{ isCompleted: true }, { isCompleted: true }], false)).toBe(true);
  });
  it('uses external completion without destroying manual values', () => {
    const pieces = [{ isCompleted: true }, { isCompleted: false }];
    expect(aggregateSessakuPieceCompletion(pieces, true)).toBe(true);
    expect(aggregateSessakuPieceCompletion(pieces, false)).toBe(false);
    expect(pieces[1].isCompleted).toBe(false);
  });
});
