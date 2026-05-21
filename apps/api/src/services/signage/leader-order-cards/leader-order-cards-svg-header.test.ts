import { describe, expect, it } from 'vitest';

import { buildLeaderOrderCardHeaderSvgFragment } from './leader-order-cards-svg-header.js';

describe('leader-order-cards-svg-header', () => {
  it('renders resource CD and full Japanese machine name on one line without ellipsis', () => {
    const name = '立型(FJV50/80) MT-2α';
    const svg = buildLeaderOrderCardHeaderSvgFragment({
      xCardLeft: 0,
      yCardTop: 0,
      cardPad: 6,
      titleFs: 24,
      subFs: 16,
      innerWidthPx: 360,
      resourceCd: '060',
      resourceJapaneseNamesTrimmed: name,
    });
    expect(svg).toContain('060');
    expect(svg).not.toContain('…');
    expect(svg).toContain(name);
    expect(svg.match(/<text/g)?.length).toBe(2);
  });

  it('renders resource CD only when Japanese name is empty', () => {
    const svg = buildLeaderOrderCardHeaderSvgFragment({
      xCardLeft: 0,
      yCardTop: 0,
      cardPad: 6,
      titleFs: 24,
      subFs: 16,
      innerWidthPx: 360,
      resourceCd: '501',
      resourceJapaneseNamesTrimmed: '',
    });
    expect(svg).toContain('501');
    expect(svg.match(/<text/g)?.length).toBe(1);
  });
});
