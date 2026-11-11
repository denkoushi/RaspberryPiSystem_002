/* eslint-disable @typescript-eslint/no-explicit-any -- perf harness: loosely typed network mocks and raw JSON samples. */
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Profiler } from 'react';
import { expect, it, vi } from 'vitest';

// eslint-disable-next-line import/no-restricted-paths -- perf harness renders the real page; not production code.
import { ProductionScheduleGrindingPlanningBoardPage } from '../../../../pages/kiosk/ProductionScheduleGrindingPlanningBoardPage';
import { buildLeaderBoardPartResourceProcessKey } from '../../leaderOrderBoard/buildLeaderBoardPartResourceProcessKey';

import { productionFixture, productionPiecesFixture } from './fixture';
import { pieceSnapshot } from './pieceSnapshots';
import { tableRowProbe } from './tableRowProbe';

import type { ComponentProps } from 'react';
const PERF_REPETITIONS = Math.max(1, Number(process.env.PLANNING_BOARD_PAGE_PERF_REPS ?? 3));

// Only network hooks are replaced. Instrumentation delegates to the real implementations.
const probe = vi.hoisted(() => ({ rows: 0, commits: 0, actualMs: 0,
  layout: [] as number[], chips: [] as number[], strips: [] as number[],
  changedProps: {} as Record<string, number> }));
