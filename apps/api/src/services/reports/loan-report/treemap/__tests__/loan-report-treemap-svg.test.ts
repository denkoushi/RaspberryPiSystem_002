import { describe, expect, it } from 'vitest';

import { layoutSupplyTreemap } from '../loan-report-treemap-layout.js';
import { buildEmptySupplyTreemapSvg, buildSupplyTreemapSvg } from '../loan-report-treemap-svg.js';

describe('buildSupplyTreemapSvg', () => {
  it('contains svg markers and escaped text', () => {
    const { cellRects, options } = layoutSupplyTreemap([{ name: 'ノギス', o: 1, t: 3 }]);
    const svg = buildSupplyTreemapSvg({
      sectorTitle: '計測機器（名寄せ）',
      cellRects,
      options,
    });
    expect(svg).toContain('supply-treemap-svg');
    expect(svg).toContain('計測機器（名寄せ）');
    expect(svg).toContain('ノギス');
    expect(svg).toContain('1 / 3');
  });
});

describe('buildEmptySupplyTreemapSvg', () => {
  it('renders placeholder', () => {
    const svg = buildEmptySupplyTreemapSvg({
      width: 320,
      height: 118,
      padding: 4,
      genreGap: 4,
      itemGap: 1.5,
      genreLabelHeight: 16,
    });
    expect(svg).toContain('名寄せデータなし');
  });
});
