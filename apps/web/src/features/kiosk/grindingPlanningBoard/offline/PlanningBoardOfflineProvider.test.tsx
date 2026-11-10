import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline, useFrozenValue } from './PlanningBoardOfflineProvider';

const mocks = vi.hoisted(() => ({ get: vi.fn(), board: vi.fn(), aux: vi.fn(), commit: vi.fn() }));
vi.mock('../../../../api/client', () => ({ api: { get: mocks.get }, getResolvedClientKey: () => 'test-device' }));
const config = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true };
const capacity = { status: 200, data: { dailyHoursByResource: { '305': 8 }, runsThroughBreaksResources: [] } };
let current: ReturnType<typeof usePlanningBoardOffline>;
function Harness() {
  const offline = usePlanningBoardOffline();
  current = offline;
  const { registerRead } = offline;
  const [board, setBoard] = useState('old');
  const [aux, setAux] = useState('old');
  useEffect(() => registerRead('board', {
    read: mocks.board, commit: (value) => { mocks.commit('board', value); setBoard(String(value)); }
  }), [registerRead]);
  useEffect(() => registerRead('aux', {
    read: mocks.aux, commit: (value) => { mocks.commit('aux', value); setAux(String(value)); }
  }), [registerRead]);
  return <><span data-testid="phase">{offline.snapshot.phase}</span><span data-testid="data">{useFrozenValue(board)}:{useFrozenValue(aux)}</span>
    <button onClick={() => offline.gate.attempt()}>書き込み</button><p>{offline.notification}</p></>;
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
const eventProbe = async () => { fireEvent(window, new Event('online')); await flush(); };
async function online() {
  render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
  await flush(); await advance(5000);
  expect(screen.getByTestId('phase')).toHaveTextContent('online');
  mocks.get.mockRejectedValue(new Error('offline'));
}
async function offline() { await online(); await advance(15000); expect(screen.getByTestId('phase')).toHaveTextContent('offline'); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  mocks.get.mockReset().mockResolvedValue(capacity);
  mocks.board.mockReset().mockResolvedValue('initial'); mocks.aux.mockReset().mockResolvedValue('initial'); mocks.commit.mockReset();
  const slot = document.createElement('div'); slot.id = 'planning-board-connectivity-slot'; document.body.appendChild(slot);
});
afterEach(() => { document.getElementById('planning-board-connectivity-slot')?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('PlanningBoardOfflineProvider', () => {
  it('displays loaded data during bootstrapping before a successful probe', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush();
    expect(current.snapshot.phase).toBe('bootstrapping');
    expect(screen.getByTestId('data')).toHaveTextContent('initial:initial');
    expect(current.gate.canWrite()).toBe(false);
  });
  it('allows writes after one probe and the full startup load without waiting five seconds', async () => {
    render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush();
    expect(current.snapshot.phase).toBe('online');
    fireEvent.click(screen.getByRole('button', { name: '書き込み' }));
    expect(current.gate.canWrite()).toBe(true);
    expect(screen.queryByText('圏外のため操作できません')).toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('retries failed startup reads on a later successful probe without overlapping pending reads', async () => {
    mocks.board.mockRejectedValueOnce(new Error('startup failure'));
    render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush();
    expect(current.snapshot.phase).toBe('bootstrapping');
    await advance(4999); expect(mocks.board).toHaveBeenCalledTimes(1);
    let finish!: (value: string) => void;
    mocks.board.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    await advance(1); expect(mocks.board).toHaveBeenCalledTimes(2);
    await advance(5000); expect(mocks.board).toHaveBeenCalledTimes(2);
    await act(async () => finish('retried')); await flush();
    expect(current.snapshot.phase).toBe('online');
    expect(screen.getByTestId('data')).toHaveTextContent('retried:initial');
  });

  it('waits for a successful probe before retrying and stops startup at fifteen seconds', async () => {
    mocks.board.mockRejectedValue(new Error('startup failure'));
    mocks.get.mockRejectedValue(new Error('probe failure'));
    render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush(); await advance(5000);
    expect(mocks.board).toHaveBeenCalledTimes(1);
    mocks.get.mockResolvedValue(capacity);
    await advance(5000); expect(mocks.board).toHaveBeenCalledTimes(2);
    expect(current.snapshot.phase).toBe('bootstrapping');
    await advance(5000);
    expect(current.snapshot.phase).toBe('offline');
  });
  it('cancels a pending startup retry on unmount and ignores its late result', async () => {
    mocks.board.mockRejectedValueOnce(new Error('startup failure'));
    const view = render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush();
    let finish!: (value: string) => void; let signal!: AbortSignal;
    mocks.board.mockImplementation((abort: AbortSignal) => { signal = abort; return new Promise<string>((resolve) => { finish = resolve; }); });
    await advance(5000); expect(mocks.board).toHaveBeenCalledTimes(2);
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => finish('late')); await flush(); await advance(10000);
    expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.board).toHaveBeenCalledTimes(2);
  });
  it('keeps its controller active across StrictMode effect replay', async () => {
    render(<StrictMode><PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider></StrictMode>);
    await flush(); await advance(5000);
    expect(current.snapshot.phase).toBe('online'); expect(current.gate.canWrite()).toBe(true);
    mocks.get.mockRejectedValue(new Error('offline'));
    await advance(15000); expect(current.snapshot.phase).toBe('offline'); expect(current.gate.canWrite()).toBe(false);
  });
  it('does nothing when disabled, including probes, registration and the write gate', async () => {
    render(<PlanningBoardOfflineProvider><Harness /></PlanningBoardOfflineProvider>);
    await advance(60000);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.board).not.toHaveBeenCalled();
    expect(current.gate.attempt()).toBe(true); expect(screen.queryByRole('status')).toBeNull();
  });
  it('leaves display and writes unchanged at 14.9 seconds, then closes the gate and shows the banner at 15 seconds', async () => {
    await online();
    const before = screen.getByTestId('data').textContent;
    await advance(14900);
    expect(current.gate.canWrite()).toBe(true); expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('data')).toHaveTextContent(before!);
    await advance(100);
    expect(current.gate.canWrite()).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('圏外操作できません--:-- の表示');
    expect(screen.getByTestId('data')).toHaveTextContent(before!);
  });
  it('shows a rejected-write notification for two seconds', async () => {
    await offline(); fireEvent.click(screen.getByRole('button', { name: '書き込み' }));
    expect(screen.getByText('圏外のため操作できません')).toBeInTheDocument();
    await advance(1999); expect(screen.getByText('圏外のため操作できません')).toBeInTheDocument();
    await advance(1); expect(screen.queryByText('圏外のため操作できません')).toBeNull();
  });
  it('requires two probes and stages every participant before publishing, then clears the green banner after three seconds', async () => {
    await offline(); mocks.get.mockResolvedValue(capacity);
    let finish!: (value: string) => void;
    mocks.board.mockResolvedValue('fresh'); mocks.aux.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    mocks.commit.mockClear();
    await eventProbe(); expect(current.snapshot.phase).toBe('offline');
    await eventProbe(); expect(current.snapshot.phase).toBe('refreshing');
    expect(current.gate.canWrite()).toBe(false); expect(mocks.commit).not.toHaveBeenCalled();
    expect(screen.getByTestId('data')).toHaveTextContent('initial:initial');
    await act(async () => finish('fresh')); await flush();
    expect(screen.getByTestId('data')).toHaveTextContent('fresh:fresh');
    expect(current.gate.canWrite()).toBe(true); expect(screen.getByRole('status')).toHaveTextContent('復帰最新に更新しました');
    await advance(2999); expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(1); expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('/resource-capacity'), expect.objectContaining({ timeout: 3000, headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } }));
  });
  it('returns to offline after a hanging refresh and ignores its later result', async () => {
    await offline(); mocks.get.mockResolvedValue(capacity);
    let finish!: (value: string) => void; let signal!: AbortSignal;
    mocks.board.mockImplementation((abort: AbortSignal) => { signal = abort; return new Promise<string>((resolve) => { finish = resolve; }); });
    mocks.commit.mockClear(); await eventProbe(); await eventProbe();
    expect(current.snapshot.phase).toBe('refreshing');
    await advance(15000);
    expect(current.snapshot.phase).toBe('offline'); expect(signal.aborted).toBe(true);
    await act(async () => finish('late')); await flush();
    expect(mocks.commit).not.toHaveBeenCalled(); expect(current.gate.canWrite()).toBe(false);
  });
  it('aborts a refresh and stops probes on unmount', async () => {
    const view = render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await flush(); await advance(5000); mocks.get.mockRejectedValue(new Error('offline')); await advance(15000);
    let signal!: AbortSignal;
    mocks.board.mockImplementation((abort: AbortSignal) => { signal = abort; return new Promise(() => undefined); });
    mocks.get.mockResolvedValue(capacity); await eventProbe(); await eventProbe();
    const probes = mocks.get.mock.calls.length;
    view.unmount(); expect(signal.aborted).toBe(true);
    await advance(30000); expect(mocks.get).toHaveBeenCalledTimes(probes);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
