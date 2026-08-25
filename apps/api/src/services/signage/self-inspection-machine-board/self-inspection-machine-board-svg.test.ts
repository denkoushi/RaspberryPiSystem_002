import { describe, expect, it } from 'vitest';

import type {
  SelfInspectionMachineBoardResourceProgress,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  buildSelfInspectionMachineBoardPageCapNotes,
  statusColor,
  statusLabel,
} from './self-inspection-machine-board-format.js';
import { buildSelfInspectionMachineBoardSummarySvg } from './self-inspection-machine-board-svg.js';

type DisplayResource = SelfInspectionMachineBoardResourceProgress & {
  resourceDisplayName?: string;
};

function makeResource(
  resourceCd: string,
  resourceDisplayName?: string
): DisplayResource {
  return {
    resourceCd,
    resourceDisplayName,
    confirmedEntryCount: 1,
    completedEntryCount: 1,
    requiredEntryCount: 2,
    progressLabel: '1/2',
    status: 'in_progress',
    outcome: 'in_progress',
    scheduleRowIds: ['row-1'],
  } as DisplayResource;
}

function makeSummaryPage(resources: DisplayResource[]): SelfInspectionMachineBoardSummaryPage {
  return {
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
            resources,
            resourceCds: resources.map((resource) => resource.resourceCd),
            scheduleRowIds: ['row-1'],
          },
        ],
      },
    ],
    unscheduled: [],
    pageIndex: 0,
    pageCount: 2,
  };
}

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
                resources: [makeResource('R01', '立型')],
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
    expect(svg).toContain('>2026/06/09 10:02</text>');
    expect(svg).not.toContain('更新 2026/06/09 10:02');
    expect(svg).toContain('1 / 2');
    expect(svg).toContain('S-1');
    expect(svg).toContain('品名A');
    expect(svg).toContain('L300KP');
    expect(svg).toContain('立型');
    expect(svg).not.toContain('製番 ');
    expect(svg).not.toContain('品名 ');
    expect(svg).not.toContain('機種名 ');
    expect(svg).not.toContain('資源CD ');
    expect(svg).not.toContain('R01');
    expect(svg).toContain('判定待ち');
    expect(svg).not.toContain('P-1-SECRET');
    expect(svg).not.toContain('H-1-SECRET');
    expect(svg).not.toContain('ヒートストリップ');
    expect(svg).not.toContain('凡例');
    expect(svg).toContain('fill="#a855f7"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('font-size="36"');
    expect(svg).toContain('font-size="31"');
    expect(svg).toContain('font-size="27"');
    expect(svg).toContain('font-size="16"');

    const fseibanX = Number(
      svg.match(/<text x="([\d.]+)" y="150" fill="#ffffff" font-size="36"[^>]*>S-1/)?.[1]
    );
    const machineX = Number(
      svg.match(/<text x="([\d.]+)" y="150" fill="#ffffff" font-size="16"[^>]*>L300KP/)?.[1]
    );
    const dateX = Number(
      svg.match(/<text x="([\d.]+)" y="150" fill="#ffffff" font-size="27"[^>]*>2026\/06\/09 10:02/)?.[1]
    );
    const badgeX = Number(svg.match(/<rect x="([\d.]+)" y="112" width="112" height="32"/)?.[1]);
    const progressBar = svg.match(
      /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="[\d.]+" fill="#1e293b" \/>/
    );
    expect(machineX - fseibanX).toBeCloseTo(96.8, 5);
    expect(dateX).toBeLessThan(badgeX);
    expect(Number(progressBar?.[1])).toBeGreaterThan(425);
    expect(Number(progressBar?.[2])).toBeCloseTo(432 * 0.7, 0);
  });

  it('uses a card update timestamp when one is available', () => {
    const page = makeSummaryPage([makeResource('R01', '立型')]);
    const card = page.scheduled[0]?.parts[0];
    expect(card).toBeDefined();
    Object.assign(card!, {
      updatedAt: new Date(2026, 5, 10, 11, 3, 4),
    });

    const svg = buildSelfInspectionMachineBoardSummarySvg(page, 1920, 1080);

    expect(svg).toContain('>2026/06/10 11:03</text>');
    expect(svg).not.toContain('>2026/06/09 10:02</text>');
  });

  it('renders fallback, joined display names, and width-based ellipsis without resource CDs', () => {
    const longName = '立型加工機名称が画面幅を超える長い表示名ですABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const svg = buildSelfInspectionMachineBoardSummarySvg(
      makeSummaryPage([
        makeResource('R-MULTI', '立型 · 立型予備'),
        makeResource('R-MISSING'),
        makeResource('R-LONG', longName),
      ]),
      1920,
      1080
    );

    expect(svg).toContain('立型 · 立型予備');
    expect(svg).toContain('名称未登録');
    expect(svg).toContain('…');
    expect(svg).not.toContain('R-MULTI');
    expect(svg).not.toContain('R-MISSING');
    expect(svg).not.toContain('R-LONG');

    const resourceYs = [...svg.matchAll(/<text x="44" y="([\d.]+)" fill="#ffffff" font-size="31"/g)].map(
      (match) => Number(match[1])
    );
    expect(resourceYs).toHaveLength(3);
    expect(resourceYs[1]! - resourceYs[0]!).toBeGreaterThanOrEqual(36);
    expect(resourceYs[2]! - resourceYs[1]!).toBeGreaterThanOrEqual(36);
  });

  it('uses the fixed Japanese status labels', () => {
    expect(statusLabel('pass')).toBe('合格');
    expect(statusLabel('completed')).toBe('合格');
    expect(statusLabel('rejected')).toBe('不合格');
    expect(statusLabel('pending')).toBe('判定待ち');
    expect(statusLabel('review_pending')).toBe('判定待ち');
    expect(statusLabel('in_progress')).toBe('検査中');
    expect(statusLabel('not_started')).toBe('未検査');
    expect(statusColor('review_pending')).toBe('#a855f7');
  });

  it('shows the kiosk active-session limit without the legacy schedule-row wording', () => {
    const page = makeSummaryPage([makeResource('R01', '立型')]);
    Object.assign(page, {
      scheduleRowCap: 200,
      scheduleRowHasMore: true,
      activeSessionLimit: 200,
      activeSessionHasMore: true,
    });
    const note = buildSelfInspectionMachineBoardPageCapNotes(page);
    const svg = buildSelfInspectionMachineBoardSummarySvg(page, 1920, 1080);

    expect(note).toContain('最新200件を表示・続きあり');
    expect(note).not.toContain('日程上限');
    expect(svg).toContain('最新200件を表示・続きあり');
    expect(svg).not.toContain('日程上限');
  });
});
