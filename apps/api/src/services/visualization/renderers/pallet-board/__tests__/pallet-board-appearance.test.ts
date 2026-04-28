import { describe, expect, it } from 'vitest';
import { createMd3Tokens } from '../../_design-system/md3.js';
import { mergeMd3TokensForPalletBoardSignage, palletBoardSignageColor } from '../pallet-board-appearance.js';

describe('mergeMd3TokensForPalletBoardSignage', () => {
  it('サイネJPEGボードとして背景・アクティブ枠線のティール優先値を適用する', () => {
    const merged = mergeMd3TokensForPalletBoardSignage(createMd3Tokens({ width: 1920, height: 1080 }));
    expect(merged.colors.surface.background).toBe(palletBoardSignageColor.surfaceBackground);
    expect(merged.colors.status.success).toBe(palletBoardSignageColor.activeStroke);
  });
});
