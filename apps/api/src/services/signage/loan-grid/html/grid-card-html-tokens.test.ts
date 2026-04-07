import { describe, expect, it } from 'vitest';
import {
  computeCompactCardHtmlTokens,
  computeDefaultCardHtmlTokens,
  computeGridCardSpacingTokens,
} from './grid-card-html-tokens.js';

describe('grid-card-html-tokens', () => {
  it('scales spacing linearly at scale 1', () => {
    const s = computeGridCardSpacingTokens(1);
    expect(s.padPx).toBe(12);
    expect(s.thumbPx).toBe(96);
    expect(s.thumbBorderPx).toBe(1);
    expect(s.innerGapPx).toBe(12);
    expect(s.cardRadiusPx).toBe(16);
  });

  it('compact: name and primary share font size at scale 1', () => {
    const c = computeCompactCardHtmlTokens(1);
    expect(c.nameAndPrimaryPx).toBe(14);
    expect(c.locationPx).toBe(12);
    expect(c.padPx).toBe(10);
    expect(c.nameMarginBottomPx).toBe(3);
  });

  it('compact: scales fonts at scale 2', () => {
    const c = computeCompactCardHtmlTokens(2);
    expect(c.nameAndPrimaryPx).toBe(28);
    expect(c.thumbPx).toBe(192);
    expect(c.padPx).toBe(20);
    expect(c.nameMarginBottomPx).toBe(6);
  });

  it('default card tokens compose spacing + fonts', () => {
    const d = computeDefaultCardHtmlTokens(1);
    expect(d.padPx).toBe(12);
    expect(d.primaryPx).toBe(18);
  });
});
