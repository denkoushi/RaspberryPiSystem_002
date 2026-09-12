import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as planningBoardSorting from '../../features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems';

import { ProductionScheduleGrindingPlanningBoardPage } from './ProductionScheduleGrindingPlanningBoardPage';

import type { GrindingPlanningBoardRankResponse } from '@raspi-system/shared-types';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  refetch: vi.fn(),
  overrides: vi.fn(),
  candidates: vi.fn(),
  dueDetail: vi.fn(),
  dueScope: vi.fn(),
  rank: vi.fn(),
  resourceOrder: vi.fn(),
  order: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
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
  useUpdateKioskGrindingPlanningBoardOverrides: () => ({ mutateAsync: mocks.overrides, isPending: false }),
  useUpdateKioskGrindingPlanningBoardDueScope: () => ({ mutateAsync: mocks.dueScope, isPending: false }),
  useUpdateKioskGrindingPlanningBoardRank: () => ({ mutateAsync: mocks.rank, isPending: false }),
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
    alternateRank: null,
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

describe('ProductionScheduleGrindingPlanningBoardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    mocks.snapshot.mockReset();
    mocks.refetch.mockReset();
    mocks.overrides.mockReset();
    mocks.candidates.mockReset();
    mocks.dueDetail.mockReset();
    mocks.dueScope.mockReset();
    mocks.rank.mockReset();
    mocks.resourceOrder.mockReset();
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
    vi.unstubAllGlobals();
  });

  it('通常表示で製番明細を初期展開し、手動で閉じられる', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    const view = render(<ProductionScheduleGrindingPlanningBoardPage />);

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

  it('資源CD内の並べ替えを即時表示し、保存失敗時に元の順序へ戻す', async () => {
    let rejectResourceOrder: ((error: Error) => void) | undefined;
    mocks.resourceOrder.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectResourceOrder = reject;
    }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    expect(within(screen.getByTestId('planning-board-item-a')).getByRole('button', { name: '部品aの個別指定' })).toBeDisabled();
    await waitFor(() => expect(mocks.resourceOrder).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'd',
      targetItemId: 'a',
      placement: 'before'
    })));

    rejectResourceOrder?.(new Error('save failed'));
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b', 'c', 'd']));
    expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
  });

  it('機種名数字検索は候補だけを絞り、解除で選択済み製番も含めて復帰する', () => {
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const machineNameSearch = within(drawer).getByTestId('planning-board-machine-name-search');
    expect(within(drawer).queryByRole('button', { name: '機種名で検索' })).not.toBeInTheDocument();
    fireEvent.click(within(machineNameSearch).getByRole('button', { name: '2', exact: true }));
    expect(within(machineNameSearch).getByLabelText('機種名数字検索値')).toHaveTextContent('2');

    expect(screen.getByLabelText('CAND-200を登録候補に選択')).toBeInTheDocument();
    expect(screen.queryByLabelText('CAND-80を登録候補に選択')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('CAND-200を登録候補に選択'));
    expect(within(drawer).getByText('CAND-200 · 自動組立機 AX-200')).toBeInTheDocument();

    fireEvent.click(within(machineNameSearch).getByRole('button', { name: '機種名数字を1文字削除' }));
    expect(screen.getByLabelText('CAND-200を登録候補に選択')).toBeInTheDocument();
    expect(screen.getByLabelText('CAND-80を登録候補に選択')).toBeInTheDocument();
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    fireEvent.click(screen.getByLabelText('CAND-LIMIT-1を登録候補に選択'));
    fireEvent.click(screen.getByLabelText('CAND-LIMIT-2を登録候補に選択'));
    const registerButton = screen.getByRole('button', { name: '選択した製番を登録' });
    expect(registerButton).toBeDisabled();
    fireEvent.click(registerButton);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('登録上限50件を超えるため');
  });

  it('資源CD表示は資源名を見出しに表示し、部品情報を上下2段にする', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));

    const todayButton = screen.getByRole('button', { name: '今日中', exact: true });
    const overnightButton = screen.getByRole('button', { name: '朝まで', exact: true });
    const rowA = screen.getByTestId('planning-board-item-a');
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

    fireEvent.click(rowA);
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(2));
    expect(mocks.overrides.mock.calls[1]?.[0]).toMatchObject({ items: [{ itemId: 'a', specialDue: null }] });
    await waitFor(() => expect(within(rowA).queryByText('今日中')).not.toBeInTheDocument());

    fireEvent.click(todayButton);
    fireEvent.click(overnightButton);
    expect(todayButton).toHaveAttribute('aria-pressed', 'false');
    expect(overnightButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(rowA);
    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(3));
    expect(mocks.overrides.mock.calls[2]?.[0]).toMatchObject({ items: [{ itemId: 'a', specialDue: 'overnight' }] });
  });

  it('成功通知は2.5秒で消え、後発通知を古いtimerが消さず、エラーは残る', async () => {
    vi.useFakeTimers();
    try {
      const view = render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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

  it('資源CD変更の保存失敗時は元の表示へ戻す', async () => {
    mocks.overrides.mockRejectedValueOnce(new Error('override save failed'));
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('保存できませんでした'));
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
    const view = render(<ProductionScheduleGrindingPlanningBoardPage />);
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

    const view = render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    const rankButton = chooseResourceRank('部品b', 1);

    expect(rankButton).toHaveTextContent('1');
    const rankedRow = screen.getByTestId('planning-board-item-b');
    const earlierRow = screen.getByTestId('planning-board-item-a');
    expect(Boolean(rankedRow.compareDocumentPosition(earlierRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(rankButton).toBeDisabled();

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    const rankButton = chooseResourceRank('部品b', 1);
    expect(rankButton).toHaveTextContent('1');

    await waitFor(() => expect(screen.getByRole('button', { name: '部品bの個別指定' })).toHaveTextContent('-'));
    const restoredRow = screen.getByTestId('planning-board-item-a');
    const failedRow = screen.getByTestId('planning-board-item-b');
    expect(Boolean(restoredRow.compareDocumentPosition(failedRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('保存成功のrevision/versionでGET未完了でも同一行・別行の次操作を送る', async () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    const view = render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '資源CD' }));
    chooseResourceRank('部品b', 1);
    await waitFor(() => expect(mocks.rank).toHaveBeenCalledTimes(1));

    mocks.rank.mockReset();
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isFetching: true, isError: false, isPlaceholderData: true, scopeReady: false, refetch: mocks.refetch });
    const placeholderView = render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '資源CD' }).at(-1)!);
    const placeholderRankButton = screen.getAllByRole('button', { name: '部品bの個別指定' }).at(-1)!;
    fireEvent.click(placeholderRankButton);
    expect(mocks.rank).not.toHaveBeenCalled();
    expect(placeholderRankButton).toHaveTextContent('-');
    placeholderView.unmount();
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041を広げる' }));
    const rankSelect = screen.getByRole('combobox', { name: '部品bの個別指定' });
    fireEvent.change(rankSelect, { target: { value: '1' } });

    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).toHaveValue('1');
    expect(screen.getByRole('combobox', { name: '部品bの個別指定' })).toBeDisabled();
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
      render(<ProductionScheduleGrindingPlanningBoardPage />);
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
      render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
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

    render(<ProductionScheduleGrindingPlanningBoardPage />);
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /^26-1041/ })[0]!);
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1041の納期詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: /納期日:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '納期日' })).getByRole('button', { name: '今日' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('表示中の納期が更新されています'));
    expect(mocks.dueScope).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /納期日:/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(dueRefetch).toHaveBeenCalledTimes(1));
  });

  it('元割当表示では共有製番順の変更操作を無効にする', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '元割当' }));
    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    expect(within(drawer).getByRole('button', { name: '製番26-1041を上へ' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '製番26-1041の登録を解除' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: '登録' })).toBeDisabled();
  });

  it('製番順409時は最新状態を明示取得できる', async () => {
    mocks.order.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getByRole('button', { name: '製番26-1042を上へ' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('製番順が更新されています'));
    expect(screen.getByTestId('planning-board-seiban-26-1042')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得しました');
  });

  it('製番順の保存中は並行リクエストを送らない', async () => {
    let resolveOrder: ((value: { sourceRevision: string; seibanOrder: string[] }) => void) | undefined;
    mocks.order.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOrder = resolve;
    }));
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const moveUp = within(drawer).getByRole('button', { name: '製番26-1042を上へ' });
    fireEvent.click(moveUp);
    fireEvent.click(moveUp);

    await waitFor(() => expect(mocks.order).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(moveUp).toBeDisabled());
    resolveOrder?.({ sourceRevision: 'board-2', seibanOrder: ['26-1042', '26-1041'] });
    await waitFor(() => expect(moveUp).not.toBeDisabled());
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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    const view = render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.change(input, { target: { value: '26-1043' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(within(drawer).getAllByRole('button', { name: /26-1043/ }).length).toBeGreaterThan(0));

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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

  it('ソフトキーの値はモーダルと背面の登録入力へ反映する', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    const input = within(drawer).getByRole('searchbox', { name: '製番を検索' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'キーボードを開く' }));
    const keyboard = screen.getByRole('dialog', { name: 'キーボード入力' });
    fireEvent.click(within(keyboard).getByRole('button', { name: '2', exact: true }));
    fireEvent.click(within(keyboard).getByRole('button', { name: '6', exact: true }));
    expect(within(keyboard).getByText('26')).toBeInTheDocument();
    fireEvent.click(within(keyboard).getByRole('button', { name: 'Backspace' }));
    expect(within(keyboard).getAllByText('2')[0]).toBeInTheDocument();
    fireEvent.click(within(keyboard).getByRole('button', { name: 'Cancel' }));
    expect(input).toHaveValue('');

    fireEvent.click(within(drawer).getByRole('button', { name: 'キーボードを開く' }));
    const reopenedKeyboard = screen.getByRole('dialog', { name: 'キーボード入力' });
    fireEvent.click(within(reopenedKeyboard).getByRole('button', { name: '2', exact: true }));
    fireEvent.click(within(reopenedKeyboard).getByRole('button', { name: '6', exact: true }));
    fireEvent.click(within(reopenedKeyboard).getByRole('button', { name: 'OK' }));
    expect(input).toHaveValue('26');
  });

  it('製番登録に失敗した場合は入力値と近傍エラーを保持する', async () => {
    mocks.order.mockRejectedValueOnce(new Error('registration failed'));
    render(<ProductionScheduleGrindingPlanningBoardPage />);

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
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041を広げる' }));
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '1' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得してください'));
    fireEvent.click(screen.getByRole('button', { name: '最新状態を取得' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('最新状態を取得しました');
  });

  it('409時は固定した編集対象を閉じず、再適用を自動実行しない', async () => {
    mocks.overrides.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('表示中のデータが更新されています'));
    expect(mocks.overrides).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '最新状態を取得して閉じる' }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: '一括変更' })).not.toBeInTheDocument();
  });

  it('再取得で表示データが変わっても開いた編集snapshotのrevisionを送る', async () => {
    const refreshed = fixture();
    refreshed.sourceRevision = 'board-after-refetch';
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false });
    render(<ProductionScheduleGrindingPlanningBoardPage />);
    selectAllBoardItems();

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    mocks.snapshot.mockReturnValue({ data: refreshed, isLoading: false, isError: false });
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0].sourceRevision).toBe('board-1');
  });
});
