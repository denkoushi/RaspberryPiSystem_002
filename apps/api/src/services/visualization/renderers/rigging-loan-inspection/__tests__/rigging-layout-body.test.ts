import { describe, expect, it } from 'vitest';

import { layoutRiggingBodyWithinMaxHeight } from '../rigging-layout-body.js';

describe('layoutRiggingBodyWithinMaxHeight', () => {
  it('joins multiple active management numbers on one line with middle dots', () => {
    const result = layoutRiggingBodyWithinMaxHeight({
      entries: [
        { kind: 'active', managementNumber: 'M33E', name: 'ナイロンスリング' },
        { kind: 'active', managementNumber: 'M02E', name: 'ナイロンスリング' },
      ],
      maxWidthPx: 400,
      baseFontPx: 13,
      scale: 1,
      maxHeight: 500,
      namesStartY: 66,
      bottomPad: 12,
    });
    expect(result.bodyLines.length).toBe(2);
    expect(result.bodyLines[0]!.text).toBe('M33E ・ M02E');
    expect(result.bodyLines[0]!.tone).toBe('primary');
    expect(result.bodyLines[1]!.text).toBe('ナイロンスリング');
    expect(result.bodyLines[1]!.tone).toBe('secondary');
  });
});
