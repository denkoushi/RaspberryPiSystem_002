import { describe, expect, it } from 'vitest';

import { buildLeaderOrderCardsSvg } from './build-leader-order-cards-svg.js';
import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';

describe('buildLeaderOrderCardsSvg', () => {
  it('renders kiosk-aligned row layout (cluster line, seiban accent, no due badge pill)', () => {
    const cards: LeaderOrderCardViewModel[] = [
      {
        resourceCd: '060',
        resourceJapaneseNames: '旋盤 1号機',
        rows: [
          {
            fkojun: '010 / 切削',
            dueLabel: '1/6(火)',
            manualDue: true,
            fseiban: 'BA1S1319',
            seibanAccentHex: '#fbbf24',
            clusterSegments: ['BA1S1319', 'MH-2044'],
            customerLine: '',
            machineTypeNameLine: 'L300KP',
            partNameLine: 'ストッパー台',
            quantityInlineJa: '8個',
            isCompleted: false,
            hasManualOrder: true,
            footerChips: [{ rowId: 'c1', resourceCd: '080', isCompleted: false }],
          },
          {
            fkojun: '020 / 仕上',
            dueLabel: '1/8(木)',
            manualDue: false,
            fseiban: 'BA1S1320',
            seibanAccentHex: '#2dd4bf',
            clusterSegments: ['BA1S1320'],
            customerLine: '',
            machineTypeNameLine: 'L300KP',
            partNameLine: 'カバー',
            quantityInlineJa: null,
            isCompleted: false,
            hasManualOrder: false,
            footerChips: [],
          },
        ],
      },
    ];

    const svg = buildLeaderOrderCardsSvg(cards, 1920, 1080);
    expect(svg).toContain('rgba(71, 85, 105, 0.82)');
    expect(svg).toContain('rgba(30, 41, 59, 0.8)');
    expect(svg).toContain('BA1S1319');
    expect(svg).toContain('#fbbf24');
    expect(svg).toContain('8個');
    expect(svg).toContain('1/6(火)');
    expect(svg).not.toContain('LEADER_ORDER_SVG_BADGE_FILL');
    expect(svg).not.toContain('010 / 切削');
    expect(svg).toContain('080');
  });
});
