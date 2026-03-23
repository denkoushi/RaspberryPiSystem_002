import { describe, expect, it } from 'vitest';

import {
  buildManualOrderCardResourceSubtitleParts,
  joinManualOrderResourceDisplayNames
} from './manualOrderOverviewCardPresentation';

describe('joinManualOrderResourceDisplayNames', () => {
  it('空・未定義は空文字', () => {
    expect(joinManualOrderResourceDisplayNames(undefined)).toBe('');
    expect(joinManualOrderResourceDisplayNames(null)).toBe('');
    expect(joinManualOrderResourceDisplayNames([])).toBe('');
  });

  it('前後空白を除き単一名称を返す', () => {
    expect(joinManualOrderResourceDisplayNames(['  平面研削  '])).toBe('平面研削');
  });

  it('複数名称は " / " で連結', () => {
    expect(joinManualOrderResourceDisplayNames(['A', 'B'])).toBe('A / B');
  });

  it('空要素はスキップ', () => {
    expect(joinManualOrderResourceDisplayNames(['A', '  ', '', 'B'])).toBe('A / B');
  });
});

describe('buildManualOrderCardResourceSubtitleParts', () => {
  it('displayName・resourceCd を trim', () => {
    const p = buildManualOrderCardResourceSubtitleParts({
      resourceCd: ' 305 ',
      assignedCount: 4,
      displayName: ' ラインA '
    });
    expect(p).toEqual({ displayName: 'ラインA', resourceCd: '305', assignedCount: 4 });
  });

  it('件数が非有限のときは 0', () => {
    const p = buildManualOrderCardResourceSubtitleParts({
      resourceCd: 'MSZ',
      assignedCount: Number.NaN,
      displayName: ''
    });
    expect(p.assignedCount).toBe(0);
  });
});
