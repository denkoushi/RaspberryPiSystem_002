import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

import { act, render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { expect, it, vi } from 'vitest';

import { buildForwardPlanningBoardGanttLayout } from '../gantt/planningBoardGanttLayout';
import { PlanningBoardGanttView } from '../gantt/PlanningBoardGanttView';

import { productionFixture } from './fixture';
import { useDueSortHarness } from './harness';

import type { GanttLayout } from '../gantt/planningBoardGanttLayout';
import type { GrindingPlanningBoardResourceOrderResponse } from '@raspi-system/shared-types';
import type { ComponentProps } from 'react';

const stats = vi.hoisted(() => ({ rowRenders: 0, insideQueue: false, stateUpdates: 0, queueUpdates: 0, layouts: [] as number[], applies: [] as number[], commits: [] as { stateUpdates: number; queueUpdates: number; layouts: number }[] }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: ((initial: unknown) => {
    const [value, setValue] = react.useState(initial);
    const tracked = stats.insideQueue;
    return [value, react.useCallback((next: unknown) => { stats.stateUpdates++; if (tracked) stats.queueUpdates++; setValue(next); }, [setValue, tracked])];
  }) as typeof react.useState };
});
vi.mock('../usePlanningBoardWriteQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../usePlanningBoardWriteQueue')>();
  return { ...actual, usePlanningBoardWriteQueue: (...args: Parameters<typeof actual.usePlanningBoardWriteQueue>) => {
    stats.insideQueue = true;
    try { return actual.usePlanningBoardWriteQueue(...args); } finally { stats.insideQueue = false; }
  } };
});
vi.mock('../gantt/planningBoardGanttLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gantt/planningBoardGanttLayout')>();
  return { ...actual, buildPlanningBoardGanttLayout: (...args: Parameters<typeof actual.buildPlanningBoardGanttLayout>) => {
    const start = performance.now();
    const layout = actual.buildPlanningBoardGanttLayout(...args);
    stats.layouts.push(performance.now() - start);
    return layout;
  } };
});
vi.mock('../../../../api/hooks', () => ({
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: vi.fn(), isPending: false, isError: false })
}));
vi.mock('../gantt/PlanningBoardForwardGanttRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gantt/PlanningBoardForwardGanttRow')>();
  const { memo } = await import('react');
  return { ...actual, PlanningBoardForwardGanttRow: memo(function CountedRow(props: ComponentProps<typeof actual.PlanningBoardForwardGanttRow>) {
    stats.rowRenders++;
    return <actual.PlanningBoardForwardGanttRow {...props} />;
  }) };
});

