import { describe, expect, it } from 'vitest';
import { planMiInspectionCardPlacements } from '../renderers/measuring-instrument-loan-inspection/card-layout.js';
import { MI_INSTRUMENT_DETAIL_COLUMN } from '../renderers/measuring-instrument-loan-inspection/mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from '../renderers/measuring-instrument-loan-inspection/row-priority.js';
import { sortRowsForDisplay } from '../renderers/measuring-instrument-loan-inspection/row-priority.js';

function row(
  name: string,
  count: number,
  names: string,
): MiLoanInspectionTableRow {
  return {
    従業員名: name,
    点検件数: 0,
    貸出中計測機器数: count,
    計測機器名称一覧: names,
  };
}

describe('sortRowsForDisplay', () => {
  it('groups active loans first, then by count desc, then by name', () => {
    const input = [
      row('山田', 1, 'A'),
      row('佐藤', 0, ''),
      row('鈴木', 2, 'B, C'),
      row('田中', 2, 'D'),
      row('高橋', 0, ''),
    ];
    const sorted = sortRowsForDisplay(input);
    // 同件数帯は氏名 `localeCompare('ja')` 順（環境一貫のため実測に合わせる）
    expect(sorted.map((r) => String(r['従業員名']))).toEqual(['田中', '鈴木', '山田', '高橋', '佐藤']);
  });
});

describe('planMiInspectionCardPlacements', () => {
  it('places cards without vertical overlap within the area', () => {
    const scale = 960 / 1920;
    const padding = Math.round(12 * scale);
    const cardGap = Math.round(12 * scale);
    const numColumns = 4;
    const width = 960;
    const cardsTop = 80;
    const cardsAreaHeight = 600;
    const cardsAreaWidth = width - padding * 2;
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const rows = [
      row('A', 1, 'デジタルノギス (X1)'),
      row('B', 0, ''),
      row('C', 2, 'トルクレンチ (Y1), メーター (Y2)'),
    ];
    const { placements } = planMiInspectionCardPlacements({
      rows,
      cardsTop,
      cardsAreaHeight,
      padding,
      cardWidth,
      cardGap,
      numColumns,
      scale,
    });
    expect(placements.length).toBeGreaterThan(0);
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i]!;
        const b = placements[j]!;
        const aRight = a.x + a.width;
        const aBottom = a.y + a.height;
        const bRight = b.x + b.width;
        const bBottom = b.y + b.height;
        const hOverlap = a.x < bRight && b.x < aRight;
        const vOverlap = a.y < bBottom && b.y < aBottom;
        expect(hOverlap && vOverlap).toBe(false);
      }
    }
  });

  it('gives empty-loan cards a height not greater than active cards with multiple lines', () => {
    const scale = 1;
    const padding = 12;
    const cardGap = 12;
    const numColumns = 4;
    const width = 1920;
    const cardsTop = 100;
    const cardsAreaHeight = 900;
    const cardsAreaWidth = width - padding * 2;
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const longList = Array.from({ length: 12 }, (_, i) => `機器${i + 1} (K${String(i + 1).padStart(4, '0')})`).join(
      ', ',
    );
    const rows = [row('Empty1', 0, ''), row('Active1', 12, longList)];
    const { placements } = planMiInspectionCardPlacements({
      rows,
      cardsTop,
      cardsAreaHeight,
      padding,
      cardWidth,
      cardGap,
      numColumns,
      scale,
    });
    const emptyP = placements.find((p) => String(p.row['従業員名']) === 'Empty1');
    const activeP = placements.find((p) => String(p.row['従業員名']) === 'Active1');
    expect(emptyP).toBeDefined();
    expect(activeP).toBeDefined();
    expect(emptyP!.height).toBeLessThan(activeP!.height);
  });

  it('includes returned-only body lines (muted) when 貸出中 is 0 but JSON has returned', () => {
    const scale = 1;
    const padding = 12;
    const cardGap = 12;
    const numColumns = 4;
    const width = 1920;
    const cardsTop = 100;
    const cardsAreaHeight = 900;
    const cardsAreaWidth = width - padding * 2;
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const rows: MiLoanInspectionTableRow[] = [
      {
        従業員名: '返却のみ',
        点検件数: 0,
        貸出中計測機器数: 0,
        返却件数: 1,
        計測機器名称一覧: 'ノギス (Z1)',
        [MI_INSTRUMENT_DETAIL_COLUMN]: JSON.stringify([
          { kind: 'returned', managementNumber: 'Z1', name: 'ノギス' },
        ]),
      },
    ];
    const { placements } = planMiInspectionCardPlacements({
      rows,
      cardsTop,
      cardsAreaHeight,
      padding,
      cardWidth,
      cardGap,
      numColumns,
      scale,
    });
    const p = placements[0];
    expect(p).toBeDefined();
    expect(p!.bodyLines.some((l) => l.tone === 'muted' && !l.isSpacer)).toBe(true);
  });
});
