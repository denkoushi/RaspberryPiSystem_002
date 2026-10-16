import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as planningBoardSorting from '../../features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems';
import { LARGE_SCREEN_STORAGE_KEY } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardLargeScreen';

import { ProductionScheduleGrindingPlanningBoardPage } from './ProductionScheduleGrindingPlanningBoardPage';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardRankResponse } from '@raspi-system/shared-types';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const mocks = vi.hoisted(() => ({
  capacity: vi.fn(),
  snapshot: vi.fn(),
  load: vi.fn(),
  refetch: vi.fn(),
  overrides: vi.fn(),
  pins: vi.fn(),
  candidates: vi.fn(),
  dueDetail: vi.fn(),
  dueScope: vi.fn(),
  rank: vi.fn(),
  resourceOrder: vi.fn(),
  resourceOrderBulk: vi.fn(),
  order: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useKioskGrindingPlanningBoardResourceCapacity: (enabled: boolean) => mocks.capacity(enabled),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskProductionScheduleResources: () => ({
    data: {
      resourceNameMap: {
        '305': ['研削機Ａ']
      }
    }
  }),
  useKioskGrindingPlanningBoardProgressive: (...args: unknown[]) => {
    const result = mocks.snapshot(...args);
    const params = args[0] as { category?: string; view?: string } | undefined;
    return {
      ...result,
      data: result.data && (params?.category == null || params.category === result.data.category) && (params?.view == null || params.view === result.data.view)
        ? result.data
        : result.data ? { ...result.data, category: params?.category ?? result.data.category, view: params?.view ?? result.data.view } : result.data,
      hasStableData: result.hasStableData ?? true,
      scopeReady: result.scopeReady ?? true,
      isComplete: result.isComplete ?? true,
      isAppending: result.isAppending ?? false,
      appendError: result.appendError ?? null
    };
  },
  useKioskGrindingPlanningBoardDueDetail: (...args: unknown[]) => mocks.dueDetail(...args),
  useKioskGrindingPlanningBoardLoad: (...args: unknown[]) => mocks.load(...args),
  useKioskGrindingPlanningBoardSeibanCandidates: (...args: unknown[]) => {
    const result = mocks.candidates(...args);
    return result ?? {
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: 'incomplete',
        candidates: []
      },
      isLoading: false,
      isFetching: false,
      isError: false
    };
  },
  useUpdateKioskGrindingPlanningBoardPins: () => ({ mutateAsync: mocks.pins, isPending: false }),
  useUpdateKioskGrindingPlanningBoardOverrides: () => ({ mutateAsync: mocks.overrides, isPending: false }),
  useUpdateKioskGrindingPlanningBoardDueScope: () => ({ mutateAsync: mocks.dueScope, isPending: false }),
  useUpdateKioskGrindingPlanningBoardRank: () => ({ mutateAsync: mocks.rank, isPending: false }),
  useUpdateKioskGrindingPlanningBoardResourceOrderBulk: () => ({ mutateAsync: mocks.resourceOrderBulk, isPending: false }),
  useUpdateKioskGrindingPlanningBoardResourceOrder: () => ({ mutateAsync: mocks.resourceOrder, isPending: false }),
  useUpdateKioskGrindingPlanningBoardSeibanOrder: () => ({ mutateAsync: mocks.order, isPending: false })
}));

function fixture() {
  const item = (id: string, fseiban: string, processOrder: string, completed = false) => ({
    itemId: id,
    kind: 'row' as const,
    itemRevision: `revision-${id}`,
    version: 2,
    sourceRowId: `source-${id}`,
    fseiban,
    fhincd: `PART-${id}`,
    fhinmei: `部品${id}`,
    machineName: fseiban === '26-1041' ? '自動組立機 ＡＸ－２００' : '搬送装置 ＣＶ－８０',
    productNo: `PRODUCT-${id}`,
    processOrder,
    originalResourceCd: '305',
    effectiveResourceCd: null,
    originalDueDate: '2026-09-12',
    effectiveDueDate: null,
    originalRank: null,
    alternateRank: null as number | null,
    orderPinned: false,
    specialDue: null as null | { kind: 'today'; expiresAt: string },
    plannedQuantity: 5,
    requiredMinutes: 20,
    requiredMinutesKnown: true,
    isCompleted: completed,
    progress: { completed: completed ? 1 : 0, total: 1, quantityKnown: false }
  });
  return {
    siteKey: 'site-1',
    category: 'grinding' as const,
    view: 'seiban' as const,
    sourceRevision: 'board-1',
    boardVersion: 4,
    registeredFseibans: ['26-1041', '26-1042'],
    seibanOrder: ['26-1041', '26-1042'],
    resources: ['305', '584'],
    resourceCategories: { '305': 'grinding', '584': 'grinding' } as Record<string, 'grinding' | 'cutting'>,
    items: [item('a', '26-1041', '10'), item('b', '26-1041', '20'), item('c', '26-1042', '10'), item('d', '26-1042', '20')],
    load: [
      { resourceCd: '305', originalItemCount: 4, alternateItemCount: 4, originalRequiredMinutes: 80, alternateRequiredMinutes: 80, unfinishedItemCount: 4, requiredMinutes: 80, unknownItemCount: 0, originalUnknownItemCount: 0, alternateUnknownItemCount: 0 }
    ],
    unknownRequiredMinutesCount: 0,
    seibanProgress: { '26-1041': { completed: 3, total: 20 }, '26-1042': { completed: 1, total: 20 } },
    snapshotId: 'snapshot-1',
    nextCursor: null
  };
}

// The board opens on 資源CD; most cases here exercise the 製番 view.
function renderSeibanBoard() {
  const result = render(<ProductionScheduleGrindingPlanningBoardPage />);
  const seiban = screen.queryByRole('button', { name: '製番', exact: true });
  if (seiban) fireEvent.click(seiban);
  return result;
}

function selectAllBoardItems() {
  fireEvent.click(screen.getByLabelText('製番26-1041を全選択'));
  fireEvent.click(screen.getByLabelText('製番26-1042を全選択'));
}

function chooseResourceRank(fseiban: string, rank: number | null) {
  const rankButton = screen.getByRole('button', { name: `${fseiban}の個別指定` });
  fireEvent.click(rankButton);
  const picker = screen.getByRole('dialog', { name: '順位を選択' });
  fireEvent.click(within(picker).getByRole('button', { name: rank == null ? '-' : String(rank), exact: true }));
  return screen.getByRole('button', { name: `${fseiban}の個別指定` });
}

function scanOrder(raw: string) {
  act(() => {
    for (const key of raw) fireEvent.keyDown(document.activeElement ?? document.body, { key });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });
  });
}

describe('ProductionScheduleGrindingPlanningBoardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    localStorage.removeItem('kiosk-planning-board-gantt-scale');
    localStorage.removeItem('kiosk-planning-board-gantt-mode');
    localStorage.removeItem(LARGE_SCREEN_STORAGE_KEY);
    mocks.capacity.mockReset();
    mocks.capacity.mockReturnValue({ data: undefined, isLoading: true });
    mocks.snapshot.mockReset();
    mocks.load.mockReset();
    mocks.load.mockReturnValue({ data: { load: fixture().load, unknownRequiredMinutesCount: 0 } });
    mocks.refetch.mockReset();
    mocks.overrides.mockReset();
    mocks.candidates.mockReset();
    mocks.dueDetail.mockReset();
    mocks.dueScope.mockReset();
    mocks.rank.mockReset();
    mocks.resourceOrder.mockReset();
    mocks.resourceOrderBulk.mockReset();
    mocks.pins.mockReset();
    mocks.order.mockReset();
    mocks.refetch.mockResolvedValue({ data: fixture() });
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.overrides.mockResolvedValue({ sourceRevision: 'board-2' });
    mocks.dueDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    mocks.dueScope.mockResolvedValue({});
    mocks.candidates.mockReturnValue({
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: 'incomplete',
        candidates: []
      },
      isLoading: false,
      isFetching: false,
      isError: false
    });
    mocks.rank.mockImplementation(async (payload: { itemId: string; itemRevision: string; overrideVersion: number; alternateRank: number | null }): Promise<GrindingPlanningBoardRankResponse> => ({
    sourceRevision: 'board-1',
    itemId: payload.itemId,
    itemRevision: `revision-${payload.itemId}-after-rank-${payload.overrideVersion + 1}`,
    overrideVersion: payload.overrideVersion + 1,
      alternateRank: payload.alternateRank
    }));
    mocks.resourceOrder.mockResolvedValue({ sourceRevision: 'board-1', items: [] });
    mocks.order.mockResolvedValue({ sourceRevision: 'board-2', seibanOrder: ['26-1041', '26-1042'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('scans a visible order, enables Gantt colors and shares legend focus, including Escape and mode reset', () => {
    const data = fixture();
    data.items[0]!.productNo = '1234567890';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('1234567890');
    expect(screen.queryByRole('dialog', { name: '製造オーダー番号を読み取る' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '製番ごとに色分け' })).toHaveAttribute('aria-pressed', 'true');
    const legend = screen.getByRole('group', { name: '製番の色分け凡例' });
    expect(within(legend).getByRole('button', { name: '26-1041', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveClass('ring-2', 'ring-white');
    expect(screen.getByText('1234567890 → 製番 26-1041')).toHaveAttribute('role', 'status');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(legend).getByRole('button', { name: '26-1041', exact: true })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(legend).getByRole('button', { name: '26-1041', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    expect(screen.queryByRole('button', { name: '目立たせるのをやめる' })).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-board-item-a')).not.toHaveClass('ring-white');
  });

  it('does not find orders absent from the list or bars absent from the current Gantt', () => {
    const data = fixture();
    data.items[0]!.productNo = '1234567890';
    data.items[0]!.originalDueDate = null as unknown as string;
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('12345');
    expect(screen.getByRole('alert')).toHaveTextContent('製造オーダー番号は数字10桁です（読取値: 12345）。読み直してください。');
    scanOrder('9999999999');
    expect(screen.getByRole('alert')).toHaveTextContent('9999999999 の行はこの画面にありません。');
    fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '納期から', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('1234567890');
    expect(screen.getByRole('alert')).toHaveTextContent('1234567890 の棒はこのガントにありません。');
    expect(screen.getByRole('button', { name: '移動票で製番を探す' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '製造オーダー番号を読み取る' })).not.toBeInTheDocument();
  });

  it('highlights resource rows, scrolls each resource at 70% zoom and clears via chip, Escape or Gantt toggle', () => {
    const data = fixture();
    data.items[0]!.productNo = '1234567890';
    data.items[1]!.originalResourceCd = '584';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    const getStyle = window.getComputedStyle;
    const computed = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = getStyle(element, pseudo);
      if (element === document.documentElement) style.zoom = '0.7';
      return style;
    });
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.dataset.seibanFocused === 'true' ? 210 : 70, left: 0, bottom: 100, width: 200, height: 30 } as DOMRect;
    });
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('1234567890');
    expect(screen.getByTestId('planning-board-item-a')).toHaveClass('ring-2', 'ring-white');
    expect(screen.getByTestId('planning-board-item-b')).toHaveClass('ring-white');
    expect(screen.getByTestId('planning-board-item-c')).toHaveClass('opacity-25');
    document.querySelectorAll<HTMLElement>('[data-resource-scroll]').forEach((scroll) => expect(scroll.scrollTop).toBe(200));
    document.querySelectorAll<HTMLElement>('[data-resource-scroll]').forEach((scroll) => { scroll.scrollTop = 0; });
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('1234567890');
    document.querySelectorAll<HTMLElement>('[data-resource-scroll]').forEach((scroll) => expect(scroll.scrollTop).toBe(200));
    rects.mockRestore();
    computed.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '目立たせるのをやめる' }));
    expect(screen.getByTestId('planning-board-item-a')).not.toHaveClass('ring-white');
    expect(screen.getByTestId('planning-board-item-c')).not.toHaveClass('opacity-25');
    for (const clear of ['escape', 'gantt']) {
      fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
      scanOrder('1234567890');
      if (clear === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
      else fireEvent.click(screen.getByRole('button', { name: 'ガント', exact: true }));
      expect(screen.queryByRole('button', { name: '目立たせるのをやめる' })).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('planning-gantt-bar-a')).not.toHaveClass('ring-white');
  });

  it('opens and scrolls the scanned seiban pane and dismisses the notice after two seconds', () => {
    const data = fixture();
    data.items[0]!.productNo = '1234567890';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' }));
    const pane = screen.getByTestId('planning-board-seiban-26-1041');
    const scroll = vi.fn();
    pane.scrollIntoView = scroll;
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scanOrder('1234567890');
    expect(pane).toHaveClass('ring-2', 'ring-white');
    expect(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' })).toHaveAttribute('aria-expanded', 'true');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(screen.getByText('1234567890 → 製番 26-1041')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText('1234567890 → 製番 26-1041')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '目立たせるのをやめる' }));
    expect(pane).not.toHaveClass('ring-white');
  });

  it('toggles large-screen display, restores it on return and clears zoom when leaving the page', () => {
    const page = render(<ProductionScheduleGrindingPlanningBoardPage />);
    const toggle = screen.getByRole('button', { name: '50インチ表示' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.style.zoom).toBe('0.7');
    page.unmount();
    expect(document.documentElement.style.zoom).toBe('');
    const returned = render(<ProductionScheduleGrindingPlanningBoardPage />);
    const restored = screen.getByRole('button', { name: '50インチ表示' });
    expect(restored).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.style.zoom).toBe('0.7');
    fireEvent.click(restored);
    expect(restored).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.style.zoom).toBe('');
    returned.unmount();
  });

  it('keeps selections scoped to the derived all category and restores each scope', () => {
    renderSeibanBoard();
    selectAllBoardItems();
    expect(screen.getByText('4件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(mocks.snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'all' }), expect.anything());
    expect(mocks.load).toHaveBeenLastCalledWith('all');
    expect(mocks.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'all' }), expect.anything());
    expect(screen.getByRole('button', { name: '一括変更' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(screen.getByText('4件')).toBeInTheDocument();
  });

  it('filters editor targets by original category and disables mixed bulk resource changes', () => {
    const data = fixture();
    data.resources = ['100', '305', '584'];
    data.resourceCategories['100'] = 'cutting';
    data.items[1]!.originalResourceCd = '100';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    fireEvent.click(within(screen.getByTestId('planning-board-item-a')).getByRole('button', { name: '資源CD 305を変更' }));
    let dialog = screen.getByRole('dialog', { name: '一括変更' });
    expect(within(dialog).getByRole('button', { name: '資源CD 584へ変更' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: '資源CD 100へ変更' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    selectAllBoardItems();
    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    dialog = screen.getByRole('dialog', { name: '一括変更' });
    expect(within(dialog).getByText('研削と切削が混ざっているため変更できません')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /資源CD .+へ変更/ })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: '元に戻す' })[0]).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: '指定日' })).toBeEnabled();
  });

  it.each([true, false])('rejects cross-category drag and orders resource panes (map available: %s)', (hasMap) => {
    const data = fixture();
    data.resources = ['100', '584', '305'];
    data.resourceCategories = hasMap ? { ...data.resourceCategories, '100': 'cutting' } : {};
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    const panes = [...screen.getByTestId('planning-board-resource-view').querySelectorAll<HTMLElement>('[data-resource-code]')];
    if (hasMap) expect(panes.map((pane) => pane.dataset.resourceCode)).toEqual(['584', '305', '100']);
    const source = within(screen.getByTestId('planning-board-item-a')).getByRole('button', { name: '資源CD 305を変更' });
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;
    const targetPane = panes.find((pane) => pane.dataset.resourceCode === '100')!;
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [targetPane]) });
    fireEvent.pointerDown(source, { pointerId: 11, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 11, clientX: 21, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 11, clientX: 21, clientY: 10 });
    expect(mocks.overrides).not.toHaveBeenCalled();
  });

  it.each(['納期順に並べる', '並べ替え'])('%s saves through the queue and undoes with acknowledged revisions', async (action) => {
    const data = fixture();
    data.items[0]!.originalDueDate = '2026-10-20';
    data.items[1]!.originalDueDate = '2026-10-17';
    data.items[2]!.originalDueDate = '2026-10-18';
    data.items[3]!.originalDueDate = '2026-10-16';
    const initialIds = planningBoardSorting.sortGrindingPlanningBoardItems(data.items, data.seibanOrder, 'resource', 'alternate').map((item) => item.itemId);
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.resourceOrderBulk.mockImplementation(async (payload) => ({ sourceRevision: data.sourceRevision,
      items: payload.items.map((request: { itemId: string; overrideVersion: number }, index: number) => ({
        ...data.items.find((item) => item.itemId === request.itemId), alternateRank: index + 1,
        version: request.overrideVersion + 1, itemRevision: `saved-${request.itemId}-${request.overrideVersion + 1}`
      })) }));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(screen.getByRole('button', { name: '今日から' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: action }));
    if (action === '並べ替え') {
      expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
      expect(screen.getByRole('status', { name: '並べ替えの比較' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '一括変更' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: '納期順に並べる' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '適用', exact: true }));
    } else {
      expect(screen.queryByRole('status', { name: '並べ替えの比較' })).not.toBeInTheDocument();
    }
    await waitFor(() => expect(mocks.resourceOrderBulk).toHaveBeenCalledTimes(1));
    expect(mocks.resourceOrderBulk.mock.calls[0]![0].items.map((item: { itemId: string }) => item.itemId)).toEqual(['d', 'b', 'c', 'a']);
    await waitFor(() => expect(screen.getByText(action === '並べ替え' ? '並べ替えを保存しました。' : '納期の早い順に並べ直しました')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    await waitFor(() => expect(mocks.resourceOrderBulk).toHaveBeenCalledTimes(2));
    const restored = mocks.resourceOrderBulk.mock.calls[1]![0];
    expect(restored.items.map((item: { itemId: string }) => item.itemId)).toEqual(initialIds);
    expect(restored.items.every((item: { itemRevision: string; overrideVersion: number }) => item.overrideVersion === 3 && item.itemRevision.startsWith('saved-'))).toBe(true);
    await waitFor(() => expect(screen.getByText('1つ前の順番に戻しました')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
  });

  it.each(['305', '306'])('moves a gantt bar between target bars and restores resource %s plus both orders', async (previousResource) => {
    const data = fixture();
    data.resources.push('306');
    data.resourceCategories['306'] = 'grinding';
    data.items[1]!.originalResourceCd = previousResource;
    data.items[2]!.originalResourceCd = '584';
    data.items[3]!.originalResourceCd = '584';
    const items: GrindingPlanningBoardItem[] = data.items.map((item, index) => ({ ...item,
      effectiveResourceCd: index === 0 ? previousResource : item.originalResourceCd, alternateRank: index === 0 ? 2 : index === 1 ? 1 : index + 1 }));
    const server = new Map(items.map((item) => [item.itemId, item]));
    mocks.snapshot.mockReturnValue({ data: { ...data, items }, isLoading: false, isError: false, refetch: mocks.refetch });
    let finishMove!: () => void;
    mocks.overrides.mockImplementation(async (payload) => {
      if (mocks.overrides.mock.calls.length === 1) await new Promise<void>((resolve) => { finishMove = resolve; });
      return { sourceRevision: 'board-1', items: payload.items.map((request: { itemId: string; resourceCd: string; overrideVersion: number }) => {
        const saved = { ...server.get(request.itemId)!, effectiveResourceCd: request.resourceCd, alternateRank: null,
          version: request.overrideVersion + 1, itemRevision: `override-${request.itemId}-${request.overrideVersion + 1}` };
        server.set(saved.itemId, saved); return saved;
      }) };
    });
    mocks.resourceOrderBulk.mockImplementation(async (payload) => ({ sourceRevision: 'board-1',
      items: payload.items.map((request: { itemId: string; overrideVersion: number }, index: number) => {
        const saved = { ...server.get(request.itemId)!, alternateRank: index + 1,
          version: request.overrideVersion + 1, itemRevision: `rank-${request.itemId}-${request.overrideVersion + 1}` };
        server.set(saved.itemId, saved); return saved;
      }) }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const bar = screen.getByTestId('planning-gantt-bar-a');
    const target = screen.getByTestId('planning-gantt-bar-d');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [target]) });
    const x = parseFloat(target.style.left);
    fireEvent.pointerDown(bar, { pointerId: 41, clientX: x, clientY: 20, button: 0 });
    fireEvent.pointerUp(bar, { pointerId: 41, clientX: x, clientY: 120 });
    const laneIds = (resource: string) => [...screen.getByTestId(`planning-forward-lane-${resource}`).querySelectorAll<HTMLElement>('[data-testid^="planning-gantt-bar-"]')]
      .map((element) => element.dataset.testid!.replace('planning-gantt-bar-', '')).filter((id) => !id.includes('-segment-'));
    expect(laneIds('584')).toEqual(['c', 'a', 'd']);
    expect(laneIds(previousResource)).toEqual(['b']);
    expect(mocks.overrides).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ itemId: 'a', resourceCd: '584' })] }));
    expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
    await act(async () => finishMove());
    await waitFor(() => expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeEnabled());
    expect(mocks.resourceOrderBulk.mock.calls[0]![0]).toMatchObject({ resourceCd: '584', items: [
      { itemId: 'c' }, { itemId: 'a', itemRevision: 'override-a-3', overrideVersion: 3 }, { itemId: 'd' }
    ] });
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    expect(laneIds(previousResource)).toEqual(['b', 'a']);
    expect(laneIds('584')).toEqual(['c', 'd']);
    await waitFor(() => expect(mocks.resourceOrderBulk).toHaveBeenCalledTimes(3));
    expect(mocks.overrides.mock.calls[1]![0]).toMatchObject({ items: [{ itemId: 'a', resourceCd: previousResource, itemRevision: 'rank-a-4', overrideVersion: 4 }] });
    expect(mocks.resourceOrderBulk.mock.calls.slice(1).map(([request]) => [request.resourceCd, request.items.map((item: { itemId: string }) => item.itemId)])).toEqual([
      [previousResource, ['b', 'a']], ['584', ['c', 'd']]
    ]);
    expect(mocks.resourceOrderBulk.mock.calls[1]![0].items[1]).toMatchObject({ itemId: 'a', itemRevision: 'override-a-5', overrideVersion: 5 });
    await waitFor(() => expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled());
    expect(laneIds(previousResource)).toEqual(['b', 'a']);
    expect(laneIds('584')).toEqual(['c', 'd']);
  });

  it.each(['special band', 'empty lane', 'override failure', 'order failure', 'unlisted resource', 'different category'])('handles gantt resource movement with %s', async (scenario) => {
    const data = fixture();
    if (scenario !== 'empty lane') data.items[3]!.originalResourceCd = '584';
    if (scenario === 'special band') data.items[3]!.specialDue = { kind: 'today', expiresAt: '2099-10-14T15:00:00Z' };
    if (scenario === 'unlisted resource') data.resources = ['305'];
    if (scenario === 'different category') data.resourceCategories['584'] = 'cutting';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.overrides.mockImplementation(async (payload) => ({ sourceRevision: 'board-1', items: payload.items.map((request: { itemId: string; resourceCd: string; overrideVersion: number }) => ({
      ...data.items.find((item) => item.itemId === request.itemId)!, effectiveResourceCd: request.resourceCd, alternateRank: null,
      version: request.overrideVersion + 1, itemRevision: `override-${request.itemId}-${request.overrideVersion + 1}`
    })) }));
    mocks.resourceOrderBulk.mockImplementation(async (payload) => ({ sourceRevision: 'board-1', items: payload.items.map((request: { itemId: string; overrideVersion: number }, index: number) => ({
      ...data.items.find((item) => item.itemId === request.itemId)!, effectiveResourceCd: payload.resourceCd, alternateRank: index + 1,
      version: request.overrideVersion + 1, itemRevision: `rank-${request.itemId}-${request.overrideVersion + 1}`
    })) }));
    if (scenario === 'override failure') mocks.overrides.mockRejectedValueOnce(new Error('move failed'));
    if (scenario === 'order failure') mocks.resourceOrderBulk.mockRejectedValueOnce(new Error('order failed'));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const target = screen.getByTestId('planning-forward-lane-584');
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [target]) });
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { pointerId: 42, clientX: 0, clientY: 20, button: 0 });
    fireEvent.pointerMove(bar, { pointerId: 42, clientX: 0, clientY: 120 });
    if (scenario === 'unlisted resource' || scenario === 'different category') {
      expect(target.closest('[data-gantt-lane]')).toHaveStyle({ opacity: '0.3' });
      expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
      fireEvent.pointerUp(bar, { pointerId: 42, clientX: 0, clientY: 120 });
      expect(mocks.overrides).not.toHaveBeenCalled();
      expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
      return;
    }
    fireEvent.pointerUp(bar, { pointerId: 42, clientX: 0, clientY: 120 });
    if (scenario === 'override failure') {
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした'));
      expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
      expect(screen.getByTestId('planning-forward-lane-305')).toContainElement(screen.getByTestId('planning-gantt-bar-a'));
      return;
    }
    await waitFor(() => expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeEnabled());
    if (scenario === 'special band') expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
    else if (scenario === 'empty lane') expect(mocks.resourceOrderBulk.mock.calls[0]![0]).toMatchObject({ resourceCd: '584', items: [{ itemId: 'a' }] });
    else expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(2));
    expect(mocks.overrides.mock.calls[1]![0]).toMatchObject({ items: [{ itemId: 'a', resourceCd: '305' }] });
    await waitFor(() => expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled());
    expect(screen.getByTestId('planning-forward-lane-305')).toContainElement(screen.getByTestId('planning-gantt-bar-a'));
  });

  it('shares optimistic pins through the write queue, blocks pending actions and rolls back a failure', async () => {
    const data = fixture();
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    let resolvePin!: (value: unknown) => void;
    mocks.pins.mockImplementationOnce(() => new Promise((resolve) => { resolvePin = resolve; }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    fireEvent.click(screen.getByRole('button', { name: '固定', exact: true }));
    fireEvent.click(screen.getByTestId('planning-gantt-bar-a'));
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('data-gantt-pinned', 'true');
    expect(mocks.pins).toHaveBeenCalledWith({ sourceRevision: 'board-1', pinned: true,
      items: [{ itemId: 'a', itemRevision: 'revision-a', overrideVersion: 2 }] });
    expect(screen.getByRole('button', { name: '並べ替え' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '固定', exact: true })).toBeDisabled();
    await act(async () => resolvePin({ sourceRevision: 'board-1', items: [{ ...data.items[0], orderPinned: true, itemRevision: 'pin-saved', version: 3 }] }));
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('data-gantt-pinned', 'true');
    mocks.pins.mockRejectedValueOnce(new Error('failed'));
    fireEvent.click(screen.getByTestId('planning-gantt-bar-a'));
    await waitFor(() => expect(screen.getByText('保存できませんでした。時間をおいて再試行してください。')).toBeInTheDocument());
    expect(mocks.pins.mock.calls[1]![0]).toMatchObject({ pinned: false, items: [{ itemId: 'a', itemRevision: 'pin-saved', overrideVersion: 3 }] });
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('data-gantt-pinned', 'true');
  });

  it('previews all machine lanes, cancels without writing, and applies only changed lanes', async () => {
    const data = fixture();
    data.items.forEach((item, index) => { item.alternateRank = index + 1; });
    data.items[0]!.originalDueDate = '2026-11-20'; data.items[1]!.originalDueDate = '2026-11-10';
    data.items[2]!.originalResourceCd = '584'; data.items[3]!.originalResourceCd = '584';
    data.items[2]!.originalDueDate = '2026-11-20'; data.items[3]!.originalDueDate = '2026-11-10';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.resourceOrderBulk.mockImplementation(async (payload) => ({ sourceRevision: data.sourceRevision,
      items: payload.items.map((request: { itemId: string }, index: number) => ({ ...data.items.find((item) => item.itemId === request.itemId), alternateRank: index + 1, version: 3, itemRevision: `saved-${request.itemId}` })) }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
    expect(screen.getByTestId('planning-gantt-bar-a')).toBeDisabled();
    expect(screen.getByRole('button', { name: '朝まで' })).toBeDisabled();
    expect(within(screen.getByRole('group', { name: '305の1日の稼働時間' })).getByRole('button', { name: '10H' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(mocks.resourceOrderBulk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    fireEvent.click(screen.getByRole('button', { name: '適用', exact: true }));
    await waitFor(() => expect(mocks.resourceOrderBulk).toHaveBeenCalledTimes(2));
    expect(mocks.resourceOrderBulk.mock.calls.map(([request]) => [request.resourceCd, request.items.map((item: { itemId: string }) => item.itemId)])).toEqual([['305', ['b', 'a']], ['584', ['d', 'c']]]);
    await waitFor(() => expect(screen.getByRole('button', { name: '並べ替え' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(screen.getByText('並べ替える必要はありません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '適用', exact: true })).not.toBeInTheDocument();
  });

  it('does not move pinned slots or write an unchanged pinned lane', async () => {
    const data = fixture();
    data.items[0]!.orderPinned = true;
    data.items.forEach((item, index) => { item.alternateRank = index + 1; });
    data.items[0]!.originalDueDate = '2026-11-20'; data.items[1]!.originalDueDate = '2026-11-10';
    data.items[2]!.originalResourceCd = '584'; data.items[3]!.originalResourceCd = '584';
    data.items[2]!.originalDueDate = '2026-11-20'; data.items[3]!.originalDueDate = '2026-11-10';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.resourceOrderBulk.mockImplementation(async (payload) => ({ sourceRevision: data.sourceRevision,
      items: payload.items.map((request: { itemId: string }, index: number) => ({ ...data.items.find((item) => item.itemId === request.itemId), alternateRank: index + 1, version: 3, itemRevision: `saved-${request.itemId}` })) }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const pinnedLeft = screen.getByTestId('planning-gantt-bar-a').style.left;
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(screen.getByTestId('planning-gantt-bar-a').style.left).toBe(pinnedLeft);
    fireEvent.click(screen.getByRole('button', { name: '適用', exact: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: '並べ替え' })).toBeEnabled());
    expect(mocks.resourceOrderBulk).toHaveBeenCalledTimes(1);
    expect(mocks.resourceOrderBulk.mock.calls[0]![0].resourceCd).toBe('584');
  });

  it('keeps special-due items first after applying an order after a new snapshot and remount', async () => {
    const data = fixture();
    data.items = data.items.slice(0, 3);
    data.items[0]!.specialDue = { kind: 'today', expiresAt: '2099-11-20T10:00:00Z' };
    data.items.forEach((item, index) => { item.alternateRank = index + 1; });
    data.items[0]!.originalDueDate = '2099-11-20'; data.items[1]!.originalDueDate = '2099-11-15';
    data.items[2]!.originalDueDate = '2099-11-10';
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.resourceOrderBulk.mockImplementation(async (payload) => {
      const saved = payload.items.map((request: { itemId: string }, index: number) => ({ ...data.items.find((item) => item.itemId === request.itemId)!, alternateRank: index + 1, version: 3, itemRevision: `saved-${request.itemId}` }));
      data.items = saved;
      return { sourceRevision: data.sourceRevision, items: saved };
    });
    const rendered = render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    fireEvent.click(screen.getByRole('button', { name: '適用', exact: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: '並べ替え' })).toBeEnabled());
    expect(mocks.resourceOrderBulk.mock.calls[0]![0].items.map((item: { itemId: string }) => item.itemId)).toEqual(['a', 'c', 'b']);
    rendered.unmount();
    const remounted = render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(parseFloat(screen.getByTestId('planning-gantt-bar-a').style.left)).toBeLessThan(parseFloat(screen.getByTestId('planning-gantt-bar-c').style.left));
    expect(parseFloat(screen.getByTestId('planning-gantt-bar-c').style.left)).toBeLessThan(parseFloat(screen.getByTestId('planning-gantt-bar-b').style.left));
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(screen.getByText('並べ替える必要はありません')).toBeInTheDocument();
    remounted.unmount();
    data.items.find((item) => item.itemId === 'b')!.specialDue = { kind: 'overnight', expiresAt: '2099-11-20T00:00:00Z' };
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(parseFloat(screen.getByTestId('planning-gantt-bar-b').style.left)).toBeLessThan(parseFloat(screen.getByTestId('planning-gantt-bar-a').style.left));

  });

  it('資源CDの表示で開く', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(screen.getByRole('button', { name: '資源CD', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  it('製番の色分けを切り替えて凡例を表示し、再マウント時はOFFに戻る', () => {
    const first = renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const toggle = screen.getByRole('button', { name: '製番ごとに色分け' });
    const bar = screen.getByTestId('planning-gantt-bar-a');
    const originalClass = bar.className;
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: '製番の色分け凡例' })).toBeVisible();
    expect(bar.className).not.toBe(originalClass);
    fireEvent.click(toggle);
    expect(bar.className).toBe(originalClass);
    expect(screen.queryByRole('group', { name: '製番の色分け凡例' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    first.unmount();
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(screen.getByRole('button', { name: '製番ごとに色分け' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('ガント切替と縮尺変更でボード取得条件が変わらず、通常表示へ戻る', () => {
    renderSeibanBoard();
    const args = mocks.snapshot.mock.calls.at(-1);
    mocks.snapshot.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(screen.getByTestId('planning-board-gantt')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-board-seiban-26-1041')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ガント' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1日' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '他の幅' }));
    fireEvent.click(screen.getByRole('button', { name: '4週' }));
    expect(screen.getByRole('button', { name: '他の幅' })).toHaveTextContent('4週 ▾');
    fireEvent.click(screen.getByRole('button', { name: '納期から' }));
    expect(screen.getByRole('button', { name: '重なりなし' })).toBeInTheDocument();
    expect(mocks.capacity).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    expect(screen.queryByTestId('planning-board-gantt')).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-board-seiban-26-1041')).toBeInTheDocument();
    expect(mocks.capacity).toHaveBeenLastCalledWith(false);
    for (const call of mocks.snapshot.mock.calls) expect(call).toEqual(args);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it('ガントで選択し、離した時だけ指定納期をキュー保存し楽観反映する', async () => {
    mocks.overrides.mockImplementation(() => new Promise(() => {}));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    fireEvent.click(screen.getByRole('button', { name: '納期から' }));
    fireEvent.click(screen.getByRole('button', { name: '他の幅' }));
    fireEvent.click(screen.getByRole('button', { name: '2週' }));
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.click(bar);
    expect(bar).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '一括変更' })).toBeEnabled();
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 214, clientY: 20 });
    expect(mocks.overrides).not.toHaveBeenCalled();
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 214, clientY: 20 });
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledWith({ sourceRevision: 'board-1', items: [
      { itemId: 'a', itemRevision: 'revision-a', overrideVersion: 2, due: { kind: 'date', date: '2026-09-14' } }
    ] }));
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveAttribute('aria-label', expect.stringContaining('納期2026-09-14'));
  });

  it('元割当はガントのドラッグを無効にし、選択は維持する', () => {
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '元割当' }));
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const bar = screen.getByTestId('planning-gantt-bar-a');
    expect(bar).toHaveAttribute('data-drag-disabled', 'true');
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 300 });
    fireEvent.click(bar); // Suppress the synthetic click following a swipe.
    expect(bar).toHaveAttribute('aria-pressed', 'false');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(bar, { pointerId: 2, button: 0, clientX: 100 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(bar, { pointerId: 2, clientX: 100 });
    fireEvent.click(bar);
    vi.useRealTimers();
    expect(bar).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.overrides).not.toHaveBeenCalled();
  });

  it('同日へのドロップとキャンセルでは保存しない', () => {
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: 'ガント' }));
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 110 });
    fireEvent.pointerDown(bar, { pointerId: 2, button: 0, clientX: 100 });
    fireEvent.pointerMove(bar, { pointerId: 2, clientX: 300 });
    fireEvent.pointerCancel(bar, { pointerId: 2 });
    expect(mocks.overrides).not.toHaveBeenCalled();
  });

  it('負荷未着でも一覧と編集操作を使え、別取得の負荷が開いた編集パネルへ反映される', () => {
    const board = { ...fixture(), load: [], loadDeferred: true };
    mocks.snapshot.mockReturnValue({ data: board, isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.load.mockReturnValue({ data: undefined, isLoading: true });
    const page = renderSeibanBoard();
    expect(screen.getAllByRole('button', { name: '資源CD 305を変更' })).toHaveLength(4);
    selectAllBoardItems();
    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const editor = screen.getByRole('dialog', { name: '一括変更' });
    const resource = within(editor).getByRole('button', { name: '資源CD 305へ変更' });
    expect(resource).toBeEnabled();
    expect(resource).toHaveTextContent('…');
    expect(resource).not.toHaveTextContent('0分');
    fireEvent.click(resource);
    expect(editor).not.toHaveTextContent('移動後負荷:');
    const summary = { ...fixture().load[0]!, originalRequiredMinutes: 240, alternateRequiredMinutes: 240, requiredMinutes: 240 };
    mocks.load.mockReturnValue({ data: { load: [summary], unknownRequiredMinutesCount: 0 }, isLoading: false });
    page.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(within(editor).getByRole('button', { name: '資源CD 305へ変更' })).toHaveTextContent('240分');
    expect(editor).toHaveTextContent('移動後負荷: 240分');
    expect(mocks.load).toHaveBeenCalledWith('grinding');
  });

  it('通常表示で製番明細を初期展開し、手動で閉じられる', () => {
    renderSeibanBoard();

    expect(screen.getByTestId('planning-board-seiban-26-1041')).toBeInTheDocument();
    expect(screen.getByTestId('planning-board-seiban-26-1042')).toBeInTheDocument();
    expect(screen.getByText('自動組立機 AX-200')).toBeInTheDocument();
    expect(screen.getByLabelText('部品aを選択')).not.toBeChecked();
    expect(screen.getByLabelText('部品bを選択')).not.toBeChecked();
    expect(screen.getAllByText('5個')).toHaveLength(4);
    expect(screen.queryByText(/3\/20工程/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '選択' })).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-board-item-a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' }));
    expect(screen.queryByTestId('planning-board-item-a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '製番26-1041の明細を開く' })).toBeInTheDocument();
  });

  it('新規登録はactive/openへ追加し、既存の閉じた・除外した状態を変えず、再登録は新規として扱う', () => {
    let current = fixture();
    const view = renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getByRole('button', { name: /^26-1042 / }));

    const newItem = {
      ...current.items[0]!,
      itemId: 'new-item',
      sourceRowId: 'source-new-item',
      fseiban: '26-1043',
      fhincd: 'PART-new-item',
      fhinmei: '部品new-item',
      productNo: 'PRODUCT-new-item'
    };
    current = {
      ...current,
      sourceRevision: 'board-2',
      registeredFseibans: ['26-1041', '26-1042', '26-1043'],
      seibanOrder: ['26-1041', '26-1042', '26-1043'],
      items: [...current.items, newItem]
    };
    mocks.snapshot.mockImplementation(() => ({ data: current, isLoading: false, isError: false, refetch: mocks.refetch }));
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);

    expect(screen.getByRole('button', { name: '製番26-1041の明細を開く' })).toBeInTheDocument();
    expect(screen.queryByTestId('planning-board-seiban-26-1042')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '製番26-1043の明細を閉じる' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const reopenedDrawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(reopenedDrawer).getByRole('button', { name: /^26-1043 / }));
    current = {
      ...current,
      sourceRevision: 'board-3',
      registeredFseibans: ['26-1041', '26-1042'],
      seibanOrder: ['26-1041', '26-1042'],
      items: current.items.filter((item) => item.fseiban !== '26-1043')
    };
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    current = {
      ...current,
      sourceRevision: 'board-4',
      registeredFseibans: ['26-1041', '26-1042', '26-1043'],
      seibanOrder: ['26-1041', '26-1042', '26-1043'],
      items: [...current.items, newItem]
    };
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(screen.getByRole('button', { name: '製番26-1043の明細を閉じる' })).toBeInTheDocument();
  });

  it('保存中も次のドラッグを即時表示し、確定した版で順番に保存する', async () => {
    const replies: ((value: unknown) => void)[] = [];
    mocks.resourceOrder.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD', exact: true }));
    const drag = (from: string, to: string, pointerId: number) => {
      const source = within(screen.getByTestId(`planning-board-item-${from}`)).getByRole('button', { name: '資源CD 305を変更' });
      const pane = source.closest('[data-planning-board-resource-pane]')!;
      const target = screen.getByTestId(`planning-board-item-${to}`);
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [target]) });
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, height: 40 } as DOMRect);
      fireEvent.pointerDown(source, { pointerId, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(pane, { pointerId, clientX: 10, clientY: 21 });
      fireEvent.pointerUp(pane, { pointerId, clientX: 10, clientY: 110 });
    };
    const order = () => [...screen.getByTestId('planning-board-resource-view').querySelectorAll<HTMLElement>('tbody tr')].map((row) => row.dataset.planningBoardItemId);
    drag('d', 'a', 31);
    drag('c', 'd', 32);
    expect(order()).toEqual(['c', 'd', 'a', 'b']);
    expect(mocks.resourceOrder).toHaveBeenCalledTimes(1);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const response = (ids: string[], version: number) => ({ sourceRevision: 'board-1', items: ids.map((id, index) => ({
      ...fixture().items.find((item) => item.itemId === id)!, itemRevision: `${id}-saved-${version}`, version, alternateRank: index + 1
    })) });
    replies[0](response(['d', 'a', 'b', 'c'], 3));
    await waitFor(() => expect(mocks.resourceOrder).toHaveBeenCalledTimes(2));
    expect(mocks.resourceOrder.mock.calls[1][0]).toMatchObject({ itemId: 'c', itemRevision: 'c-saved-3', targetItemId: 'd', targetItemRevision: 'd-saved-3' });
    expect(order()).toEqual(['c', 'd', 'a', 'b']);
    replies[1](response(['c', 'd', 'a', 'b'], 4));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('順序を保存しました'));
    expect(order()).toEqual(['c', 'd', 'a', 'b']);
    const savedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it('資源CD内の並べ替えを即時表示し、保存失敗時に元の順序へ戻す', async () => {
    let rejectResourceOrder: ((error: Error) => void) | undefined;
    mocks.resourceOrder.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectResourceOrder = reject;
    }));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD', exact: true }));

    const resourceView = screen.getByTestId('planning-board-resource-view');
    const rowIds = () => [...resourceView.querySelectorAll<HTMLElement>('tbody tr')]
      .map((row) => row.dataset.planningBoardItemId);
    expect(rowIds()).toEqual(['a', 'b', 'c', 'd']);
    const source = within(screen.getByTestId('planning-board-item-d')).getByRole('button', { name: '資源CD 305を変更' });
    const pane = source.closest('[data-planning-board-resource-pane]')!;
    const targetRow = screen.getByTestId('planning-board-item-a');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetRow])
    });
    vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, height: 40 } as DOMRect);

    fireEvent.pointerDown(source, { pointerId: 21, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pane, { pointerId: 21, clientX: 10, clientY: 21 });
    fireEvent.pointerUp(pane, { pointerId: 21, clientX: 10, clientY: 110 });

    expect(rowIds()).toEqual(['d', 'a', 'b', 'c']);
    expect(within(screen.getByTestId('planning-board-item-a')).getByRole('button', { name: '部品aの個別指定' })).not.toBeDisabled();
    await waitFor(() => expect(mocks.resourceOrder).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'd',
      targetItemId: 'a',
      placement: 'before'
    })));

    rejectResourceOrder?.(new Error('save failed'));
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b', 'c', 'd']));
    expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
  });

  it('機種名数字検索は入力時だけ候補を表示し、解除後も登録製番と選択を保持する', () => {
    const candidates = [
      {
        fseiban: 'CAND-200',
        machineName: '自動組立機 ＡＸ－２００',
        dueDate: '2026-09-12',
        completedProcessCount: 0,
        totalProcessCount: 1,
        isCompleted: false
      },
      {
        fseiban: 'CAND-80',
        machineName: '搬送装置 ＣＶ－８０',
        dueDate: '2026-09-13',
        completedProcessCount: 0,
        totalProcessCount: 1,
        isCompleted: false
      }
    ];
    mocks.candidates.mockReturnValue({
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: 'incomplete',
        candidates
      },
      isLoading: false,
      isFetching: false,
      isError: false
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const machineNameSearch = within(drawer).getByTestId('planning-board-machine-name-search');
    expect(within(drawer).queryByRole('button', { name: '機種名で検索' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('CAND-200を登録候補に選択')).not.toBeInTheDocument();
    expect(within(drawer).getByText('26-1041', { exact: true })).toBeInTheDocument();
    fireEvent.click(within(machineNameSearch).getByRole('button', { name: '2', exact: true }));
    expect(within(drawer).getByLabelText('機種名数字検索値')).toHaveTextContent('2');

    expect(screen.getByLabelText('CAND-200を登録候補に選択')).toBeInTheDocument();
    expect(screen.queryByLabelText('CAND-80を登録候補に選択')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('CAND-200を登録候補に選択'));
    expect(within(drawer).getByText('CAND-200 · 自動組立機 AX-200')).toBeInTheDocument();

    fireEvent.click(within(machineNameSearch).getByRole('button', { name: '入力を1文字削除' }));
    expect(screen.queryByLabelText('CAND-200を登録候補に選択')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('CAND-80を登録候補に選択')).not.toBeInTheDocument();
    expect(within(drawer).getByText('CAND-200 · 自動組立機 AX-200')).toBeInTheDocument();
  });

  it('納期候補を機種名でまとめ、複数選択を一括登録する', async () => {
    const candidates = [
      {
        fseiban: 'CAND-1',
        machineName: '長い機種名 これは36文字を超える末尾検索対象Ａ',
        dueDate: '2026-08-10',
        completedProcessCount: 0,
        totalProcessCount: 2,
        isCompleted: false
      },
      {
        fseiban: 'CAND-2',
        machineName: '長い機種名 これは36文字を超える末尾検索対象Ａ',
        dueDate: '2026-09-20',
        completedProcessCount: 0,
        totalProcessCount: 1,
        isCompleted: false
      },
      {
        fseiban: 'CAND-DONE',
        machineName: null,
        dueDate: '2026-09-21',
        completedProcessCount: 1,
        totalProcessCount: 1,
        isCompleted: true
      }
    ];
    mocks.candidates.mockImplementation((args: [{ completionFilter: string }]) => ({
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: args[0]?.completionFilter,
        candidates
      },
      isLoading: false,
      isFetching: false,
      isError: false
    }));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.change(within(drawer).getByRole('searchbox'), { target: { value: '末尾検索対象Ａ' } });
    expect(screen.getByRole('button', { name: /末尾検索対象Aの候補を閉じる/ })).toBeInTheDocument();
    const overdueCandidateCard = screen.getByLabelText('CAND-1を登録候補に選択').closest('label');
    expect(overdueCandidateCard).not.toBeNull();
    expect(overdueCandidateCard).toHaveTextContent('08/10');
    expect(overdueCandidateCard).toHaveTextContent('未登録');
    expect(overdueCandidateCard).not.toHaveTextContent('納期');
    expect(screen.queryByText(/期限超過/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('CAND-DONEを登録候補に選択')).not.toBeInTheDocument();

    fireEvent.change(within(drawer).getByRole('searchbox'), { target: { value: '末尾検索対象Ａ' } });
    expect(screen.getByLabelText('CAND-1を登録候補に選択')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('CAND-1を登録候補に選択'));
    fireEvent.click(screen.getByLabelText('CAND-2を登録候補に選択'));
    fireEvent.click(screen.getByRole('button', { name: '選択した製番を登録' }));

    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));
    expect(mocks.order.mock.calls[0]?.[0]).toMatchObject({
      sourceRevision: 'board-1',
      fseibans: ['CAND-1', 'CAND-2', '26-1041', '26-1042']
    });
  });

  it('一括登録失敗時は候補選択を保持し、カテゴリ切替時だけ選択を破棄する', async () => {
    const candidates = [{
      fseiban: 'CAND-FAIL',
      machineName: '機種Ｆ',
      dueDate: '2026-09-10',
      completedProcessCount: 0,
      totalProcessCount: 1,
      isCompleted: false
    }];
    mocks.candidates.mockReturnValue({
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: 'incomplete',
        candidates
      },
      isLoading: false,
      isFetching: false,
      isError: false
    });
    mocks.order.mockRejectedValueOnce(new Error('save failed'));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '製番を検索' }), { target: { value: 'CAND' } });
    const candidateCheckbox = screen.getByLabelText('CAND-FAILを登録候補に選択');
    fireEvent.click(candidateCheckbox);
    fireEvent.click(screen.getByRole('button', { name: '選択した製番を登録' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('製番登録を保存できませんでした'));
    expect(candidateCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    await waitFor(() => expect(screen.getByLabelText('CAND-FAILを登録候補に選択')).not.toBeChecked());
  });

  it('登録済み49件で候補を2件選んでも上限超過を送信しない', () => {
    const manyRegistered = Array.from({ length: 49 }, (_, index) => `REGISTERED-${index + 1}`);
    const board = fixture();
    mocks.snapshot.mockReturnValue({
      data: { ...board, registeredFseibans: manyRegistered, seibanOrder: manyRegistered, items: [] },
      isLoading: false,
      isError: false,
      refetch: mocks.refetch
    });
    mocks.candidates.mockReturnValue({
      data: {
        today: '2026-09-11',
        rangeStart: '2026-08-11',
        rangeEnd: '2026-10-11',
        completionFilter: 'incomplete',
        candidates: [
          { fseiban: 'CAND-LIMIT-1', machineName: null, dueDate: '2026-09-12', completedProcessCount: 0, totalProcessCount: 1, isCompleted: false },
          { fseiban: 'CAND-LIMIT-2', machineName: null, dueDate: '2026-09-13', completedProcessCount: 0, totalProcessCount: 1, isCompleted: false }
        ]
      },
      isLoading: false,
      isFetching: false,
      isError: false
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '製番を検索' }), { target: { value: 'CAND' } });
    fireEvent.click(screen.getByLabelText('CAND-LIMIT-1を登録候補に選択'));
    fireEvent.click(screen.getByLabelText('CAND-LIMIT-2を登録候補に選択'));
    const registerButton = screen.getByRole('button', { name: '選択した製番を登録' });
    expect(registerButton).toBeDisabled();
    fireEvent.click(registerButton);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('登録上限50件を超えるため');
  });

  it('資源CD表示は資源名を見出しに表示し、部品情報を上下2段にする', () => {
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));

    expect(screen.getByTestId('planning-board-resource-view')).toBeInTheDocument();
    expect(screen.getByTestId('planning-board-resource-view')).toHaveClass('xl:grid-cols-4');
    for (const checkbox of screen.getAllByRole('checkbox').filter((element) => element.getAttribute('aria-label')?.includes('を選択'))) {
      expect(checkbox).not.toBeChecked();
    }
    expect(screen.getByText('305（研削機Ａ）')).toBeInTheDocument();
    expect(screen.queryByText(/未完\d+件/)).not.toBeInTheDocument();
    expect(screen.queryByText(/合計分/)).not.toBeInTheDocument();
    expect(screen.getAllByText('5個 · 20分').length).toBeGreaterThan(0);
    expect(screen.getAllByText('26-1041 · 自動組立機 AX-200')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '資源CD 305を変更' })[0]).toHaveClass('text-[15px]', 'text-white');
    expect(screen.getByTestId('planning-board-item-a').querySelector('td:nth-child(3)')).toHaveTextContent('1305');
    expect(screen.getByTestId('planning-board-item-c').querySelector('td:nth-child(3)')).toHaveTextContent('2305');
  });

  it('Resource-CDの特別納期はtoolbarで相互排他し、行本体で付与・解除・置換できる', async () => {
    const baseItems = fixture().items;
    const itemA = baseItems.find((item) => item.itemId === 'a')!;
    mocks.overrides
      .mockResolvedValueOnce({
        sourceRevision: 'board-2',
        items: [{ ...itemA, specialDue: { kind: 'today' as const, expiresAt: '2099-09-12T00:00:00.000Z' }, itemRevision: 'revision-a-special-today', version: 3 }]
      })
      .mockResolvedValueOnce({
        sourceRevision: 'board-3',
        items: [{ ...itemA, specialDue: null, itemRevision: 'revision-a-special-cleared', version: 4 }]
      })
      .mockResolvedValueOnce({
        sourceRevision: 'board-4',
        items: [{ ...itemA, specialDue: { kind: 'overnight' as const, expiresAt: '2099-09-13T23:00:00.000Z' }, itemRevision: 'revision-a-special-overnight', version: 5 }]
      });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));

    const todayButton = screen.getByRole('button', { name: '今日中', exact: true });
    const overnightButton = screen.getByRole('button', { name: '朝まで', exact: true });
    const rowA = screen.getByTestId('planning-board-item-a');
    expect(screen.getByLabelText('朝までのアイテム件数')).toHaveTextContent('0件');
    expect(screen.getByLabelText('今日中のアイテム件数')).toHaveTextContent('0件');
    expect(todayButton).toHaveAttribute('aria-pressed', 'false');
    expect(overnightButton).toHaveAttribute('aria-pressed', 'false');
    expect(within(rowA).queryByText('今日中')).not.toBeInTheDocument();

    fireEvent.click(todayButton);
    expect(todayButton).toHaveAttribute('aria-pressed', 'true');
    expect(overnightButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(rowA);
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0]).toMatchObject({ items: [{ itemId: 'a', specialDue: 'today' }] });
    await waitFor(() => expect(within(rowA).getByText('今日中')).toBeInTheDocument());
    expect(screen.getByLabelText('今日中のアイテム件数')).toHaveTextContent('1件');
    expect(rowA).toHaveClass('outline-amber-300');

    fireEvent.click(rowA);
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(2));
    expect(mocks.overrides.mock.calls[1]?.[0]).toMatchObject({ items: [{ itemId: 'a', specialDue: null }] });
    await waitFor(() => expect(within(rowA).queryByText('今日中')).not.toBeInTheDocument());
    expect(screen.getByLabelText('今日中のアイテム件数')).toHaveTextContent('0件');
    expect(rowA).not.toHaveClass('outline-amber-300');

    fireEvent.click(todayButton);
    fireEvent.click(overnightButton);
    expect(todayButton).toHaveAttribute('aria-pressed', 'false');
    expect(overnightButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(rowA);
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(3));
    expect(mocks.overrides.mock.calls[2]?.[0]).toMatchObject({ items: [{ itemId: 'a', specialDue: 'overnight' }] });
    await waitFor(() => expect(screen.getByLabelText('朝までのアイテム件数')).toHaveTextContent('1件'));
    expect(screen.getByLabelText('今日中のアイテム件数')).toHaveTextContent('0件');
  });

  it('特別納期を保存前に表示し、連打を確定版で順番に保存する', async () => {
    const item = fixture().items[0]!;
    let resolveFirst: ((value: unknown) => void) | undefined;
    mocks.overrides.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    fireEvent.click(screen.getByRole('button', { name: '今日中', exact: true }));
    const row = screen.getByTestId(`planning-board-item-${item.itemId}`);
    fireEvent.click(row);
    expect(within(row).getByText('今日中')).toBeInTheDocument();
    expect(row).toHaveClass('outline-amber-300');
    expect(screen.getByLabelText('今日中のアイテム件数')).toHaveTextContent('1件');
    fireEvent.click(screen.getByRole('button', { name: '朝まで', exact: true }));
    fireEvent.click(row);
    expect(within(row).getByText('朝まで')).toBeInTheDocument();
    expect(within(row).queryByText('今日中')).not.toBeInTheDocument();
    expect(mocks.overrides).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst?.({ sourceRevision: 'board-2', items: [{ ...item,
      itemRevision: 'saved-special-1', version: 7,
      specialDue: { kind: 'today', expiresAt: '2099-09-12T00:00:00.000Z' } }] }));
    expect(mocks.overrides).toHaveBeenCalledTimes(2);
    expect(mocks.overrides.mock.calls[1]?.[0]).toMatchObject({ sourceRevision: 'board-2',
      items: [{ itemId: item.itemId, itemRevision: 'saved-special-1', overrideVersion: 7, specialDue: 'overnight' }] });
  });

  it('成功通知は2.5秒で消え、後発通知を古いtimerが消さず、エラーは残る', async () => {
    vi.useFakeTimers();
    try {
      const view = renderSeibanBoard();
      fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
      const selectRank = async (rank: number) => {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '部品bの個別指定' }));
        });
        const picker = screen.getByRole('dialog', { name: '順位を選択' });
        await act(async () => {
          fireEvent.click(within(picker).getByRole('button', { name: String(rank), exact: true }));
          await Promise.resolve();
          await Promise.resolve();
        });
      };

      await selectRank(1);
      expect(screen.getByText('個別順位を保存しました。')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1_000));
      await selectRank(2);
      expect(screen.getByText('個別順位を保存しました。')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1_600));
      expect(screen.getByText('個別順位を保存しました。')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(900));
      expect(screen.queryByText('個別順位を保存しました。')).not.toBeInTheDocument();

      mocks.rank.mockRejectedValueOnce(new Error('rank save failed'));
      await selectRank(3);
      expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('同一scopeの背景再取得中も資源CD編集をロックしない', () => {
    mocks.snapshot.mockReturnValue({
      data: fixture(),
      isLoading: false,
      isFetching: true,
      isError: false,
      isPlaceholderData: false,
      scopeReady: true,
      refetch: mocks.refetch
    });
    renderSeibanBoard();

    const resourceButton = screen.getAllByRole('button', { name: '資源CD 305を変更' })[0]!;
    expect(resourceButton).not.toBeDisabled();
    fireEvent.click(resourceButton);
    expect(screen.getByRole('dialog', { name: '一括変更' })).toBeInTheDocument();
  });

  it('資源CD chipのdragは別paneへのdrop時に既存override経路を1回だけ呼ぶ', async () => {
    const responseItem = {
      ...fixture().items[0]!,
      effectiveResourceCd: '584',
      itemRevision: 'revision-a-after-drag',
      version: 3
    };
    mocks.overrides.mockResolvedValueOnce({ sourceRevision: 'board-2', items: [responseItem] });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));

    const source = screen.getAllByRole('button', { name: '資源CD 305を変更' })[0]!;
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;
    const targetPane = screen.getByTestId('planning-board-resource-view').querySelector('[data-resource-code="584"]')!;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetPane])
    });

    fireEvent.pointerDown(source, { pointerId: 11, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 11, clientX: 21, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 11, clientX: 21, clientY: 10 });
    fireEvent.click(source);

    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0]).toMatchObject({
      sourceRevision: 'board-1',
      items: [{ itemId: 'a', itemRevision: 'revision-a', overrideVersion: 2, resourceCd: '584' }]
    });
    await waitFor(() => expect(screen.getAllByRole('button', { name: '資源CD 584を変更' })).toHaveLength(1));
  });

  it('資源CD chipのdrag保存失敗時は元のpane表示へ戻す', async () => {
    mocks.overrides.mockRejectedValueOnce(new Error('drag save failed'));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));

    const source = screen.getAllByRole('button', { name: '資源CD 305を変更' })[0]!;
    const sourcePane = source.closest('[data-planning-board-resource-pane]')!;
    const targetPane = screen.getByTestId('planning-board-resource-view').querySelector('[data-resource-code="584"]')!;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [targetPane])
    });
    fireEvent.pointerDown(source, { pointerId: 12, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sourcePane, { pointerId: 12, clientX: 21, clientY: 10 });
    fireEvent.pointerUp(sourcePane, { pointerId: 12, clientX: 21, clientY: 10 });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした'));
    expect(screen.getAllByRole('button', { name: '資源CD 305を変更' })).toHaveLength(4);
  });

  it('資源CD変更はPUT完了前に表示し、保存失敗時は元へ戻す', async () => {
    let resolveOverrides: ((value: { sourceRevision: string }) => void) | undefined;
    mocks.overrides.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOverrides = resolve;
    }));
    renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('button', { name: '資源CD 584を変更' }).length).toBeGreaterThan(0);

    resolveOverrides?.({ sourceRevision: 'board-2' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '一括変更' })).not.toBeInTheDocument());
  });

  it('資源CDの保存中も順位変更を即時表示し、保存された版で続ける', async () => {
    const item = fixture().items[1]!;
    let resolveOverride: ((value: unknown) => void) | undefined;
    mocks.overrides.mockImplementationOnce(() => new Promise((resolve) => { resolveOverride = resolve; }));
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    fireEvent.click(within(screen.getByTestId('planning-board-item-b')).getByRole('button', { name: '資源CD 305を変更' }));
    const editor = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(editor).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(editor).getByRole('button', { name: '適用' }));
    expect(screen.queryByRole('dialog', { name: '一括変更' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('planning-board-item-b')).getByRole('button', { name: '資源CD 584を変更' })).toBeInTheDocument();
    chooseResourceRank('部品b', 2);
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('2');
    expect(mocks.rank).not.toHaveBeenCalled();
    await act(async () => resolveOverride?.({ sourceRevision: 'board-2', items: [{ ...item,
      effectiveResourceCd: '584', itemRevision: 'resource-b-3', version: 3 }] }));
    expect(mocks.rank).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'b', itemRevision: 'resource-b-3', overrideVersion: 3, alternateRank: 2 }));
    expect(within(screen.getByTestId('planning-board-item-b')).getByRole('button', { name: '資源CD 584を変更' })).toBeInTheDocument();
  });

  it('資源CD変更の保存失敗時は元の表示へ戻す', async () => {
    mocks.overrides.mockRejectedValueOnce(new Error('override save failed'));
    renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '一括変更' })).getByRole('alert')).toHaveTextContent('保存できませんでした'));
    expect(screen.getAllByRole('button', { name: '資源CD 305を変更' }).length).toBeGreaterThan(0);
  });

  it('資源CD変更の保存済みレスポンスを保持し、遅い古いGETで元へ戻さない', async () => {
    const responseItems = fixture().items.map((item) => ({
      ...item,
      effectiveResourceCd: '584',
      itemRevision: `revision-${item.itemId}-after-override`,
      version: 3,
      alternateRank: null
    }));
    mocks.overrides.mockResolvedValueOnce({ sourceRevision: 'board-1', items: responseItems });
    const view = renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '一括変更' })).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: '資源CD 584を変更' })).toHaveLength(4);

    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, isPlaceholderData: false, refetch: mocks.refetch });
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(screen.getAllByRole('button', { name: '資源CD 584を変更' })).toHaveLength(4);
  });

  it('資源CD表示の個別順位は保存中に即時反映し、再取得後にserver値へ収束する', async () => {
    let current = fixture();
    let resolveRank: ((value: GrindingPlanningBoardRankResponse) => void) | undefined;
    mocks.snapshot.mockImplementation(() => ({
      data: current,
      isLoading: false,
      isError: false,
      refetch: mocks.refetch
    }));
    mocks.rank.mockImplementationOnce(
      (payload: { itemId: string; itemRevision: string; overrideVersion: number; alternateRank: number | null }) =>
        new Promise((resolve) => {
          resolveRank = resolve;
          void payload;
        })
    );

    const view = renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    const rankButton = chooseResourceRank('部品b', 1);

    expect(rankButton).toHaveTextContent('1');
    const rankedRow = screen.getByTestId('planning-board-item-b');
    const earlierRow = screen.getByTestId('planning-board-item-a');
    expect(Boolean(rankedRow.compareDocumentPosition(earlierRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(rankButton).not.toBeDisabled();

    await act(async () => {
      resolveRank?.({ sourceRevision: 'board-1', itemId: 'b', itemRevision: 'revision-b-after-rank', overrideVersion: 3, alternateRank: 1 });
    });
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).not.toBeDisabled();

    current = fixture();
    const refreshedItem = current.items.find((item) => item.itemId === 'b')!;
    refreshedItem.alternateRank = 2;
    refreshedItem.itemRevision = 'revision-b-after-rank';
    refreshedItem.version = 3;
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).not.toBeDisabled());
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('2');
  });

  it('資源CD表示の個別順位は保存失敗時に元の表示へ戻る', async () => {
    mocks.rank.mockRejectedValueOnce(new Error('rank save failed'));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    const rankButton = chooseResourceRank('部品b', 1);
    expect(rankButton).toHaveTextContent('1');

    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('-'));
    const restoredRow = screen.getByTestId('planning-board-item-a');
    const failedRow = screen.getByTestId('planning-board-item-b');
    expect(Boolean(restoredRow.compareDocumentPosition(failedRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('保存成功のrevision/versionでGET未完了でも同一行・別行の次操作を送る', async () => {
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    chooseResourceRank('部品b', 1);
    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).not.toBeDisabled());

    chooseResourceRank('部品b', 2);
    await waitFor(() => expect(mocks.rank).toHaveBeenCalledTimes(2));
    expect(mocks.rank.mock.calls[1]?.[0]).toMatchObject({ itemId: 'b', itemRevision: 'revision-b-after-rank-3', overrideVersion: 3, alternateRank: 2 });

    const otherRankButton = screen.getByRole('button', { name: '部品cの個別指定' });
    await waitFor(() => expect(otherRankButton).not.toBeDisabled());
    chooseResourceRank('部品c', 3);
    await waitFor(() => expect(mocks.rank).toHaveBeenCalledTimes(3));
    expect(mocks.rank.mock.calls[2]?.[0]).toMatchObject({ itemId: 'c', itemRevision: 'revision-c', overrideVersion: 2, alternateRank: 3 });

    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('2');
  });

  it('確定済み順位を保持したまま次操作の保存失敗を元へ戻す', async () => {
    mocks.rank.mockImplementationOnce(async () => ({ sourceRevision: 'board-1', itemId: 'b', itemRevision: 'revision-b-after-rank-3', overrideVersion: 3, alternateRank: 1 }));
    mocks.rank.mockRejectedValueOnce(new Error('second rank save failed'));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    chooseResourceRank('部品b', 1);
    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).not.toBeDisabled());
    chooseResourceRank('部品b', 2);
    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('1'));
    expect(mocks.rank.mock.calls[1]?.[0]).toMatchObject({ itemId: 'b', itemRevision: 'revision-b-after-rank-3', overrideVersion: 3, alternateRank: 2 });
  });

  it('保存済み順位は古いGETやGETエラーで元へ戻さない', async () => {
    let current = fixture();
    mocks.snapshot.mockImplementation(() => ({ data: current, isLoading: false, isError: false, isPlaceholderData: false, refetch: mocks.refetch }));
    const view = renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    chooseResourceRank('部品b', 1);
    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).not.toBeDisabled());

    current = fixture();
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('1');

    mocks.snapshot.mockReturnValue({ data: current, isLoading: false, isError: true, isPlaceholderData: false, refetch: mocks.refetch });
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('1');
  });

  it('同一scopeの背景再取得中は順位を変更でき、placeholder中は変更しない', async () => {
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isFetching: true, isError: false, isPlaceholderData: false, scopeReady: false, refetch: mocks.refetch });
    const initialView = renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    chooseResourceRank('部品b', 1);
    await waitFor(() => expect(mocks.rank).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('個別順位を保存しました'));
    mocks.rank.mockReset();
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isFetching: true, isError: false, isPlaceholderData: true, scopeReady: false, refetch: mocks.refetch });
    initialView.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '資源CD' }).at(-1)!);
    const placeholderRankButton = screen.getAllByRole('button', { name: '部品bの個別指定' }).at(-1)!;
    fireEvent.click(placeholderRankButton);
    expect(mocks.rank).not.toHaveBeenCalled();
    expect(placeholderRankButton).toHaveTextContent('1');
    expect(placeholderRankButton).toBeDisabled();
    initialView.unmount();
  });

  it('製番カード表示も同じ個別順位overlayで保存中に即時反映する', async () => {
    let resolveRank: ((value: GrindingPlanningBoardRankResponse) => void) | undefined;
    mocks.rank.mockImplementationOnce(
      (payload: { itemId: string; itemRevision: string; overrideVersion: number; alternateRank: number | null }) =>
        new Promise((resolve) => {
          resolveRank = resolve;
          void payload;
        })
    );
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041を広げる' }));
    const rankSelect = screen.getByRole('combobox', { name: '部品bの個別指定' });
    fireEvent.change(rankSelect, { target: { value: '1' } });

    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).not.toBeDisabled();
    await act(async () => {
      resolveRank?.({ sourceRevision: 'board-1', itemId: 'b', itemRevision: 'revision-b-after-rank', overrideVersion: 3, alternateRank: 1 });
    });
    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).not.toBeDisabled();
  });

  it('1件の選択と開閉では他の製番・行を再計算しない', () => {
    const sortSpy = vi.spyOn(planningBoardSorting, 'sortGrindingPlanningBoardItems');
    const dueSpy = vi.spyOn(planningBoardSorting, 'resolveGrindingPlanningBoardDueDate');
    const resourceSpy = vi.spyOn(planningBoardSorting, 'resolveGrindingPlanningBoardResource');
    try {
      renderSeibanBoard();
      sortSpy.mockClear();
      dueSpy.mockClear();
      resourceSpy.mockClear();

      fireEvent.click(screen.getByLabelText('部品aを選択'));

      expect(sortSpy).not.toHaveBeenCalled();
      expect(screen.getByLabelText('部品aを選択')).toBeChecked();
      expect(screen.getByText('1件')).toBeInTheDocument();
      expect(dueSpy).toHaveBeenCalledTimes(1);
      expect(dueSpy.mock.calls.every(([item]) => item.itemId === 'a')).toBe(true);
      expect(resourceSpy).toHaveBeenCalledTimes(1);
      expect(resourceSpy.mock.calls.every(([item]) => item.itemId === 'a')).toBe(true);

      sortSpy.mockClear();
      dueSpy.mockClear();
      resourceSpy.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '製番26-1041の明細を閉じる' }));

      expect(sortSpy).not.toHaveBeenCalled();
      expect(dueSpy).not.toHaveBeenCalled();
      expect(resourceSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
      expect(screen.getByText('対象 1件')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    } finally {
      sortSpy.mockRestore();
      dueSpy.mockRestore();
      resourceSpy.mockRestore();
    }
  });


  it('資源CD表示で1件を選択しても他の行を再描画しない', () => {
    const data = { ...fixture(), view: 'resource' as const };
    mocks.snapshot.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });
    const dueSpy = vi.spyOn(planningBoardSorting, 'resolveGrindingPlanningBoardDueDate');
    try {
      renderSeibanBoard();
      fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
      dueSpy.mockClear();
      fireEvent.click(screen.getByLabelText('部品aを選択'));
      expect(screen.getByLabelText('部品aを選択')).toBeChecked();
      expect(dueSpy).toHaveBeenCalledTimes(1);
      expect(dueSpy.mock.calls[0]?.[0].itemId).toBe('a');
      expect(mocks.overrides).not.toHaveBeenCalled();
    } finally { dueSpy.mockRestore(); }
  });

  it('対象を一括変更すると開いた時点のrevisionとversionを送る', async () => {
    renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0]).toMatchObject({ sourceRevision: 'board-1' });
    expect(mocks.overrides.mock.calls[0]?.[0].items).toHaveLength(4);
    expect(mocks.overrides.mock.calls[0]?.[0].items[0]).toMatchObject({ overrideVersion: 2, resourceCd: '584' });
  });

  it('左ペインの製番解除後も工程切替時の選択状態を保つ', () => {
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /^26-1041/ })[0]!);
    expect(screen.queryByTestId('planning-board-seiban-26-1041')).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: '製番登録ペインを閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(screen.getByText('0件')).toBeInTheDocument();
  });

  it('drawerで選んだ単一製番の納期詳細を開き、picker開始時の版を送る', async () => {
    const dueRefetch = vi.fn().mockResolvedValue({ isError: false });
    const detail = {
      fseiban: '26-1041',
      machineName: '自動組立機 ＡＸ－２００',
      dueDate: '2026-09-15',
      processingTypeDueDates: [{ processingType: '研削', dueDate: '2026-09-16' }],
      parts: []
    };
    mocks.dueDetail.mockReturnValue({
      data: {
        original: { ...detail, dueDate: '2026-09-12' },
        alternate: detail,
        sourceGenerationToken: 'source-due-1',
        scopeRevision: 'scope-due-1'
      },
      isLoading: false,
      isError: false,
      refetch: dueRefetch
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /^26-1041/ })[0]!);
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));

    expect(screen.getByRole('complementary', { name: '製番納期アシスト' })).toBeInTheDocument();
    expect(screen.getByText('対象製番:')).toBeInTheDocument();
    const dueButton = screen.getByRole('button', { name: /納期日:/ });
    fireEvent.click(dueButton);
    fireEvent.click(within(screen.getByRole('dialog', { name: '納期日' })).getByRole('button', { name: '今日' }));

    await waitFor(() => expect(mocks.dueScope).toHaveBeenCalledTimes(1));
    expect(mocks.dueScope.mock.calls[0]?.[0]).toMatchObject({
      fseiban: '26-1041',
      payload: {
        sourceGenerationToken: 'source-due-1',
        scopeRevision: 'scope-due-1',
        scope: { kind: 'seiban' }
      }
    });
  });

  it('納期変更はPUT完了前に詳細表示へ反映し、保存中は再編集を止める', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    try {
      let resolveDue: ((value: { scopeRevision: string }) => void) | undefined;
      const detail = {
        fseiban: '26-1041',
        machineName: null,
        dueDate: '2026-09-15',
        processingTypeDueDates: [],
        parts: []
      };
      mocks.dueDetail.mockReturnValue({
        data: {
          original: detail,
          alternate: detail,
          sourceGenerationToken: 'source-due-1',
          scopeRevision: 'scope-due-1'
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn()
      });
      mocks.dueScope.mockImplementationOnce(() => new Promise((resolve) => {
        resolveDue = resolve;
      }));
      renderSeibanBoard();

      fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
      const drawer = screen.getByRole('dialog', { name: '製番登録' });
      fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));
      const dueButton = screen.getByRole('button', { name: /納期日:/ });
      const before = dueButton.textContent;
      fireEvent.click(dueButton);
      fireEvent.click(within(screen.getByRole('dialog', { name: '納期日' })).getByRole('button', { name: '明日' }));

      await waitFor(() => expect(mocks.dueScope).toHaveBeenCalledTimes(1));
      expect(dueButton.textContent).not.toBe(before);
      expect(dueButton).toBeDisabled();
      resolveDue?.({ scopeRevision: 'scope-due-2' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('元割当の納期詳細は参照表示にして日付変更を無効にする', () => {
    const detail = {
      fseiban: '26-1041',
      machineName: null,
      dueDate: '2026-09-12',
      processingTypeDueDates: [],
      parts: []
    };
    mocks.dueDetail.mockReturnValue({
      data: {
        original: detail,
        alternate: detail,
        sourceGenerationToken: 'source-due-1',
        scopeRevision: 'scope-due-1'
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '元割当' }));
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /^26-1041/ })[0]!);
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));

    expect(screen.getByRole('button', { name: /納期日:/ })).toBeDisabled();
  });

  it('別製番へ切り替えた後の遅延納期応答で新しいpickerを閉じない', async () => {
    let resolveDue: ((value: unknown) => void) | undefined;
    const detailFor = (fseiban: string) => ({
      fseiban,
      machineName: null,
      dueDate: '2026-09-15',
      processingTypeDueDates: [],
      parts: []
    });
    mocks.dueDetail.mockImplementation((fseiban: string | null) => ({
      data: fseiban ? {
        original: detailFor(fseiban),
        alternate: detailFor(fseiban),
        sourceGenerationToken: `source-${fseiban}`,
        scopeRevision: `scope-${fseiban}`
      } : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    }));
    mocks.dueScope.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDue = resolve;
    }));

    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: /納期日:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '納期日' })).getByRole('button', { name: '今日' }));
    await waitFor(() => expect(mocks.dueScope).toHaveBeenCalledTimes(1));

    fireEvent.click(within(drawer).getByRole('button', { name: /^26-1042 / }));
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1042の納期詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: /納期日:/ }));
    expect(screen.getByRole('dialog', { name: '納期日' })).toBeInTheDocument();

    resolveDue?.({});
    await waitFor(() => expect(screen.getByRole('complementary', { name: '製番納期アシスト' })).toHaveTextContent('対象製番: 26-1042'));
    expect(screen.getByRole('dialog', { name: '納期日' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('納期409後は編集を止め、明示的な最新取得まで再送しない', async () => {
    const dueRefetch = vi.fn().mockResolvedValue({ isError: false });
    const detail = {
      fseiban: '26-1041',
      machineName: null,
      dueDate: '2026-09-15',
      processingTypeDueDates: [],
      parts: []
    };
    mocks.dueDetail.mockReturnValue({
      data: {
        original: detail,
        alternate: detail,
        sourceGenerationToken: 'source-due-1',
        scopeRevision: 'scope-due-1'
      },
      isLoading: false,
      isError: false,
      refetch: dueRefetch
    });
    mocks.dueScope.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /^26-1041/ })[0]!);
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: /納期日:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '納期日' })).getByRole('button', { name: '今日' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('表示中の納期が更新されています'));
    expect(mocks.dueScope).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /納期日:/ })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(dueRefetch).toHaveBeenCalledTimes(2));
  });

  it('元割当表示では共有製番順の変更操作を無効にする', () => {
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '元割当' }));
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    expect(within(drawer).getByRole('button', { name: '製番26-1041を上へ' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '製番26-1041の登録を解除' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '登録' })).toBeDisabled();
  });

  it('登録製番を順位つきのリストで出し、端の行では動かせない向きを無効にする', () => {
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const rows = within(within(drawer).getByRole('list', { name: '登録製番' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent?.slice(0, 9))).toEqual(['1✓26-1041', '2✓26-1042']);
    expect(within(drawer).getByText('2/50')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '製番26-1041を上へ' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '製番26-1041を下へ' })).not.toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '製番26-1042を上へ' })).not.toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '製番26-1042を下へ' })).toBeDisabled();
  });

  it('製番順409時は最新状態を明示取得できる', async () => {
    mocks.order.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1042を上へ' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('表示中のデータが更新されています'));
    expect(screen.getByTestId('planning-board-seiban-26-1042')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得しました');
  });

  it('製番順の保存中は並行リクエストを送らない', async () => {
    let resolveOrder: ((value: { sourceRevision: string; seibanOrder: string[] }) => void) | undefined;
    mocks.order.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOrder = resolve;
    }));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const moveUp = within(drawer).getByRole('button', { name: '製番26-1042を上へ' });
    fireEvent.click(moveUp);
    const secondMove = within(drawer).getByRole('button', { name: '製番26-1041を上へ' });
    expect(secondMove).not.toBeDisabled();
    fireEvent.click(secondMove);

    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));
    expect(mocks.order).toHaveBeenCalledTimes(1);
    resolveOrder?.({ sourceRevision: 'board-2', seibanOrder: ['26-1042', '26-1041'] });
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(2));
    expect(mocks.order.mock.calls[1]?.[0]).toEqual({ sourceRevision: 'board-2', fseibans: ['26-1041', '26-1042'] });
  });

  it('製番登録成功後に古いsnapshotで追加製番を消さない', async () => {
    const updated = fixture();
    updated.sourceRevision = 'board-2';
    updated.registeredFseibans = ['26-1043', '26-1041', '26-1042'];
    updated.seibanOrder = updated.registeredFseibans;
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.order.mockImplementationOnce(async () => {
      mocks.snapshot.mockReturnValue({ data: updated, isLoading: false, isError: false, refetch: mocks.refetch });
      return { sourceRevision: 'board-2', seibanOrder: updated.registeredFseibans };
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));

    await waitFor(() => expect(mocks.order).toHaveBeenCalledWith({
      sourceRevision: 'board-1',
      fseibans: ['26-1043', '26-1041', '26-1042']
    }));
    await waitFor(() => expect(within(drawer).getAllByRole('button', { name: /26-1043/ }).length).toBeGreaterThan(0));
  });

  it('登録成功レスポンスのrevisionで連続登録する', async () => {
    let current = fixture();
    mocks.snapshot.mockImplementation(() => ({ data: current, isLoading: false, isError: false, refetch: mocks.refetch }));
    mocks.order
      .mockImplementationOnce(async () => {
        current = fixture();
        current.sourceRevision = 'board-2';
        current.registeredFseibans = ['26-1043', '26-1041', '26-1042'];
        current.seibanOrder = current.registeredFseibans;
        return { sourceRevision: 'board-2', seibanOrder: current.registeredFseibans };
      })
      .mockImplementationOnce(async () => {
        current = fixture();
        current.sourceRevision = 'board-3';
        current.registeredFseibans = ['26-1044', '26-1043', '26-1041', '26-1042'];
        current.seibanOrder = current.registeredFseibans;
        return { sourceRevision: 'board-3', seibanOrder: current.registeredFseibans };
      });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '26-1044' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(2));
    expect(mocks.order.mock.calls[1]?.[0]).toMatchObject({ sourceRevision: 'board-2', fseibans: ['26-1044', '26-1043', '26-1041', '26-1042'] });
  });

  it('遅い古いGETを挟んでも連続製番順保存は最新応答revisionを使う', async () => {
    const initial = fixture();
    const staleAfterFirst = fixture();
    staleAfterFirst.sourceRevision = 'board-2';
    staleAfterFirst.registeredFseibans = ['26-1043', '26-1041', '26-1042'];
    staleAfterFirst.seibanOrder = staleAfterFirst.registeredFseibans;
    const staleInitial = fixture();
    mocks.snapshot.mockImplementation(() => ({ data: initial, isLoading: false, isError: false, refetch: mocks.refetch }));
    mocks.order
      .mockResolvedValueOnce({ sourceRevision: 'board-2', seibanOrder: staleAfterFirst.seibanOrder })
      .mockResolvedValueOnce({ sourceRevision: 'board-3', seibanOrder: ['26-1044', '26-1043', '26-1041', '26-1042'] });
    const view = renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '26-1044' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(2));
    expect(mocks.order.mock.calls[1]?.[0]).toMatchObject({ sourceRevision: 'board-2' });

    mocks.snapshot.mockReturnValue({ data: staleAfterFirst, isLoading: false, isError: false, refetch: mocks.refetch });
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(within(drawer).getAllByRole('button', { name: /26-1044/ }).length).toBeGreaterThan(0);

    mocks.snapshot.mockReturnValue({ data: staleInitial, isLoading: false, isError: false, refetch: mocks.refetch });
    view.rerender(<ProductionScheduleGrindingPlanningBoardPage />);
    expect(within(drawer).getAllByRole('button', { name: /26-1044/ }).length).toBeGreaterThan(0);
  });

  it('登録中に次の製番を入力しても成功処理で消さない', async () => {
    let resolveOrder: ((value: { sourceRevision: string; seibanOrder: string[] }) => void) | undefined;
    mocks.order.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOrder = resolve;
    }));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '26-1044' } });
    resolveOrder?.({ sourceRevision: 'board-2', seibanOrder: ['26-1043', '26-1041', '26-1042'] });
    await waitFor(() => expect(input).toHaveValue('26-1044'));
  });

  it('登録成功後に他端末の異なる順序を含むsnapshotを自動反映する', async () => {
    let current = fixture();
    mocks.snapshot.mockImplementation(() => ({ data: current, isLoading: false, isError: false, refetch: mocks.refetch }));
    mocks.order.mockImplementationOnce(async () => {
      current = fixture();
      current.sourceRevision = 'board-2';
      current.registeredFseibans = ['26-1043', '26-1041', '26-1042'];
      current.seibanOrder = current.registeredFseibans;
      return { sourceRevision: 'board-2', seibanOrder: current.registeredFseibans };
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(within(drawer).getAllByRole('button', { name: /26-1043/ }).length).toBeGreaterThan(0));

    await waitFor(() => expect(input).toHaveValue(''));
    current = fixture();
    current.sourceRevision = 'board-3';
    current.registeredFseibans = ['26-1050', '26-1041'];
    current.seibanOrder = current.registeredFseibans;
    fireEvent.click(screen.getByRole('button', { name: '切削' }));

    await waitFor(() => expect(within(drawer).getAllByRole('button', { name: /26-1050/ }).length).toBeGreaterThan(0));
    expect(within(drawer).queryAllByRole('button', { name: /26-1043/ })).toHaveLength(0);
  });

  it('409後の最新snapshot revisionを次の登録へ使う', async () => {
    const refreshed = fixture();
    refreshed.sourceRevision = 'board-3';
    refreshed.registeredFseibans = ['26-1050', '26-1041'];
    refreshed.seibanOrder = ['26-1050', '26-1041'];
    mocks.order
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } })
      .mockResolvedValueOnce({ sourceRevision: 'board-4', seibanOrder: ['26-1051', '26-1050', '26-1041'] });
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.refetch.mockImplementationOnce(async () => {
      mocks.snapshot.mockReturnValue({ data: refreshed, isLoading: false, isError: false, refetch: mocks.refetch });
      return { data: refreshed, isError: false };
    });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(within(drawer).getByRole('alert')).toHaveTextContent('他端末で更新'));
    fireEvent.click(within(drawer).getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得しました'));

    fireEvent.change(input, { target: { value: '26-1051' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(2));
    expect(mocks.order.mock.calls[1]?.[0]).toMatchObject({ sourceRevision: 'board-3' });
  });

  it('共通数字キーは選択欄へ入力し、常設英字とハイフンは製番へ入力する', () => {
    renderSeibanBoard();
    expect(mocks.candidates.mock.calls.at(-1)?.[1]).toEqual({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    expect(mocks.candidates.mock.calls.at(-1)?.[1]).toEqual({ enabled: true });
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    expect(within(drawer).queryByRole('button', { name: 'キーボードを開く' })).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: '2', exact: true }));
    expect(input).toHaveValue('');
    expect(within(drawer).getByLabelText('機種名数字検索値')).toHaveTextContent('2');
    fireEvent.focus(input);
    fireEvent.click(within(drawer).getByRole('button', { name: '6', exact: true }));
    fireEvent.click(within(drawer).getByRole('button', { name: '製番にハイフンを入力' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'A', exact: true }));
    expect(input).toHaveValue('6-A');
    fireEvent.click(within(drawer).getByRole('button', { name: '入力を1文字削除' }));
    expect(input).toHaveValue('6-');
    fireEvent.click(within(drawer).getByRole('button', { name: '機種名数字検索値' }));
    fireEvent.click(within(drawer).getByRole('button', { name: '0', exact: true }));
    expect(within(drawer).getByLabelText('機種名数字検索値')).toHaveTextContent('20');
    expect(input).toHaveValue('6-');
    fireEvent.click(within(drawer).getByRole('button', { name: '入力をリセット' }));
    expect(within(drawer).getByLabelText('機種名数字検索値')).toHaveTextContent('—');
    fireEvent.click(within(drawer).getByRole('button', { name: '製番登録ペインを閉じる' }));
    expect(mocks.candidates.mock.calls.at(-1)?.[1]).toEqual({ enabled: false });
  });

  it('検索に一致しなくても登録製番は全件表示し、選択状態と並び順を保持する', () => {
    renderSeibanBoard();
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    const registeredCards = () => within(drawer).getAllByRole('button', { name: /^26-104[12] / });
    const initialCards = registeredCards();
    const initialSelection = initialCards.map((card) => card.getAttribute('aria-pressed'));
    expect(initialCards).toHaveLength(2);

    fireEvent.focus(input);
    fireEvent.click(within(drawer).getByRole('button', { name: '9', exact: true }));
    expect(input).toHaveValue('9');
    expect(registeredCards()).toEqual(initialCards);
    expect(registeredCards().map((card) => card.getAttribute('aria-pressed'))).toEqual(initialSelection);
    expect(within(drawer).queryByText('登録製番がありません。')).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: '機種名数字検索値' }));
    fireEvent.click(within(drawer).getByRole('button', { name: '8', exact: true }));
    expect(registeredCards()).toEqual(initialCards);
    fireEvent.click(within(drawer).getByRole('button', { name: '入力をリセット' }));
    expect(registeredCards()).toEqual(initialCards);
  });

  it('製番登録に失敗した場合は入力値と近傍エラーを保持する', async () => {
    mocks.order.mockRejectedValueOnce(new Error('registration failed'));
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));

    await waitFor(() => expect(within(drawer).getByRole('alert')).toHaveTextContent('製番登録を保存できませんでした'));
    expect(input).toHaveValue('26-1043');
  });

  it('順位409時も最新状態を明示取得できる', async () => {
    mocks.rank.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    renderSeibanBoard();

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041を広げる' }));
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '1' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得してください'));
    fireEvent.click(screen.getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得しました');
  });

  it('409時は固定した編集対象を再表示し、再適用を自動実行しない', async () => {
    mocks.overrides.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '一括変更' })).getByRole('alert')).toHaveTextContent('表示中のデータが更新されています'));
    expect(mocks.overrides).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('dialog', { name: '一括変更' })).getByRole('button', { name: '最新状態を取得して閉じる' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: '一括変更' })).not.toBeInTheDocument();
  });

  it('再取得で表示データが変わっても開いた編集snapshotのrevisionを送る', async () => {
    const refreshed = fixture();
    refreshed.sourceRevision = 'board-after-refetch';
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, refetch: mocks.refetch });
    renderSeibanBoard();
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    mocks.snapshot.mockReturnValue({ data: refreshed, isLoading: false, isError: false, refetch: mocks.refetch });
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0].sourceRevision).toBe('board-1');
  });
});
