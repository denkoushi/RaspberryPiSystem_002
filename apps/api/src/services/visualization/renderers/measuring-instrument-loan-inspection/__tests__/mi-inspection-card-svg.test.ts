import { describe, expect, it } from 'vitest';
import { createMd3Tokens } from '../../_design-system/index.js';
import { buildMiInspectionCardSvgFragment } from '../mi-inspection-card-svg.js';
import { resolveMiCardChrome } from '../mi-instrument-card-palette.js';
import { buildEmptyBodyLines } from '../layout-mi-instrument-body.js';

describe('buildMiInspectionCardSvgFragment', () => {
  it('draws top band path and header/body text for an active loan card', () => {
    const t = createMd3Tokens({ width: 1920, height: 1080 });
    const scale = t.scale;
    const chrome = resolveMiCardChrome(t, true);
    const bodyLines = buildEmptyBodyLines(Math.max(12, Math.round(13 * scale)), scale);
    const svg = buildMiInspectionCardSvgFragment({
      x: 0,
      y: 0,
      cardWidth: 400,
      cardHeight: 200,
      scale,
      t,
      chrome,
      employeeName: 'テスト 氏名',
      activeLoanCount: 1,
      returnedLoanCount: 0,
      bodyLines,
    });
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('fill="' + t.colors.status.infoContainer + '"');
    expect(svg).toContain('テスト 氏名');
    expect(svg).toContain('貸出中 1 ・ 返却 0');
  });
});

describe('resolveMiCardChrome', () => {
  it('returns distinct band fill for loan vs empty states', () => {
    const t = createMd3Tokens({ width: 1280, height: 720 });
    const withLoan = resolveMiCardChrome(t, true);
    const empty = resolveMiCardChrome(t, false);
    expect(withLoan.bandFill).not.toBe(empty.bandFill);
    expect(withLoan.cardFill).toBe(t.colors.status.infoContainer);
    expect(empty.cardFill).toBe('#020617');
  });
});
