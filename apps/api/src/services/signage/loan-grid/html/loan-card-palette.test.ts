import { describe, expect, it } from 'vitest';
import {
  loanCardKindFromFlags,
  resolveLoanCardChrome,
  resolveLoanCardHtmlAppearance,
} from './loan-card-palette.js';

describe('loan-card-palette', () => {
  it('loanCardKindFromFlags', () => {
    expect(loanCardKindFromFlags({ isInstrument: true, isRigging: false })).toBe('instrument');
    expect(loanCardKindFromFlags({ isInstrument: false, isRigging: true })).toBe('rigging');
    expect(loanCardKindFromFlags({ isInstrument: false, isRigging: false })).toBe('tool');
  });

  it('resolveLoanCardChrome preserves flat contract for tool', () => {
    const c = resolveLoanCardChrome({ isInstrument: false, isRigging: false, isExceeded: false });
    expect(c.background).toBe('rgb(59,130,246)');
    expect(c.borderWidth).toBe('2px');
  });

  it('resolveLoanCardHtmlAppearance uses gradient for Playwright', () => {
    const a = resolveLoanCardHtmlAppearance({ isInstrument: true, isRigging: false, isExceeded: false });
    expect(a.background).toContain('linear-gradient');
    expect(a.boxShadow).toContain('inset');
    expect(a.borderColor).toBe('rgba(255,255,255,0.18)');
  });

  it('exceeded tightens alert border on HTML path', () => {
    const a = resolveLoanCardHtmlAppearance({ isInstrument: false, isRigging: false, isExceeded: true });
    expect(a.borderColor).toBe('#ef4444');
    expect(a.borderWidth).toBe('2.5px');
  });
});
