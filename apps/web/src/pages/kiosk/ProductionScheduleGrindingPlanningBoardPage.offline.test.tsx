import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from '../../features/kiosk/grindingPlanningBoard/offline/planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline } from '../../features/kiosk/grindingPlanningBoard/offline/PlanningBoardOfflineProvider';
import { usePlanningBoardNow } from '../../features/kiosk/grindingPlanningBoard/offline/usePlanningBoardNow';

import { PlanningBoardPage, ProductionScheduleGrindingPlanningBoardPage } from './ProductionScheduleGrindingPlanningBoardPage';

import type { AxiosResponse } from 'axios';

const board = () => ({
  siteKey: 'site-1', category: 'grinding', view: 'resource', sourceRevision: 'revision-1', boardVersion: 1,
  registeredFseibans: ['26-1041'], uncheckedFseibans: [], seibanOrder: ['26-1041'], resources: ['305'],
  resourceCategories: { '305': 'grinding' }, snapshotId: 'snapshot-1', nextCursor: null, seibanProgress: {},
  items: [{ itemId: 'a', kind: 'row', itemRevision: 'item-1', version: 1, sourceRowId: 'row-a',
    fseiban: '26-1041', fhincd: 'PART-A', fhinmei: '部品A', machineName: '研削機', productNo: 'P-A', processOrder: '10',
    originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-11-11', effectiveDueDate: null,
    originalRank: null, alternateRank: null, orderPinned: false, specialDue: null, plannedQuantity: 5, requiredMinutes: 20,
    requiredMinutesKnown: true, lslhSurface: false, isCompleted: false, arrived: true,
    progress: { completed: 0, total: 1, quantityKnown: false } }]
});
const response = (data: unknown) => ({ data, status: 200, headers: { date: 'Tue, 10 Nov 2026 03:00:00 GMT' } }) as AxiosResponse;
let control: ReturnType<typeof usePlanningBoardOffline>;
function Inspect() { control = usePlanningBoardOffline(); return null; }
function Clock() { return <output data-testid="sampled-clock">{usePlanningBoardNow()}</output>; }
function ClockHarness() {
  const [, rerender] = useState(0);
  return <><button onClick={() => rerender(value => value + 1)}>rerender clock parent</button><Clock /></>;
}
const sampledClock = () => Number(screen.getByTestId('sampled-clock').textContent);
const advance = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('planning board offline page', () => {
  let reachable: boolean;
  let current: ReturnType<typeof board>;
  let get: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    localStorage.clear(); reachable = true; current = board();
    const slot = document.createElement('div'); slot.id = 'planning-board-connectivity-slot'; document.body.append(slot);
    get = vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
      if (!reachable) throw new Error('Offline');
      if (url.endsWith('/resource-capacity')) return response({ dailyHoursByResource: {}, runsThroughBreaksResources: [] });
      if (url.endsWith('/resource-minutes')) return response({ values: [], ownSourceResourceCds: [] });
      if (url.endsWith('/d-schedule-minutes')) return response({ rows: [] });
      if (url.endsWith('/resource-uptime')) return response({ endDate: null, days: 30, resources: [] });
      if (url.endsWith('/resources')) return response({ resources: ['305'], resourceNameMap: {} });
      if (url.endsWith('/load')) return response({ load: [], unknownRequiredMinutesCount: 0 });
      if (url.endsWith('/grinding-planning-board')) return response({ ...current, view: config?.params.view });
      throw new Error(`Unexpected GET: ${url}`);
    });
    vi.spyOn(api, 'post').mockResolvedValue(response({ chipsByPartKey: {} }));
  });
  afterEach(() => { cleanup(); document.getElementById('planning-board-connectivity-slot')?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const mount = async (waitForSecondProbe = true, clock = false) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><PlanningBoardOfflineProvider config={{ ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true }}><Inspect />{clock && <ClockHarness />}<PlanningBoardPage /></PlanningBoardOfflineProvider></QueryClientProvider>);
    await advance(); if (waitForSecondProbe) await advance(5000);
  };
  const advanceServerClock = () => {
    const originalGet = get.getMockImplementation()!;
    const started = performance.now();
    get.mockImplementation(async (url, config) => {
      const result = await originalGet(url, config);
      return { ...result, headers: { ...result.headers, date: new Date(Date.parse('2026-11-10T03:00:00Z') + performance.now() - started).toUTCString() } };
    });
  };
  it('keeps the online server time stable on unrelated renders and advances on the 30-second tick', async () => {
    advanceServerClock();
    await mount(false, true);
    expect(control.snapshot.phase).toBe('online');
    const initial = sampledClock();
    await advance(1000);
    fireEvent.click(screen.getByRole('button', { name: 'rerender clock parent' }));
    expect(sampledClock()).toBe(initial);
    await advance(29000);
    expect(sampledClock()).toBe(initial + 30000);
    await advance(1000);
    fireEvent.click(screen.getByRole('button', { name: 'rerender clock parent' }));
    expect(sampledClock()).toBe(initial + 30000);
  });
  it('keeps the sampled time frozen through clock ticks and samples again on recovery', async () => {
    advanceServerClock();
    await mount(false, true);
    const initial = sampledClock();
    reachable = false;
    await advance(15000);
    expect(control.frozen).toBe(true);
    await advance(45000);
    fireEvent.click(screen.getByRole('button', { name: 'rerender clock parent' }));
    expect(sampledClock()).toBe(initial);
    reachable = true;
    await advance(10000);
    expect(control.frozen).toBe(false);
    expect(sampledClock()).toBe(control.now());
  });
  it('uses the existing local 30-second clock when offline support is disabled', async () => {
    const hook = renderHook(() => usePlanningBoardNow());
    const initial = hook.result.current;
    await advance(1000); hook.rerender();
    expect(hook.result.current).toBe(initial);
    await advance(29000);
    expect(hook.result.current).toBe(initial + 30000);
  });
  it('renders the startup board while bootstrapping when the probe is still pending', async () => {
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation((url, config) => config?.kioskTelemetry === 'background'
      ? new Promise(() => undefined) : originalGet(url, config));
    await mount(false);
    expect(control.snapshot.phase).toBe('bootstrapping');
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    expect(screen.getByText('部品A')).toBeVisible();
  });
  it('accepts an immediate write operation after one probe and the startup board load', async () => {
    await mount(false);
    expect(control.snapshot.phase).toBe('online');
    fireEvent.click(screen.getByRole('button', { name: '固定', exact: true }));
    expect(screen.getByRole('button', { name: '固定', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('圏外のため操作できません')).not.toBeInTheDocument();
    expect(get.mock.calls.filter(([, config]) => config?.kioskTelemetry === 'background')).toHaveLength(1);
  });
  it.each([true, false, undefined, 'error', 'pending'] as const)('enables the production page only for an explicit true capability: %s', async (capability) => {
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation((url, config) => {
      if (url === '/mobile-placement/client-capabilities') {
        if (capability === 'pending') return new Promise(() => undefined);
        if (capability === 'error') return Promise.reject(new Error('Unavailable'));
        return Promise.resolve(response({ planningBoardOfflineEnabled: capability }));
      }
      return originalGet(url, config);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ProductionScheduleGrindingPlanningBoardPage /></QueryClientProvider>);
    await advance(); await advance(5000);
    expect(screen.getByRole('button', { name: '固定', exact: true })).toBeVisible();
    reachable = false;
    await advance(15000);
    if (capability === true) expect(screen.getByText('圏外')).toBeVisible();
    else {
      expect(screen.queryByText('圏外')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '固定', exact: true }));
      expect(screen.getByRole('button', { name: '固定', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(get.mock.calls.filter(([, config]) => config?.kioskTelemetry === 'background')).toHaveLength(0);
    }
  });
  it('starts in the last known mode and does not remount the board when the capability answer arrives', async () => {
    const { getResolvedClientKey } = await import('../../api/client');
    localStorage.setItem(`kiosk.planning-board.offline-enabled:${getResolvedClientKey() ?? ''}`, 'true');
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === '/mobile-placement/client-capabilities'
      ? Promise.reject(new Error('Unavailable')) : originalGet(url, config));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><ProductionScheduleGrindingPlanningBoardPage /></QueryClientProvider>);
    await advance(); await advance(5000);
    reachable = false;
    await advance(15000);
    expect(screen.getByText('圏外')).toBeVisible();
  });
  it('keeps a short interruption invisible, blocks writes at 15s, and keeps local browsing available', async () => {
    const put = vi.spyOn(api, 'put');
    await mount(); reachable = false;
    await advance(14900); expect(screen.queryByText('圏外')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '固定', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await advance(100); expect(screen.getByText('圏外')).toBeVisible(); expect(screen.getByText('12:00 の表示')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '固定', exact: true }));
    expect(screen.getByText('圏外のため操作できません')).toBeVisible();
    expect(screen.getByRole('button', { name: '固定', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    expect(screen.getByTestId('planning-board-item-a')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '前工程が済んだものだけ表示', exact: true }));
    await advance(2000); expect(screen.queryByText('圏外のため操作できません')).not.toBeInTheDocument();
  });
  it('publishes all refreshed data only after two successful probes and clears the green banner after 3s', async () => {
    await mount(); reachable = false; await advance(15000);
    current = { ...current, sourceRevision: 'revision-2', items: current.items.map((item) => ({ ...item, fhinmei: '最新部品' })) };
    reachable = true; await advance(5000); expect(screen.getByText('圏外')).toBeVisible();
    await advance(5000); expect(screen.getByText('復帰')).toBeVisible(); expect(screen.getByText('最新に更新しました')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    expect(screen.getByText('最新部品')).toBeVisible();
    const probes = get.mock.calls.filter(([, config]) => config?.kioskTelemetry === 'background');
    expect(probes.length).toBeGreaterThan(2);
    expect(probes[0][1]).toMatchObject({ timeout: 3000, headers: { 'Cache-Control': 'no-cache, no-store' } });
    await advance(3000); expect(screen.queryByText('復帰')).not.toBeInTheDocument();
  });
  it('ignores an old generation read after the displayed model has frozen', async () => {
    await mount();
    let resolve!: (value: AxiosResponse) => void;
    get.mockImplementationOnce(() => new Promise<AxiosResponse>((done) => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = control.refreshRead('board'); });
    reachable = false; await advance(15000);
    expect(screen.getByText('圏外')).toBeVisible();
    const late = { ...current, items: current.items.map((item) => ({ ...item, fhinmei: '旧応答の部品' })) };
    await act(async () => { resolve(response(late)); await pending.catch(() => undefined); });
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    expect(screen.getByText('部品A')).toBeVisible();
    expect(screen.queryByText('旧応答の部品')).not.toBeInTheDocument();
  });

});
