import { describe, expect, it } from 'vitest';
import { parsePalletBoardMachineCdsFromConfig } from '../pallet-visualization-board-config.js';

describe('parsePalletBoardMachineCdsFromConfig', () => {
  it('returns undefined when key is missing', () => {
    expect(parsePalletBoardMachineCdsFromConfig({})).toBeUndefined();
  });

  it('returns undefined for non-array machineCds', () => {
    expect(parsePalletBoardMachineCdsFromConfig({ machineCds: '021' })).toBeUndefined();
  });

  it('returns undefined for empty array (means all machines)', () => {
    expect(parsePalletBoardMachineCdsFromConfig({ machineCds: [] })).toBeUndefined();
  });

  it('normalizes, dedupes, and preserves input order', () => {
    expect(parsePalletBoardMachineCdsFromConfig({ machineCds: ['b', ' a ', 'B', 3 as unknown as string] })).toEqual(['B', 'A']);
  });
});
