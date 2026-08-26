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
    updatedAt: new Date('2026-06-09T01:02:00.000Z'),
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
        updatedAt: new Date('2026-06-09T01:02:00.000Z'),
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
      svg.match(/<text x="([\d.]+)" y="136" fill="#ffffff" font-size="36"[^>]*>S-1/)?.[1]
    );
    const machineX = Number(
      svg.match(/<text x="([\d.]+)" y="136" fill="#ffffff" font-size="16"[^>]*>L300KP/)?.[1]
    );
    const dateX = Number(
      svg.match(/<text x="([\d.]+)" y="136" fill="#ffffff" font-size="27"[^>]*>2026\/06\/09 10:02/)?.[1]
    );
    const badgeX = Number(svg.match(/<rect x="([\d.]+)" y="120" width="112" height="32"/)?.[1]);
    const progressBar = svg.match(
      /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="[\d.]+" fill="#1e293b" \/>/
    );
    expect(machineX - fseibanX).toBeCloseTo(96.8, 5);
    expect(dateX).toBeLessThan(badgeX);
    expect(Number(progressBar?.[1])).toBeGreaterThan(425);
    expect(Number(progressBar?.[2])).toBeCloseTo(432 * 0.7, 0);

    expect(svg).toContain(
      'font-size="36" font-family="sans-serif" font-weight="700" dominant-baseline="middle">S-1'
    );
    expect(svg).toContain(
      'font-size="16" font-family="sans-serif" dominant-baseline="middle">L300KP'
    );
    expect(svg).toContain(
      'font-size="27" font-family="sans-serif" text-anchor="end" dominant-baseline="middle">2026/06/09 10:02'
    );
    expect(svg).toContain(
      'font-size="16" font-family="sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">判定待ち'
    );
  });

  it('renders standard 40px resource rows with centered text, bar, and count', () => {
    const svg = buildSelfInspectionMachineBoardSummarySvg(
      makeSummaryPage([makeResource('R01', '立型')]),
      1920,
      1080
    );
    const resourceY = Number(
      svg.match(/<text x="44" y="([\d.]+)" fill="#ffffff" font-size="31"/)?.[1]
    );
    const progressY = Number(
      svg.match(/<text x="935" y="([\d.]+)" fill="#ffffff" font-size="36"/)?.[1]
    );
    const barY = Number(
      svg.match(/<rect x="536" y="([\d.]+)" width="[\d.]+" height="13"/)?.[1]
    );

    expect(resourceY).toBe(228);
    expect(progressY).toBe(resourceY);
    expect(barY).toBe(221);
  });

  it('renders minimum 36px resource rows without clipping', () => {
    const resources = Array.from({ length: 21 }, (_, index) =>
      makeResource(`R${index + 1}`, `立型${index + 1}`)
    );
    const svg = buildSelfInspectionMachineBoardSummarySvg(makeSummaryPage(resources), 1920, 1008);
    const resourceYs = [
      ...svg.matchAll(/<text x="44" y="([\d.]+)" fill="#ffffff" font-size="31"/g),
    ].map((match) => Number(match[1]));
    const barYs = [
      ...svg.matchAll(
        /<rect x="536" y="([\d.]+)" width="[\d.]+" height="12" rx="[\d.]+" fill="#1e293b" \/>/g
      ),
    ].map((match) => Number(match[1]));

    expect(resourceYs).toHaveLength(21);
    expect(barYs).toHaveLength(21);
    expect(resourceYs[0]).toBe(226);
    expect(resourceYs[20]).toBe(946);
    expect(barYs[0]).toBe(220);
    expect(barYs[20]).toBe(940);
    expect(barYs[20]! + 12).toBeLessThanOrEqual(952);
  });

  it('centers the smaller resource block inside equalized left/right SVG cards', () => {
    const page = makeSummaryPage([makeResource('LEFT-R01', '左資源')]);
    const leftPart = page.scheduled[0]!.parts[0]!;
    const rightResources = [
      makeResource('RIGHT-R01', '右資源1'),
      makeResource('RIGHT-R02', '右資源2'),
      makeResource('RIGHT-R03', '右資源3'),
    ];
    page.scheduled[0]!.parts = [
      leftPart,
      {
        ...leftPart,
        scheduleRowId: 'row-2',
        cardKey: 'L300KP::S-2::P-2::H-2::L300KP',
        fseiban: 'S-2',
        fhinmei: '品名B',
        resources: rightResources,
        resourceCds: rightResources.map((resource) => resource.resourceCd),
      },
    ];

    const svg = buildSelfInspectionMachineBoardSummarySvg(page, 1920, 1080);
    const cardGroups = [...svg.matchAll(/<g data-simb-card="true">([\s\S]*?)<\/g>/g)].map(
      (match) => match[1] ?? ''
    );
    const leftResourceY = Number(
      cardGroups[0]?.match(/<text x="44" y="([\d.]+)" fill="#ffffff" font-size="31"/)?.[1]
    );
    const rightResourceYs = [
      ...(cardGroups[1]?.matchAll(
        /<text x="985" y="([\d.]+)" fill="#ffffff" font-size="31"/g
      ) ?? []),
    ].map((match) => Number(match[1]));

    expect(cardGroups).toHaveLength(2);
    expect(leftResourceY).toBe(268);
    expect(rightResourceYs).toEqual([228, 268, 308]);
    expect(leftResourceY - rightResourceYs[0]!).toBe(40);
  });

  it('uses a card update timestamp when one is available', () => {
    const page = makeSummaryPage([makeResource('R01', '立型')]);
    const card = page.scheduled[0]?.parts[0];
    expect(card).toBeDefined();
    Object.assign(card!, {
      updatedAt: new Date('2026-06-10T02:03:04.000Z'),
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
