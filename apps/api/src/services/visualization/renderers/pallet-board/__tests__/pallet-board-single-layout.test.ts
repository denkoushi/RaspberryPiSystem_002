import { describe, expect, it } from 'vitest';
import { createMd3Tokens } from '../../_design-system/index.js';
import { buildSingleMachinePalletBoardSvg } from '../pallet-board-single-layout.js';

describe('buildSingleMachinePalletBoardSvg', () => {
  it('品目ありスロットの SVG に下段4行用の等間隔 x が繰り返し含まれる（全幅揃え）', () => {
    const t = createMd3Tokens({ width: 1920, height: 1080 });
    const svg = buildSingleMachinePalletBoardSvg({
      width: 1920,
      height: 1080,
      t,
      title: 'T',
      subtitle: '',
      machine: {
        machineCd: 'M1',
        machineName: 'Machine 1',
        illustrationUrl: null,
        pallets: [
          {
            palletNo: 2,
            lines: ['line'],
            isEmpty: false,
            primaryItem: {
              fhincd: 'C1',
              fhinmei: '部品',
              fseiban: 'S1-ORDER',
              machineNameDisplay: '機種名テスト',
              plannedStartDateDisplay: '4/1',
              plannedQuantity: 3,
            },
          },
        ],
      },
      leftPanelImageDataUri: null,
      cardThumbDataUri: null,
    });
    // 4 行とも fullWidthX（bx+8）始まり: 同じ数値の <text x="..."> を複数行で含む
    // 単一加工機1スロット時: 先頭にボード他テキストあり。ネスト<g>内の <text> は子SVGで拾うため
    // 文書順の末尾4つ＝下段4明細（fseiban〜着手）の <text> が同一 x（fullWidthX）
    const allTextXs = Array.from(svg.matchAll(/<text x="([0-9.]+)"/g), (m) => m[1]);
    const detailXs = allTextXs.slice(-4);
    expect(detailXs.length).toBe(4);
    expect(new Set(detailXs).size).toBe(1);
  });
});
