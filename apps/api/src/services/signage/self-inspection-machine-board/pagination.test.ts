import { describe, expect, it } from 'vitest';

import type { SelfInspectionMachineBoardResourceProgress } from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  buildFlatMachineBoardPages,
  groupPartsBySeiban,
  paginateSelfInspectionMachineBoardParts,
  sanitizeSelfInspectionMachineBoardDetailTopN,
  sanitizeSelfInspectionMachineBoardPartsPerPage,
  summaryPartsPageCount,
} from './pagination.js';
import { buildSelfInspectionMachineBoardSummarySvg } from './self-inspection-machine-board-svg.js';
import { maxSelfInspectionMachineBoardResourcesPerCard } from './self-inspection-machine-board-layout.js';

type DisplayResource = SelfInspectionMachineBoardResourceProgress & {
  resourceDisplayName?: string;
};

describe('self-inspection-machine-board pagination', () => {
  it('sanitizes partsPerPage and detailTopN', () => {
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(Number.NaN)).toBe(6);
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(0)).toBe(1);
    expect(sanitizeSelfInspectionMachineBoardPartsPerPage(999)).toBe(6);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(Number.NaN)).toBe(5);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(-1)).toBe(0);
    expect(sanitizeSelfInspectionMachineBoardDetailTopN(99)).toBe(20);
  });

  it('builds flat card pages without detail heatstrip pages', () => {
    const parts = Array.from({ length: 5 }, (_, index) => ({
      scheduleRowId: `row-${index}`,
      fseiban: `S-${index % 2}`,
      productNo: `P-${index}`,
      fhincd: `H-${index}`,
      fhinmei: `Name-${index}`,
      status: 'not_started' as const,
      completedEntryCount: 0,
      requiredEntryCount: 3,
      progressLabel: '0/3',
      dueDate: index % 2 === 0 ? new Date('2026-06-01T00:00:00Z') : null,
      isScheduled: index % 2 === 0,
    }));

    const pages = buildFlatMachineBoardPages({
      machineName: 'L300KP',
      updatedAt: new Date('2026-06-08T00:00:00Z'),
      orderedParts: parts,
      detailPages: [
        {
          kind: 'detail',
          machineName: 'L300KP',
          updatedAt: new Date('2026-06-08T00:00:00Z'),
          fseiban: 'S-0',
          fhincd: 'H-0',
          fhinmei: 'Name-0',
          status: 'in_progress',
          progressLabel: '1/3',
          measurementPoints: [],
          pageIndex: 0,
          pageCount: 0,
        },
      ],
      partsPerPage: 2,
    });

    expect(summaryPartsPageCount(parts.length, 2)).toBe(3);
    expect(pages).toHaveLength(3);
    expect(pages[0]?.kind).toBe('summary');
    expect(pages.every((page) => page.kind === 'summary')).toBe(true);
    expect(pages[2]?.pageCount).toBe(3);
  });

  it('uses the larger card in each row and keeps oversized resources in continuation cards', () => {
    const resources: DisplayResource[] = Array.from({ length: 40 }, (_, index) => ({
      resourceCd: `R${index + 1}`,
      resourceDisplayName: `資源${index + 1}`,
      confirmedEntryCount: 1,
      completedEntryCount: 1,
      requiredEntryCount: 2,
      progressLabel: '1/2',
      status: 'in_progress' as const,
      outcome: 'in_progress' as const,
      scheduleRowIds: ['row-tall'],
    }));
    const tall = {
      scheduleRowId: 'row-tall',
      fseiban: 'S-TALL',
      productNo: 'P-TALL',
      fhincd: 'H-TALL',
      fhinmei: 'Tall',
      status: 'in_progress' as const,
      completedEntryCount: 40,
      requiredEntryCount: 80,
      progressLabel: '40/80',
      dueDate: null,
      isScheduled: false,
      resources,
      resourceCds: resources.map((resource) => resource.resourceCd),
    };
    const short = {
      ...tall,
      scheduleRowId: 'row-short',
      fseiban: 'S-SHORT',
      productNo: 'P-SHORT',
      fhincd: 'H-SHORT',
      fhinmei: 'Short',
      completedEntryCount: 1,
      requiredEntryCount: 1,
      progressLabel: '1/1',
      resources: resources.slice(0, 1),
      resourceCds: ['R1'],
    };

    const pages = buildFlatMachineBoardPages({
      machineName: 'L300KP',
      updatedAt: new Date('2026-06-08T00:00:00Z'),
      orderedParts: [tall, short],
      detailPages: [],
      partsPerPage: 6,
    });
    const pageParts = pages.flatMap((page) =>
      page.kind === 'summary'
        ? [...page.scheduled, ...page.unscheduled].flatMap((group) => group.parts)
        : []
    );
    expect(pages.length).toBeGreaterThan(1);
    const tallParts = pageParts.filter((part) => part.fseiban === 'S-TALL');
    expect(tallParts.flatMap((part) => part.resources ?? [])).toHaveLength(40);
    expect(tallParts.map((part) => [part.continuationIndex, part.continuationCount, part.isContinuation])).toEqual([
      [1, 2, false],
      [2, 2, true],
    ]);
    const continuationPage = pages.find(
      (page) =>
        page.kind === 'summary' &&
        [...page.scheduled, ...page.unscheduled].some((group) =>
          group.parts.some((part) => part.isContinuation)
        )
    );
    expect(continuationPage).toBeDefined();
    const continuationSvg = buildSelfInspectionMachineBoardSummarySvg(
      continuationPage!,
      1920,
      1080
    );
    expect(continuationSvg).toContain('続き 2/2');
    expect(continuationSvg).toContain('資源36');
    expect(continuationSvg).not.toContain('R36');
    expect(pageParts.some((part) => part.fseiban === 'S-SHORT')).toBe(true);
  });

  it('splits exactly after the readable resource-row capacity', () => {
    expect(maxSelfInspectionMachineBoardResourcesPerCard()).toBe(21);

    const makePart = (fseiban: string, resourceCount: number) => {
      const resources: DisplayResource[] = Array.from({ length: resourceCount }, (_, index) => ({
        resourceCd: `${fseiban}-R${index + 1}`,
        resourceDisplayName: `${fseiban}資源${index + 1}`,
        confirmedEntryCount: 1,
        completedEntryCount: 1,
        requiredEntryCount: 1,
        progressLabel: '1/1',
        status: 'in_progress',
        outcome: 'in_progress',
        scheduleRowIds: [`${fseiban}-row`],
      }));
      return {
        scheduleRowId: `${fseiban}-row`,
        fseiban,
        productNo: `${fseiban}-product`,
        fhincd: `${fseiban}-part`,
        fhinmei: fseiban,
        status: 'in_progress' as const,
        completedEntryCount: resourceCount,
        requiredEntryCount: resourceCount,
        progressLabel: `${resourceCount}/${resourceCount}`,
        dueDate: null,
        isScheduled: false,
        resources,
        resourceCds: resources.map((resource) => resource.resourceCd),
      };
    };

    const pages = paginateSelfInspectionMachineBoardParts({
      orderedParts: [makePart('S-21', 21), makePart('S-22', 22)],
      partsPerPage: 6,
    });
    const fragments = pages.flat();

    expect(fragments.filter((part) => part.fseiban === 'S-21')).toHaveLength(1);
    expect(fragments.filter((part) => part.fseiban === 'S-22')).toHaveLength(2);
    expect(
      fragments
        .filter((part) => part.fseiban === 'S-22')
        .map((part) => part.resources?.length)
    ).toEqual([21, 1]);
    expect(
      fragments
        .filter((part) => part.fseiban === 'S-22')
        .map((part) => [part.continuationIndex, part.continuationCount, part.isContinuation])
    ).toEqual([
      [1, 2, false],
      [2, 2, true],
    ]);
  });

  it('groups page parts by seiban and scheduled flag', () => {
    const grouped = groupPartsBySeiban([
      {
        scheduleRowId: 'a',
        fseiban: 'S1',
        productNo: 'P1',
        fhincd: 'H1',
        fhinmei: 'N1',
        status: 'completed',
        completedEntryCount: 2,
        requiredEntryCount: 2,
        progressLabel: '2/2',
        dueDate: new Date('2026-06-02T00:00:00Z'),
        isScheduled: true,
      },
      {
        scheduleRowId: 'b',
        fseiban: 'S2',
        productNo: 'P2',
        fhincd: 'H2',
        fhinmei: 'N2',
        status: 'not_started',
        completedEntryCount: 0,
        requiredEntryCount: 1,
        progressLabel: '0/1',
        dueDate: null,
        isScheduled: false,
      },
    ]);

    expect(grouped.scheduled).toHaveLength(1);
    expect(grouped.unscheduled).toHaveLength(1);
  });
});