const network = vi.hoisted(() => {
  type Store = { data: any; listeners: Set<() => void> };
  const stores: Record<string, Store> = Object.fromEntries(['board', 'chips', 'minutes', 'uptime', 'capacity', 'partMinutes', 'resources', 'load', 'candidates', 'detail'].map(key => [key, { data: undefined, listeners: new Set() }]));
  const mutateAsync = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ sourceRevision: 'source-0', items: [] }));
  const mutate = vi.fn();
  const refetch = vi.fn(async () => ({ data: stores.board.data, isError: false }));
  return { stores, mutateAsync, mutate, refetch, nextBoard: undefined as any,
    split: vi.fn(), merge: vi.fn(), completion: vi.fn() };
});
vi.mock('../../../../api/hooks', async () => {
  const { useSyncExternalStore, useMemo } = await import('react');
  function useStore(key: string) {
    const store = network.stores[key];
    const data = useSyncExternalStore((listener) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }, () => store.data);
    return { data, isLoading: false, isFetching: false, isError: false, isPending: false, refetch: network.refetch,
      hasStableData: true, scopeReady: true, isComplete: true, isAppending: false, appendError: null };
  }
  const mutation = () => ({ mutateAsync: network.mutateAsync, mutate: network.mutate, isPending: false, isError: false });
  return {
    useKioskGrindingPlanningBoardProgressive: (params: any) => {
      const result = useStore('board');
      const data = useMemo(() => ({ ...result.data, category: params.category, view: params.view }), [result.data, params.category, params.view]);
      return { ...result, data };
    },
    useKioskGrindingPlanningBoardProcessChips: () => useStore('chips'),
    useKioskGrindingPlanningBoardResourceCapacity: () => useStore('capacity'),
    useKioskProductionScheduleResources: () => useStore('resources'),
    useKioskGrindingPlanningBoardLoad: () => useStore('load'),
    useKioskGrindingPlanningBoardSeibanCandidates: () => useStore('candidates'),
    useKioskGrindingPlanningBoardDueDetail: () => useStore('detail'),
    useKioskSessakuPieceMutations: () => ({ split: { mutateAsync: network.split }, merge: { mutateAsync: network.merge }, completion: { mutateAsync: network.completion } }),
    useUpdateKioskGrindingPlanningBoardArrival: mutation,
    useUpdateKioskGrindingPlanningBoardFirstProcessArrival: mutation,
    useSetKioskProductionScheduleRowCompletion: mutation,
    useUpdateKioskGrindingPlanningBoardResourceCapacity: mutation,
    useUpdateKioskGrindingPlanningBoardPins: mutation,
    useUpdateKioskGrindingPlanningBoardOverrides: mutation,
    useUpdateKioskGrindingPlanningBoardDueScope: mutation,
    useUpdateKioskGrindingPlanningBoardRank: mutation,
    useUpdateKioskGrindingPlanningBoardResourceOrder: mutation,
    useUpdateKioskGrindingPlanningBoardResourceOrderBulk: mutation,
    useKioskGrindingPlanningBoardResourceMinutes: () => useStore('partMinutes'),
    useUpdateKioskGrindingPlanningBoardResourceMinutesSource: mutation,
    useUpdateKioskGrindingPlanningBoardResourcePartMinutes: mutation,
    useUpdateKioskGrindingPlanningBoardSeibanChecks: mutation,
    useUpdateKioskGrindingPlanningBoardSeibanOrder: mutation
  };
});
vi.mock('../../../../api/hooks/production-schedule/d-schedule-minutes', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useKioskDScheduleMinutes: () => ({ data: useSyncExternalStore(listener => {
    network.stores.minutes.listeners.add(listener); return () => { network.stores.minutes.listeners.delete(listener); };
  }, () => network.stores.minutes.data) }) };
});
vi.mock('../../../../api/hooks/machine-signal', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useMachineSignalResourceUptime: () => ({ data: useSyncExternalStore(listener => {
    network.stores.uptime.listeners.add(listener); return () => { network.stores.uptime.listeners.delete(listener); };
  }, () => network.stores.uptime.data) }) };
});
vi.mock('../gantt/PlanningBoardForwardGanttRow', async importOriginal => {
  const actual = await importOriginal<typeof import('../gantt/PlanningBoardForwardGanttRow')>();
  const { memo, useRef } = await import('react');
  return { ...actual, PlanningBoardForwardGanttRow: memo(function CountedRow(props: ComponentProps<typeof actual.PlanningBoardForwardGanttRow>) {
    const previous = useRef<typeof props | null>(null);
    probe.rows++;
    if (previous.current) for (const key of Object.keys(props) as (keyof typeof props)[]) {
      if (!Object.is(previous.current[key], props[key])) probe.changedProps[key] = (probe.changedProps[key] ?? 0) + 1;
    }
    previous.current = props;
    return <actual.PlanningBoardForwardGanttRow {...props} />;
  }) };
});
vi.mock('../gantt/planningBoardGanttLayout', async importOriginal => {
  const actual = await importOriginal<typeof import('../gantt/planningBoardGanttLayout')>();
  return { ...actual, buildPlanningBoardGanttLayout: (...args: Parameters<typeof actual.buildPlanningBoardGanttLayout>) => {
    const start = performance.now(); const value = actual.buildPlanningBoardGanttLayout(...args); probe.layout.push(performance.now() - start); return value;
  } };
});
vi.mock('../planningBoardProcessChipData', async importOriginal => {
  const actual = await importOriginal<typeof import('../planningBoardProcessChipData')>();
  return { ...actual, buildPlanningBoardProcessChipsByPart: (...args: Parameters<typeof actual.buildPlanningBoardProcessChipsByPart>) => {
    const start = performance.now(); const value = actual.buildPlanningBoardProcessChipsByPart(...args); probe.chips.push(performance.now() - start); return value;
  } };
});
vi.mock('../gantt/planningBoardChipStrips', async importOriginal => {
  const actual = await importOriginal<typeof import('../gantt/planningBoardChipStrips')>();
  return { ...actual, layoutChipStrips: (...args: Parameters<typeof actual.layoutChipStrips>) => {
    const start = performance.now(); const value = actual.layoutChipStrips(...args); probe.strips.push(performance.now() - start); return value;
  } };
});

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function refresh(keys: string[]) {
  for (const key of keys) { const store = network.stores[key]; store.data = clone(store.data); store.listeners.forEach(listener => listener()); }
}
function reset() { tableRowProbe.renders = 0; probe.rows = 0; probe.commits = 0; probe.actualMs = 0; probe.layout = []; probe.chips = []; probe.strips = []; probe.changedProps = {}; }

