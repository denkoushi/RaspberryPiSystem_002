import { describe, expect, it } from 'vitest';
import { createMd3Tokens } from '../../_design-system/index.js';
import { palletBoardSignageColor } from '../pallet-board-appearance.js';
import { buildSingleMachinePalletBoardSvg } from '../pallet-board-single-layout.js';

describe('buildSingleMachinePalletBoardSvg', () => {
  it('シングル占用スロットに品番／品名同行と製番／着手バッジ／個数メタが現れる', () => {
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

    expect(svg).toContain('>C1<');
    expect(svg).toContain('>部品<');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain(palletBoardSignageColor.metaPlainTeal);
    expect(svg).toContain(`fill="${palletBoardSignageColor.badgeFill}"`);
    expect(svg).toContain('>3個<');
    expect(/S1/.test(svg) || /\u2026/.test(svg)).toBe(true);
  });

  it('プライマリ＋セカンダリ時は縦セパ線（破線 horizontal line）が入る', () => {
    const t = createMd3Tokens({ width: 1920, height: 1080 });
    const svg = buildSingleMachinePalletBoardSvg({
      width: 1920,
      height: 1080,
      t,
      title: '',
      subtitle: '',
      machine: {
        machineCd: 'M1',
        machineName: 'M',
        illustrationUrl: null,
        pallets: [
          {
            palletNo: 1,
            lines: [],
            primaryItem: {
              fhincd: 'CA',
              fhinmei: 'A',
              fseiban: 'SA',
              machineNameDisplay: null,
              plannedStartDateDisplay: '1/1',
              plannedQuantity: 1,
            },
            secondaryItem: {
              fhincd: 'CB',
              fhinmei: 'B',
              fseiban: 'SB',
              machineNameDisplay: null,
              plannedStartDateDisplay: '2/2',
              plannedQuantity: 2,
            },
          },
        ],
      },
      leftPanelImageDataUri: null,
      cardThumbDataUri: null,
    });

    expect(svg.includes('stroke-dasharray="4 3"')).toBe(true);
    expect(svg).toContain('>CB<');
  });
});
