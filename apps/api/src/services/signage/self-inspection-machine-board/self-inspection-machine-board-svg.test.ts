import { describe, expect, it } from 'vitest';

import { statusLabel } from './self-inspection-machine-board-format.js';
import { buildSelfInspectionMachineBoardSummarySvg } from './self-inspection-machine-board-svg.js';

describe('self-inspection-machine-board SVG', () => {
  it('renders the compact two-column card contract', () => {
    const svg = buildSelfInspectionMachineBoardSummarySvg(
      {
        kind: 'summary',
        machineName: 'L300KP',
        updatedAt: new Date(2026, 5, 9, 10, 2, 0),
        scheduled: [
          {
            fseiban: 'S-1',
            dueDate: null,
            parts: [
              {
                scheduleRowId: 'row-1',
                cardKey: 'L300KP::S-1::P-1::H-1::L300KP',
                fseiban: 'S-1',
                productNo: 'P-1-SECRET',
                fhincd: 'H-1-SECRET',
                fhinmei: '品名A',
                machineName: 'L300KP',
                normalizedMachineName: 'L300KP',
                status: 'pending',
                outcome: 'pending',
                completedEntryCount: 1,
                requiredEntryCount: 2,
                progressLabel: '1/2',
                dueDate: null,
                isScheduled: false,
                resources: [
                  {
                    resourceCd: 'R01',
                    confirmedEntryCount: 1,
                    completedEntryCount: 1,
                    requiredEntryCount: 2,
                    progressLabel: '1/2',
                    status: 'in_progress',
                    outcome: 'in_progress',
                    scheduleRowIds: ['row-1'],
                  },
                ],
                resourceCds: ['R01'],
                scheduleRowIds: ['row-1'],
              },
            ],
          },
        ],
        unscheduled: [],
        pageIndex: 0,
        pageCount: 2,
      },
      1920,
      1080
    );

    expect(svg).toContain('自主検査 部品別進捗');
    expect(svg).toContain('更新 2026/06/09 10:02');
    expect(svg).toContain('1 / 2');
    expect(svg).toContain('製番 S-1');
    expect(svg).toContain('品名 品名A');
    expect(svg).toContain('機種名 L300KP');
    expect(svg).toContain('資源CD R01');
    expect(svg).toContain('判定待ち');
    expect(svg).not.toContain('P-1-SECRET');
    expect(svg).not.toContain('H-1-SECRET');
    expect(svg).not.toContain('ヒートストリップ');
    expect(svg).not.toContain('凡例');
    expect(svg).toContain('fill="#a855f7"');
    expect(svg).toContain('fill="#64748b"');
  });

  it('uses the fixed Japanese status labels', () => {
    expect(statusLabel('pass')).toBe('合格');
    expect(statusLabel('completed')).toBe('合格');
    expect(statusLabel('rejected')).toBe('不合格');
    expect(statusLabel('pending')).toBe('判定待ち');
    expect(statusLabel('review_pending')).toBe('判定待ち');
    expect(statusLabel('in_progress')).toBe('検査中');
    expect(statusLabel('not_started')).toBe('未検査');
  });
});
