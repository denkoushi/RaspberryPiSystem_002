import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleGrindingPlanningBoardPage } from './ProductionScheduleGrindingPlanningBoardPage';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  refetch: vi.fn(),
  overrides: vi.fn(),
  rank: vi.fn(),
  order: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useKioskGrindingPlanningBoardSnapshot: (...args: unknown[]) => mocks.snapshot(...args),
  useUpdateKioskGrindingPlanningBoardOverrides: () => ({ mutateAsync: mocks.overrides, isPending: false }),
  useUpdateKioskGrindingPlanningBoardRank: () => ({ mutateAsync: mocks.rank, isPending: false }),
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
    machineName: fseiban === '26-1041' ? '自動組立機 AX-200' : '搬送装置 CV-80',
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

describe('ProductionScheduleGrindingPlanningBoardPage', () => {
  beforeEach(() => {
    mocks.snapshot.mockReset();
    mocks.refetch.mockReset();
    mocks.overrides.mockReset();
    mocks.rank.mockReset();
    mocks.order.mockReset();
    mocks.refetch.mockResolvedValue({ data: fixture() });
    mocks.snapshot.mockReturnValue({ data: fixture(), isLoading: false, isError: false, refetch: mocks.refetch });
    mocks.overrides.mockResolvedValue({ sourceRevision: 'board-2' });
    mocks.rank.mockResolvedValue({ sourceRevision: 'board-2' });
    mocks.order.mockResolvedValue({ sourceRevision: 'board-2', seibanOrder: ['26-1041', '26-1042'] });
  });

  it('通常表示から製番を広げ、製番別進捗を表示する', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    expect(screen.getByTestId('planning-board-seiban-26-1041')).toBeInTheDocument();
    expect(screen.getByTestId('planning-board-seiban-26-1042')).toBeInTheDocument();
    expect(screen.getByText(/3\/20工程/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '製番26-1041を広げる' }));
    expect(screen.getByTestId('planning-board-focus-view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '製番26-1041を一覧に戻す' })).toBeInTheDocument();
  });

  it('対象を一括変更すると開いた時点のrevisionとversionを送る', async () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '一括変更' }));
    const dialog = screen.getByRole('dialog', { name: '一括変更' });
    fireEvent.click(within(dialog).getByRole('button', { name: '資源CD 584へ変更' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '適用' }));

    await waitFor(() => expect(mocks.overrides).toHaveBeenCalledTimes(1));
    expect(mocks.overrides.mock.calls[0]?.[0]).toMatchObject({ sourceRevision: 'board-1' });
    expect(mocks.overrides.mock.calls[0]?.[0].items).toHaveLength(4);
    expect(mocks.overrides.mock.calls[0]?.[0].items[0]).toMatchObject({ overrideVersion: 2, resourceCd: '584' });
  });

  it('左ペインの製番解除は工程切替後も別の除外状態を保つ', () => {
    render(<ProductionScheduleGrindingPlanningBoardPage />);

    fireEvent.click(screen.getByRole('button', { name: '製番登録ペインを開く' }));
    const drawer = screen.getByRole('dialog', { name: '製番登録' });
    fireEvent.click(within(drawer).getAllByRole('button', { name: /26-1041/ })[0]!);
    expect(screen.queryByTestId('planning-board-seiban-26-1041')).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: '製番登録ペインを閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(screen.getByText('2件')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: '最新状態を取得' }));
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