// Allow four complete production-size sequences, including 20 separately flushed drag moves each.
it('measures real page interactions with the production fixture (one warmup, three samples)', async () => {
  const samples: Record<string, any[]> = {};
  const unavailable = new Set<string>();
  const capabilities: Record<string, boolean> = {};
  const originalElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
  class PerfPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  vi.stubGlobal('PointerEvent', PerfPointerEvent);
  // Freeze the scheduling date, but leave performance.now real for measurements.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  try {
    for (const withPieces of process.env.PLANNING_BOARD_PAGE_PERF_PIECES_ONLY ? [true] : [false, true]) {
      const fixture = withPieces ? productionPiecesFixture() : productionFixture();
      expect(fixture.items).toHaveLength(withPieces ? 1650 : 1500);
      if (withPieces) {
        const pieces = fixture.items.filter(item => item.kind === 'piece');
        expect(pieces).toHaveLength(250);
        const units = pieces.filter(item => typeof item.unitRequiredMinutes === 'number');
        expect(units).toHaveLength(50);
        expect(units.every(item => item.plannedQuantity === 1 && item.ops?.length === 5)).toBe(true);
        expect(new Set(pieces.map(item => item.parentItemId)).size).toBe(100);
      }
      for (let iteration = 0; iteration < 1 + PERF_REPETITIONS; iteration++) {
        vi.setSystemTime(new Date('2026-11-05T08:00:00+09:00'));
        network.nextBoard = undefined;
        network.refetch.mockImplementation(async () => {
          if (network.nextBoard) { network.stores.board.data = network.nextBoard; network.nextBoard = undefined; }
          else network.stores.board.data = clone(network.stores.board.data);
          network.stores.board.listeners.forEach(listener => listener());
          return { data: network.stores.board.data, isError: false };
        });
        for (const operation of ['split', 'merge', 'completion'] as const) network[operation].mockImplementation(async payload => {
          const { snapshot, response } = pieceSnapshot(network.stores.board.data, operation, payload);
          network.nextBoard = snapshot; return response;
        });
        network.mutateAsync.mockImplementation(async () => ({ sourceRevision: 'source-0', items: [] }));
        localStorage.clear();
        localStorage.setItem('kiosk-planning-board-arrival-filter', JSON.stringify({ schemaVersion: 1, enabled: false }));
        const items = fixture.items.map((item, index) => ({ ...item, arrived: index % 4 !== 0, orderPinned: false }));
        network.stores.board.data = { siteKey: 'perf-site', category: 'grinding', view: 'resource', sourceRevision: 'source-0', boardVersion: 1,
          registeredFseibans: fixture.seibans, seibanOrder: fixture.seibans, resources: fixture.resources,
          resourceCategories: Object.fromEntries(fixture.resources.map((cd, i) => [cd, i < 10 ? 'grinding' : 'cutting'])),
          pieceCapabilities: { createEnabled: withPieces, includePieces: withPieces },
          items, load: [], unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId: 'snapshot-0', nextCursor: null };
        const chipsByPartKey: Record<string, any[]> = {};
        for (const item of items) chipsByPartKey[buildLeaderBoardPartResourceProcessKey({ seibanJoinKey: item.fseiban, productNo: item.productNo, fhincd: item.fhincd })] =
          Array.from({ length: 6 }, (_, i) => ({ rowId: `${item.fhincd}-chip-${i}`, resourceCd: fixture.resources[i], processOrder: String((i + 1) * 10), isCompleted: i < 2 }));
        network.stores.chips.data = { chipsByPartKey };
        network.stores.minutes.data = { rows: fixture.seibans.map((fseiban, i) => ({ fseiban, outsourceMarks: [], memo: null,
          surfaceSendOutDates: i % 3 === 0 ? [{ date: '2026-11-06', note: null }, { date: '2026-11-10', note: null }] : [] })) };
        network.stores.uptime.data = { resources: fixture.resources.map((resourceCd, i) => ({ resourceCd, medianRunSeconds: 20000 + i * 100 })) };
        network.stores.partMinutes.data = { ownSourceResourceCds: fixture.resources, values: fixture.items.filter(item => typeof item.unitRequiredMinutes === 'number').map(item => ({ resourceCd: item.originalResourceCd, fhincd: item.fhincd, perUnitMinutes: 50, setupMinutes: 15, ops: item.ops })) };
        network.stores.capacity.data = { dailyHoursByResource: Object.fromEntries(fixture.resources.map(cd => [cd, 8])), runsThroughBreaksResources: [] };
        network.stores.resources.data = { resourceNameMap: Object.fromEntries(fixture.resources.map(cd => [cd, [`機械${cd}`]])) };
        network.stores.load.data = { load: [], unknownRequiredMinutesCount: 0 };
        network.stores.candidates.data = { today: '2026-11-05', candidates: [], completionFilter: 'incomplete' };
        network.stores.detail.data = undefined;
        const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const view = render(<QueryClientProvider client={client}><Profiler id="page" onRender={(_id, _phase, actualDuration) => { probe.commits++; probe.actualMs += actualDuration; }}>
          <ProductionScheduleGrindingPlanningBoardPage />
        </Profiler></QueryClientProvider>);
        const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') === label || node.textContent?.trim() === label));
        const click = async (label: string) => {
          if (label === '切削' || label === '研削') {
            await act(async () => { fireEvent.click(button('工程')!); });
          }
          const node = button(label); expect(node, `button ${label}`).toBeTruthy(); fireEvent.click(node!); };
        const measure = async (name: string, action: () => void | Promise<void>, supported = true, batch = true) => {
          if (!supported) { unavailable.add(name); return; }
          reset();
          const start = performance.now();
          if (batch) await act(async () => { await action(); });
          else await action();
          const wallMs = performance.now() - start;
          const sample = { wallMs, commits: probe.commits, actualMs: probe.actualMs, rowRenders: probe.rows, tableRowRenders: tableRowProbe.renders,
            nodes: document.body.querySelectorAll('*').length,
            layoutCalls: probe.layout.length, layoutMs: sum(probe.layout), chipCalls: probe.chips.length, chipMs: sum(probe.chips),
            stripCalls: probe.strips.length, stripMs: sum(probe.strips), changedProps: { ...probe.changedProps } };
          if (process.env.PLANNING_BOARD_PAGE_PERF_TRACE) process.stdout.write(`sample ${iteration} ${name}: ${wallMs.toFixed(1)}ms, ${sample.nodes} nodes\n`);
          const sampleName = withPieces ? `pieces_${name}` : name.includes('_queue_') || name.endsWith('_refetch_same') ? `plain_${name}` : name;
          if (iteration) (samples[sampleName] ??= []).push(sample);
        };
        expect(view.container.querySelector('[data-testid="planning-board-gantt"]')).toBeTruthy();
        expect(view.container.querySelectorAll('[data-gantt-track]').length).toBeGreaterThan(0);
        capabilities.sendOutStars = !!view.container.querySelector('[data-testid="planning-gantt-send-out-star"]');
        capabilities.monthlyUptime = view.container.textContent!.includes('月平均');
        capabilities.processChips = view.container.textContent!.includes('済');
        if (process.env.PLANNING_BOARD_PAGE_PERF_DOM && iteration === 1) {
          const counts: Record<string, number> = {};
          const gantt = view.container.querySelector('[data-testid="planning-board-gantt"]')!;
          for (const node of gantt.querySelectorAll('*')) {
            let owner: Element | null = node; let label = '';
            while (owner && owner !== gantt && !label) { label = owner.getAttribute('data-testid')?.replace(/-[^-]*\d[^-]*$/, '-#') ?? ''; owner = owner.parentElement; }
            const key = `${label || '(none)'} > ${node.tagName.toLowerCase()}`; counts[key] = (counts[key] ?? 0) + 1;
          }
          process.stdout.write(`DOM gantt=${gantt.querySelectorAll('*').length} body=${document.body.querySelectorAll('*').length}\n`);
          for (const [key, value] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40)) process.stdout.write(`DOM ${value} ${key}\n`);
        }
        if (!withPieces) {
          await measure('gantt_off', () => click('ガント'));
          await measure('gantt_on', () => click('ガント'));
          // Real left lane label: pointer click without movement must not reorder lanes.
          const lane = view.container.querySelector<HTMLButtonElement>('[data-gantt-lane-label] button')!;
          await measure('left_lane_click', () => { expect(lane).toBeTruthy(); fireEvent.click(lane); });
          const legend = () => view.container.querySelector<HTMLElement>('[aria-label="製番の色分け凡例"] button')!;
          await measure('focus_seiban_on', () => { expect(legend()).toBeTruthy(); fireEvent.click(legend()); });
          await measure('focus_seiban_off', () => fireEvent.click(legend()));
          const firstBar = () => view.container.querySelector<HTMLButtonElement>('[data-testid^="planning-gantt-bar-"]')!;
          await measure('item_selection_on', () => { const bar = firstBar(); fireEvent.pointerDown(bar, { button: 0, clientX: 100 }); vi.advanceTimersByTime(600); fireEvent.pointerUp(bar, { clientX: 100 }); });
          await measure('item_selection_off', () => { const bar = firstBar(); fireEvent.pointerDown(bar, { button: 0, clientX: 100 }); vi.advanceTimersByTime(600); fireEvent.pointerUp(bar, { clientX: 100 }); });
          const arrival = button('着');
          await measure('arrival_on', () => click('着'), !!arrival);
          await measure('arrival_off', () => click('着'), !!arrival);
          // Flush each pointer move separately to model separate browser events (not a batched loop).
          const bar = firstBar();
          const targets = [...view.container.querySelectorAll<HTMLElement>('[data-gantt-lane]')];
          let hit: Element[] = [];
          Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => hit });
          await measure('drag_start', () => { fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 10 }); hit = [targets[0]!]; fireEvent.pointerMove(bar, { clientX: 120, clientY: 20 }); });
          await measure('drag_hover_20', async () => {
            for (let i = 0; i < 20; i++) { hit = [targets[i % targets.length]!]; await act(async () => { fireEvent.pointerMove(bar, { clientX: 120 + i, clientY: 30 + i }); }); }
          }, true, false);
          // Exercise pointer-up validation/cleanup; the fixture's special-due band can reject this drop.
          hit = [bar];
          await act(async () => { fireEvent.pointerMove(bar, { clientX: 0, clientY: 10 }); });
          await measure('drag_drop', () => { fireEvent.pointerUp(bar, { clientX: 0, clientY: 10 }); });
          await measure('scroll_20', async () => {
            const viewport = view.container.querySelector<HTMLElement>('[aria-label="ガントの日付と工程"]')!;
            for (let i = 0; i < 20; i++) await act(async () => { fireEvent.scroll(viewport, { target: { scrollLeft: i * 40, scrollTop: i * 10 } }); });
          }, true, false);
          await measure('cutting_on', () => click('切削'));
          await measure('grinding_off', () => click('研削'));
          await measure('grinding_on', () => click('研削'));
          await measure('cutting_off', () => click('切削'));
          for (const key of ['board', 'chips', 'minutes', 'uptime']) await measure(`refetch_${key}`, () => refresh([key]), network.stores[key].listeners.size > 0);
          await measure('refetch_all', () => refresh(['board', 'chips', 'minutes', 'uptime']));
          await measure('now_tick_30s', () => { vi.advanceTimersByTime(30_000); });
          const scaw = button('SCAW');
          await measure('scaw_on', () => click('SCAW'), !!scaw);
          await measure('scaw_off', () => click('SCAW'), !!scaw);
        }
        // Both views are measured separately: the real page mounts either the table or the Gantt.
        if (withPieces) { await act(async () => click('切削')); await act(async () => click('研削')); }
        for (const mode of ['gantt', 'table'] as const) {
          // Enqueue the already selected rank, so only pending/reconciliation changes.
          // The Gantt scenario starts this write in the table, then switches back while pending.
          await act(async () => click('ガント'));
          expect(tableRowProbe.renders).toBeGreaterThan(0);
          const prefix = `${mode}_`;
          const rankItem = network.stores.board.data.items.find((item: any) => item.kind === 'row' && item.alternateRank === 1);
          const row = view.container.querySelector(`[data-testid="planning-board-item-${rankItem.itemId}"]`)!;
          const rank = row.querySelector<HTMLButtonElement>('button[aria-label$="の個別指定"]')!;
          await act(async () => { expect(rank).toBeTruthy(); fireEvent.click(rank); });
          const panel = document.getElementById(rank.getAttribute('aria-controls')!)!;
          const choice = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === '1')!;
          let release!: () => void;
          network.mutateAsync.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({
            sourceRevision: 'source-0', alternateRank: rankItem.alternateRank,
            itemRevision: rankItem.itemRevision, overrideVersion: rankItem.version
          }); }));
          await act(async () => { expect(choice).toBeTruthy(); fireEvent.click(choice); });
          if (mode === 'gantt') await act(async () => click('ガント'));
          expect(release, 'real write entered pending').toBeTypeOf('function');
          expect(button('工程')).toBeDisabled();
          await measure(`${prefix}queue_pending_true_to_false`, async () => { release(); });
          expect(button('工程')).not.toBeDisabled();
          await measure(`${prefix}refetch_same`, () => refresh(['board']));
          if (!withPieces || mode === 'gantt') continue;
          const target = network.stores.board.data.items.find((item: any) => item.kind === 'piece' && item.plannedQuantity === 3);
          const quantity = () => document.querySelector<HTMLButtonElement>(`[data-planning-board-quantity-item="${target.itemId}"]`)!;
          const trigger = quantity();
          expect(trigger).toBeTruthy();
          await measure(`${prefix}popup_open`, () => { fireEvent.click(trigger); });
          expect(document.querySelector('[data-planning-board-piece-dialog]')).toBeTruthy();
          await measure(`${prefix}refetch_same_popup_open`, () => refresh(['board']));
          expect(document.querySelector('[data-planning-board-piece-dialog]')).toBeTruthy();
          await act(async () => { vi.advanceTimersByTime(350); });
          const plus = document.querySelector<HTMLButtonElement>('[aria-label="3つに分ける数"]')!;
          const minus = document.querySelector<HTMLButtonElement>('[aria-label="2つに分ける数"]')!;
          expect(plus).not.toBeDisabled();
          await measure(`${prefix}popup_plus`, () => { fireEvent.click(plus); });
          expect(minus).not.toBeDisabled();
          await measure(`${prefix}popup_minus`, () => { fireEvent.click(minus); });
          await measure(`${prefix}popup_close`, () => { fireEvent.keyDown(window, { key: 'Escape' }); });
          expect(document.querySelector('[data-planning-board-piece-dialog]')).toBeNull();
          await act(async () => fireEvent.click(quantity()));
          await act(async () => { vi.advanceTimersByTime(350); });
          const before = network.stores.board.data.items.length;
          const splitButton = button('2つに分ける')!;
          expect(splitButton).not.toBeDisabled();
          await measure('table_split_success', () => { fireEvent.click(splitButton); });
          expect(network.stores.board.data.items).toHaveLength(before + 1);
          expect(document.querySelector('[data-planning-board-piece-dialog]')).toBeNull();
          const children = (await network.split.mock.results.at(-1)!.value).pieces.filter((item: any) => !items.some(previous => previous.itemId === item.itemId));
          expect(children).toHaveLength(2);
          for (const item of children) await act(async () => fireEvent.click(view.container.querySelector(`[data-testid="planning-board-item-${item.itemId}"] input[type="checkbox"]`)!));
          await act(async () => fireEvent.click(document.querySelector(`[data-planning-board-quantity-item="${children[1].itemId}"]`)!));
          await act(async () => { vi.advanceTimersByTime(350); });
          const mergeButton = button('まとめる')!;
          expect(mergeButton).not.toBeDisabled();
          await measure('table_merge_success', () => { fireEvent.click(mergeButton); });
          expect(network.stores.board.data.items).toHaveLength(before);
          const merged = network.stores.board.data.items.find((item: any) => item.parentItemId === target.parentItemId && item.plannedQuantity === 3);
          const mergedRow = view.container.querySelector(`[data-testid="planning-board-item-${merged.itemId}"]`)!;
          const completeButton = mergedRow.querySelector('[aria-label="完了にする"]')!;
          expect(completeButton).not.toBeDisabled();
          await measure('table_piece_complete', () => { fireEvent.click(completeButton); });
          expect(network.stores.board.data.items.find((item: any) => item.itemId === merged.itemId).isCompleted).toBe(true);
          expect(network.nextBoard).toBeUndefined();
        }
        cleanup(); client.clear(); vi.clearAllTimers();
      }
    }
  } finally {
    cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
    if (originalElementsFromPoint) Object.defineProperty(document, 'elementsFromPoint', originalElementsFromPoint);
    else Reflect.deleteProperty(document, 'elementsFromPoint');
  }
  const medians = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name,
    Object.fromEntries(Object.keys(values[0]).filter(key => key !== 'changedProps').map(key => [key, median(values.map(value => value[key]))]))]));
  const result = { environment: { node: process.version, cpu: cpus()[0]?.model, dom: 'jsdom: no browser layout/paint', warmups: 1, repetitions: PERF_REPETITIONS },
    fixture: { items: 1500, seibans: 80, resources: 20, processChipsPerPart: 6, splitParents: 100, pieceItems: 250, expandedItems: 1650, unitPieces: 50, opsPerUnitPiece: 5 },
    notes: ['The real page mounts either table rows or Gantt rows; zero for the unmounted view is expected.',
      'Row renders count component function calls, including replacements mounted after split/merge.',
      'Queue pending uses an unchanged rank write, held until pending=true commits, then resolved with identical saved values; includes queue reconciliation/refetch.',
      'Piece action targets are resolved before timing. Popup control measurements exclude the intentional 350ms gesture guard. Refetch clones hook data, without HTTP/server time.'], capabilities, unavailable: [...unavailable], medians, samples };
  if (process.env.PLANNING_BOARD_PAGE_PERF_OUTPUT) writeFileSync(process.env.PLANNING_BOARD_PAGE_PERF_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write('interaction             wall ms commits actual ms ganttRows tableRows nodes layouts chips strips\n');
  for (const [name, value] of Object.entries(medians)) process.stdout.write(`${name.padEnd(24)} ${['wallMs', 'commits', 'actualMs', 'rowRenders', 'tableRowRenders', 'nodes', 'layoutCalls', 'chipCalls', 'stripCalls'].map(key => Number(value[key]).toFixed(1).padStart(8)).join(' ')}\n`);
  for (const name of unavailable) process.stdout.write(`${name.padEnd(24)} n/a\n`);
}, 600_000);