// Disjoint categories add up to the complete element count, including decorative wrappers.
function nodeBreakdown(container: HTMLElement) {
  const counts: Record<string, number> = { dailyGrid: 0, weekendBands: 0, dailyBandWrappers: 0, offHourBands: 0, breakBands: 0, dateHeadings: 0, hourHeadings: 0, laneLabels: 0, barWrappers: 0, barSegments: 0, barContents: 0, sendOutStars: 0, nowLines: 0, connectors: 0, other: 0 };
  for (const node of container.querySelectorAll<HTMLElement>('*')) {
    const testId = node.dataset.testid ?? '';
    let kind = 'other';
    if (testId === 'planning-gantt-break') kind = 'breakBands';
    else if (node.dataset.ganttDecoration) kind = node.dataset.ganttDecoration;
    else if (node.classList.contains('bg-slate-950/55')) kind = 'offHourBands';
    else if (node.parentElement?.hasAttribute('data-gantt-track') && node.className === 'pointer-events-none') kind = 'dailyBandWrappers';
    else if (node.classList.contains('border-dotted') && node.classList.contains('top-9')) kind = 'connectors';
    else if (testId === 'planning-gantt-now') kind = 'nowLines';
    else if (node.closest('[data-testid^="planning-gantt-send-out"]')) kind = 'sendOutStars';
    else if (testId.startsWith('planning-gantt-bar-')) kind = 'barSegments';
    else if (node.closest('[data-testid^="planning-gantt-bar-"]')) kind = 'barContents';
    else if (node.parentElement?.hasAttribute('data-gantt-track') && node.children[0]?.getAttribute('data-testid')?.startsWith('planning-gantt-bar-')) kind = 'barWrappers';
    else if (node.title?.match(/^\d{4}-\d{2}-\d{2}$/)) kind = 'dateHeadings';
    else if (node.parentElement?.title?.match(/^\d{4}-\d{2}-\d{2}$/)) kind = 'hourHeadings';
    else if (node.closest('[data-gantt-lane-label]')) kind = 'laneLabels';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const reset = () => { stats.stateUpdates = 0; stats.queueUpdates = 0; stats.layouts = []; stats.applies = []; stats.commits = []; };

it('measures production-size due sort, real queue commits/layouts and jsdom view', async () => {
  const fixture = productionFixture();
  const layoutSamples: number[] = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    buildForwardPlanningBoardGanttLayout(fixture.options);
    if (i >= 3) layoutSamples.push(performance.now() - start);
  }
  type Phase = { stateUpdates: number; queueUpdates: number; commits: typeof stats.commits; applyMs: number; layoutMs: number };
  const samples: { handlerMs: number; firstDisplayMs: number; initial: Phase; acknowledgementsMs: number;
    all: Phase & { applyCalls: number; layouts: number }; viewMountMs: number; viewUpdateMs: number; viewAcknowledgementMs: number; daysBefore: number; daysAfter: number; nodes: number; segments: number; nodeBreakdown: Record<string, number>; acknowledgementViews: { ms: number; rowRenders: number }[] }[] = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    const requests: { resolve: (result: GrindingPlanningBoardResourceOrderResponse) => void; result: GrindingPlanningBoardResourceOrderResponse }[] = [];
    const originals = new Map(fixture.items.map((item) => [item.itemId, item]));
    const save = vi.fn((request: { resourceCd: string; items: { itemId: string }[] }) => new Promise<GrindingPlanningBoardResourceOrderResponse>((resolve) => {
      requests.push({ resolve, result: { sourceRevision: 'source-0', items: request.items.map(({ itemId }, index) => ({
        ...originals.get(itemId)!, alternateRank: index + 1, version: 2, itemRevision: `saved-${itemId}`
      })) } });
    }));
    const refresh = vi.fn().mockResolvedValue({ isError: false });
    const hook = renderHook(() => {
      const result = useDueSortHarness(fixture, save, refresh, (write) => ({ ...write, apply: (display) => {
        const start = performance.now(); const result = write.apply(display);
        stats.applies.push(performance.now() - start); return result;
      } }));
      useLayoutEffect(() => { stats.commits.push({ stateUpdates: stats.stateUpdates, queueUpdates: stats.queueUpdates, layouts: stats.layouts.length }); });
      return result;
    });
    reset();
    let handlerMs = 0;
    const start = performance.now();
    act(() => { const start = performance.now(); hook.result.current.page.sortResourceOrdersByDue(); handlerMs = performance.now() - start; });
    const firstDisplayMs = performance.now() - start;
    const initial = { stateUpdates: stats.stateUpdates, queueUpdates: stats.queueUpdates, commits: [...stats.commits], applyMs: sum(stats.applies), layoutMs: sum(stats.layouts) };
    const afterItems = hook.result.current.queue.items;
    const afterLayout = hook.result.current.page.ganttLayout;
    const acknowledgementLayouts: GanttLayout[] = [];
    const ackStart = performance.now();
    for (let index = 0; index < requests.length; index++) {
      await act(async () => { requests[index].resolve(requests[index].result); });
      acknowledgementLayouts.push(hook.result.current.page.ganttLayout);
    }
    const acknowledgementsMs = performance.now() - ackStart;
    expect(save).toHaveBeenCalledTimes(20);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current.history[0].orders).toHaveLength(20);
    const all = { stateUpdates: stats.stateUpdates, queueUpdates: stats.queueUpdates, commits: [...stats.commits], applyCalls: stats.applies.length,
      applyMs: sum(stats.applies), layoutMs: sum(stats.layouts), layouts: stats.layouts.length };
    hook.unmount();
    const viewProps = { scale: 1, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
      onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
      selectedItemIds: new Set<string>(), resourceView: true, focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
    const beforeLayout = buildForwardPlanningBoardGanttLayout(fixture.options);
    const mountStart = performance.now();
    const view = render(<PlanningBoardGanttView {...viewProps} layout={beforeLayout} />);
    const viewMountMs = performance.now() - mountStart;
    const updateStart = performance.now();
    view.rerender(<PlanningBoardGanttView {...viewProps} layout={afterLayout} />);
    const viewUpdateMs = performance.now() - updateStart;
    const acknowledgementViews = acknowledgementLayouts.map((layout) => {
      stats.rowRenders = 0;
      const start = performance.now();
      view.rerender(<PlanningBoardGanttView {...viewProps} layout={layout} />);
      return { ms: performance.now() - start, rowRenders: stats.rowRenders };
    });
    if (!process.env.PLANNING_BOARD_PERF_BASELINE) expect(acknowledgementViews.map((ack) => ack.rowRenders)).toEqual(Array(20).fill(0));
    const viewAcknowledgementMs = median(acknowledgementViews.map((ack) => ack.ms));
    const breakdown = nodeBreakdown(view.container);
    const nodes = view.container.querySelectorAll('*').length;
    const segments = afterLayout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars)).reduce((n, bar) => n + (bar.segments?.length ?? 0), 0);
    expect(sum(Object.values(breakdown))).toBe(nodes);
    expect(afterItems).toHaveLength(1500);
    view.unmount();
    if (iteration) samples.push({ handlerMs, firstDisplayMs, initial, acknowledgementsMs, all, viewMountMs, viewUpdateMs, viewAcknowledgementMs, daysBefore: beforeLayout.end - beforeLayout.start, daysAfter: afterLayout.end - afterLayout.start, nodes, segments, nodeBreakdown: breakdown, acknowledgementViews });
  }
  const summary = {
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
      dom: 'jsdom (no browser layout/paint)', samples: 3, discardedWarmups: 1 },
    fixture: { seibans: 80, items: 1500, resources: 20, splits: fixture.items.filter((item) => item.kind === 'split').length,
      specialDue: fixture.items.filter((item) => item.specialDue).length },
    layoutMedianMs: median(layoutSamples),
    medians: Object.fromEntries(['handlerMs', 'firstDisplayMs', 'acknowledgementsMs', 'viewMountMs', 'viewUpdateMs', 'viewAcknowledgementMs'].map((key) =>
      [key, median(samples.map((sample) => sample[key as 'handlerMs']))])),
    acknowledgementViewMedianMs: median(samples.flatMap((sample) => sample.acknowledgementViews.map((ack) => ack.ms))),
    samples
  };
  if (process.env.PLANNING_BOARD_PERF_OUTPUT) writeFileSync(process.env.PLANNING_BOARD_PERF_OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`PERF_RESULT ${JSON.stringify(summary)}\n`);
}, 120_000);
