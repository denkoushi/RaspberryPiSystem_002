import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { memo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlanningBoardCompletion } from '../usePlanningBoardCompletion';

import type { GrindingPlanningBoardItem, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ rowCompletion: vi.fn() }));
vi.mock('../../../../api/hooks', () => ({
  useSetKioskProductionScheduleRowCompletion: () => ({ mutateAsync: mocks.rowCompletion })
}));

type Options = Parameters<typeof usePlanningBoardCompletion>[0];
const item = (id: string, extra: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: id, kind: 'row', itemRevision: `${id}-revision`, version: 1, sourceRowId: 'source-parent',
  fseiban: 'S1', fhincd: 'H1', fhinmei: '部品', machineName: '機械', productNo: 'P1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: '305', originalDueDate: null, effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 5, requiredMinutes: 100,
  lslhSurface: false, requiredMinutesKnown: true, isCompleted: false, completionSource: null,
  progress: { completed: 0, total: 1, quantityKnown: true }, ...extra
});
const piece = (id: string, extra: Partial<GrindingPlanningBoardItem> = {}) => item(`piece:${id}`, {
  kind: 'piece', parentItemId: 'parent', pieceId: id, piecePosition: id === 'a' ? 0 : 1,
  pieceSetVersion: 1, quantity: id === 'a' ? 2 : 3, parentPlannedQuantity: 5, ...extra
});
const initialPieces = () => [piece('a'), piece('b')];
const savedPieces = () => [piece('a', { pieceSetVersion: 2, itemRevision: 'saved-a', isCompleted: true, completionSource: 'manual' }),
  piece('b', { pieceSetVersion: 2, itemRevision: 'saved-b' })];
const response = (pieces = savedPieces()) => ({ pieces } as SessakuPiecesMutationResponse);
const board = (items: GrindingPlanningBoardItem[], snapshotId = 'initial') => ({
  siteKey: 'site-1', snapshotId, items, resourceCategories: { '305': 'cutting' }
} as NonNullable<Options['data']>);

function setup(items = initialPieces()) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const refetch = vi.fn().mockResolvedValue({});
  const options: Options = {
    data: board(items), boardQuery: { isPlaceholderData: false, refetch }, category: 'cutting',
    queuedItems: items, applyArrival: (item) => item, status: 'incomplete',
    interactionLocked: false, bulkReady: true, writePending: false, piecePending: false, piecePendingRef: { current: false },
    currentItemsRef: { current: items }, completePiece: vi.fn().mockResolvedValue(response()),
    notify: vi.fn(), onCompleted: vi.fn(), onIncomplete: vi.fn()
  };
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook((props: Options) => usePlanningBoardCompletion(props), { initialProps: options, wrapper });
  return { ...hook, options, refetch, invalidate, wrapper };
}

beforeEach(() => { mocks.rowCompletion.mockReset().mockResolvedValue({}); });

describe('usePlanningBoardCompletion piece overlays', () => {
  it('keeps the completion callback stable and captures the latest response snapshot', async () => {
    const rows = [item('ordinary')];
    const h = setup(rows);
    const toggle = h.result.current.toggleCompletion;
    h.rerender({ ...h.options, data: board(structuredClone(rows), 'latest') });
    expect(h.result.current.toggleCompletion).toBe(toggle);
    await act(async () => { await toggle(rows[0]!, 'complete'); });
    expect(h.result.current.completionOverlay.get('ordinary')?.snapshotId).toBe('latest');
  });

  it('blocks piece completion from any surface until bulkReady while keeping ordinary completion available', async () => {
    const rows = [...initialPieces(), item('ordinary')];
    const h = setup(rows);
    h.rerender({ ...h.options, bulkReady: false });
    await act(async () => { await h.result.current.toggleCompletion(rows[0]!, 'complete'); });
    expect(h.options.completePiece).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.toggleCompletion(rows[2]!, 'complete'); });
    expect(mocks.rowCompletion).toHaveBeenCalledTimes(1);
  });

  it('blocks only the changing ordinary parent as well as pieces through the refresh phase', async () => {
    const rows = [item('parent'), item('unrelated')];
    const h = setup(rows);
    const piecePendingParentRef = { current: 'parent' };
    h.options.piecePendingRef.current = true;
    h.rerender({ ...h.options, piecePending: true, piecePendingParentRef });
    expect([...h.result.current.completionPendingItemIds]).toEqual(['parent']);
    await act(async () => { await h.result.current.toggleCompletion(rows[0]!, 'complete'); });
    expect(mocks.rowCompletion).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.toggleCompletion(rows[1]!, 'complete'); });
    expect(mocks.rowCompletion).toHaveBeenCalledExactlyOnceWith({ rowId: rows[1]!.sourceRowId, intent: 'complete' });
    h.options.piecePendingRef.current = false;
    h.rerender({ ...h.options, piecePendingParentRef });
    expect(h.result.current.completionPendingItemIds.size).toBe(0);
  });

  it.each(['pieceId', 'pieceSetVersion', 'parentItemId'] as const)('disables malformed pieces missing %s', async (field) => {
    const invalid = piece('a', { [field]: undefined });
    const h = setup([invalid, piece('b'), item('ordinary')]);
    expect([...h.result.current.completionPendingItemIds]).toEqual([invalid.itemId]);
    await act(async () => { await h.result.current.toggleCompletion(invalid, 'complete'); });
    expect(h.options.completePiece).not.toHaveBeenCalled();
  });

  it('disables every parent’s pieces until bulk data is ready', () => {
    const entries = [...initialPieces(), piece('other', { parentItemId: 'other' }), item('ordinary')];
    const h = setup(entries);
    h.rerender({ ...h.options, bulkReady: false });
    expect([...h.result.current.completionPendingItemIds].sort()).toEqual(['piece:a', 'piece:b', 'piece:other']);
    h.rerender(h.options);
    expect(h.result.current.completionPendingItemIds.size).toBe(0);
  });
  it('keeps piece write pending props scoped to the affected parent; the outer attribute gates unrelated write controls', () => {
    const h = setup([...initialPieces(), piece('other', { parentItemId: 'other' })]);
    h.rerender({ ...h.options, piecePending: true, piecePendingParentRef: { current: 'parent' } });
    expect([...h.result.current.completionPendingItemIds].sort()).toEqual(['parent', 'piece:a', 'piece:b']);
    h.rerender(h.options);
    expect(h.result.current.completionPendingItemIds.size).toBe(0);
  });

  it.each(['piece', 'row'] as const)('matches HEAD incomplete filtering and keeps undo available for %s completion', async (kind) => {
    const entry = kind === 'piece' ? piece('a') : item('ordinary');
    const h = setup([entry]);
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete'); });
    expect(h.result.current.displayItems).toHaveLength(0);
    expect(h.options.onCompleted).toHaveBeenCalledTimes(1);
    await act(async () => { await h.result.current.toggleCompletion(entry, 'incomplete'); });
    expect(h.options.onIncomplete).toHaveBeenCalledTimes(1);
  });

  it('does not scan ordinary rows or change pending IDs when the write queue switches pending with zero pieces', () => {
    const readKind = vi.fn(() => 'row' as const);
    const items = Array.from({ length: 1000 }, (_, index) => ({ ...item(String(index)), get kind() { return readKind(); } }));
    const h = setup(items);
    const pendingIds = h.result.current.completionPendingItemIds;
    const displayed = h.result.current.displayItems;
    readKind.mockClear();
    h.rerender({ ...h.options, writePending: true });
    expect(h.result.current.completionPendingItemIds).toBe(pendingIds);
    expect(h.result.current.displayItems).toBe(displayed);
    expect(readKind).not.toHaveBeenCalled();
    h.rerender({ ...h.options, piecePending: true, bulkReady: false });
    expect(h.result.current.completionPendingItemIds).toBe(pendingIds);
    expect(readKind).not.toHaveBeenCalled();
    h.rerender(h.options);
    expect(h.result.current.completionPendingItemIds).toBe(pendingIds);
    expect(readKind).not.toHaveBeenCalled();
  });

  it('matches overlays for several parents with one indexed scan of the refreshed pieces', async () => {
    const items = Array.from({ length: 4 }, (_, parent) => initialPieces().map((entry) => ({ ...entry,
      itemId: `${entry.itemId}:${parent}`, pieceId: `${entry.pieceId}:${parent}`, parentItemId: `parent:${parent}` }))).flat();
    const h = setup(items);
    const saved = items.map((entry) => ({ ...entry, pieceSetVersion: 2 }));
    vi.mocked(h.options.completePiece).mockImplementation(async ({ pieceId }) => ({ pieces: saved.filter((entry) =>
      entry.parentItemId === saved.find((candidate) => candidate.pieceId === pieceId)?.parentItemId) } as SessakuPiecesMutationResponse));
    for (let parent = 0; parent < 4; parent++) {
      await act(async () => { await h.result.current.toggleCompletion(items[parent * 2]!, 'complete'); });
    }
    expect(h.result.current.completionOverlay.size).toBe(8);
    const readKind = vi.fn(() => 'piece' as const);
    const refreshed = saved.map((entry) => ({ ...entry, get kind() { return readKind(); } }));
    h.rerender({ ...h.options, data: board(refreshed, 'acknowledged') });
    expect(h.result.current.completionOverlay.size).toBe(0);
    expect(readKind.mock.calls.length).toBeLessThanOrEqual(refreshed.length * 2);
  });

  it('drops saved overlays at an equal set version and uses a fresh parent-only revision on the next write', async () => {
    const h = setup();
    await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'complete'); });
    expect(h.result.current.completionOverlay.size).toBe(2);
    const fresh = savedPieces().map((entry) => ({ ...entry, itemRevision: `csv-updated-${entry.pieceId}` }));
    h.options.currentItemsRef.current = fresh;
    h.rerender({ ...h.options, data: board(fresh, 'csv-update') });
    expect(h.result.current.completionOverlay.size).toBe(0);
    await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'incomplete'); });
    expect(h.options.completePiece).toHaveBeenLastCalledWith(expect.objectContaining({ itemRevision: 'csv-updated-a', expectedPieceSetVersion: 2 }));
  });

  it('keeps saved overlays only while GET still has an older piece set', async () => {
    const h = setup();
    await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'complete'); });
    h.rerender({ ...h.options, data: board(initialPieces(), 'older-get') });
    expect(h.result.current.completionOverlay.get('piece:a')?.item.itemRevision).toBe('saved-a');
    h.rerender({ ...h.options, data: board(savedPieces(), 'acknowledged') });
    expect(h.result.current.completionOverlay.size).toBe(0);
  });

  it.each(['missing-piece', 'newer-set', 'imported-parent', 'missing-parent'] as const)(
    'drops every sibling overlay after GET replaces the parent: %s', async (change) => {
      const h = setup();
      await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'complete'); });
      const changed = change === 'missing-piece' ? [piece('b')]
        : change === 'newer-set' ? [piece('c', { pieceSetVersion: 3 }), piece('d', { pieceSetVersion: 3 })]
          : change === 'imported-parent' ? [item('parent', { isCompleted: true, completionSource: 'import' })] : [];
      h.rerender({ ...h.options, data: board(changed, 'other-client') });
      expect(h.result.current.completionOverlay.size).toBe(0);
    }
  );

  it('blocks a sibling in a separate act after the pending completed piece leaves the displayed items', async () => {
    const h = setup();
    let finish: (value: SessakuPiecesMutationResponse) => void = () => undefined;
    const pending = new Promise<SessakuPiecesMutationResponse>((resolve) => { finish = resolve; });
    vi.mocked(h.options.completePiece).mockReturnValueOnce(pending);
    let first: Promise<void> = Promise.resolve();
    act(() => { first = h.result.current.toggleCompletion(piece('a'), 'complete'); });
    expect(h.result.current.completionPendingParentIds.has('parent')).toBe(true);
    h.options.currentItemsRef.current = [piece('b')];
    h.rerender({ ...h.options });
    await act(async () => { await h.result.current.toggleCompletion(piece('b'), 'complete'); });
    expect(h.options.completePiece).toHaveBeenCalledTimes(1);
    await act(async () => { finish(response()); await first; });
    expect(h.result.current.completionPendingParentIds.size).toBe(0);
  });

  it('clears the parent row overlay as well as piece overlays after changing pieces', async () => {
    const h = setup([item('parent')]);
    await act(async () => { await h.result.current.toggleCompletion(item('parent'), 'complete'); });
    await act(async () => { await h.result.current.toggleCompletion(item('parent'), 'incomplete'); });
    expect(h.result.current.completionOverlay.has('parent')).toBe(true);
    act(() => { h.result.current.clearPieceCompletion('parent'); });
    expect(h.result.current.completionOverlay.size).toBe(0);
  });

  it.each([409, 403])('refreshes after a %i completion failure and removes the optimistic overlay', async (status) => {
    const h = setup();
    vi.mocked(h.options.completePiece).mockRejectedValueOnce({ isAxiosError: true, response: { status } });
    await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'complete'); });
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(h.result.current.completionOverlay.size).toBe(0);
    if (status === 409) expect(h.options.notify).toHaveBeenCalledWith('表示中のデータが更新されています。最新状態を取得してください。', 'error');
  });

  it('performs one explicit board GET on successful piece completion', async () => {
    const h = setup();
    await act(async () => { await h.result.current.toggleCompletion(piece('a'), 'complete'); });
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});

describe('usePlanningBoardCompletion without pieces', () => {
  it('keeps the toggle and all memoized rows stable as the write queue pending flag changes', () => {
    const rows = [item('row-a'), item('row-b')];
    const h = setup(rows);
    const renderRow = vi.fn();
    const Row = memo(function CompletionRow({ entry, toggle }: { entry: GrindingPlanningBoardItem; toggle: ReturnType<typeof usePlanningBoardCompletion>['toggleCompletion'] }) {
      renderRow(entry.itemId);
      return <button onClick={() => void toggle(entry, 'complete')}>{entry.itemId}</button>;
    });
    const Harness = (props: Options) => {
      const completion = usePlanningBoardCompletion(props);
      return <>{['table', 'seiban', 'focus'].map((pane) => <div key={pane}>
        {rows.map((entry) => <Row key={entry.itemId} entry={entry} toggle={completion.toggleCompletion} />)}
      </div>)}</>;
    };
    const view = render(<Harness {...h.options} />, { wrapper: h.wrapper });
    expect(renderRow).toHaveBeenCalledTimes(6);
    const originalToggle = h.result.current.toggleCompletion;
    for (const writePending of [true, false, true, false]) {
      h.rerender({ ...h.options, writePending });
      expect(h.result.current.toggleCompletion).toBe(originalToggle);
      view.rerender(<Harness {...h.options} writePending={writePending} />);
    }
    expect(renderRow).toHaveBeenCalledTimes(6);
  });
});

describe('piece operation completion', () => {
  const unit = () => piece('a', { unitRequiredMinutes: 40, ops: [{ opNo: 20, minutes: 30 }, { opNo: 10, minutes: 10 }], completedOpNos: [] });
  it('optimistically completes one operation, keeps the piece visible, and uses the op request with current revisions', async () => {
    const entry = unit(); const h = setup([entry]);
    let finish!: (response: SessakuPiecesMutationResponse) => void;
    const completePieceOp = vi.fn(() => new Promise<SessakuPiecesMutationResponse>(resolve => { finish = resolve; }));
    h.rerender({ ...h.options, completePieceOp });
    let pending!: Promise<void>;
    act(() => { pending = h.result.current.toggleCompletion(entry, 'complete', 10); });
    expect(completePieceOp).toHaveBeenCalledExactlyOnceWith({ pieceId: 'a', opNo: 10, intent: 'complete', expectedPieceSetVersion: 1, itemRevision: entry.itemRevision });
    expect(h.options.completePiece).not.toHaveBeenCalled();
    expect(h.result.current.displayItems[0]).toMatchObject({ isCompleted: false, completedOpNos: [10] });
    expect(h.result.current.completionPendingParentIds.has('parent')).toBe(true);
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 20); });
    expect(completePieceOp).toHaveBeenCalledTimes(1);
    const saved = { ...entry, completedOpNos: [10], pieceSetVersion: 2, itemRevision: 'op-saved' };
    await act(async () => { finish(response([saved])); await pending; });
    expect(h.result.current.displayItems[0]).toMatchObject({ completedOpNos: [10], pieceSetVersion: 2, itemRevision: 'op-saved' });
    expect(h.options.onCompleted).not.toHaveBeenCalled(); expect(h.refetch).toHaveBeenCalledTimes(1);
  });
  it('completes a piece after its final operation and reopens it when one operation is undone', async () => {
    const entry = { ...unit(), completedOpNos: [10] }; const h = setup([entry]);
    const done = { ...entry, completedOpNos: [10, 20], isCompleted: true, completionSource: 'manual' as const, pieceSetVersion: 2 };
    const undone = { ...done, completedOpNos: [20], isCompleted: false, completionSource: null, pieceSetVersion: 3 };
    const completePieceOp = vi.fn().mockResolvedValueOnce(response([done])).mockResolvedValueOnce(response([undone]));
    h.rerender({ ...h.options, completePieceOp });
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 20); });
    expect(h.result.current.displayItems).toHaveLength(0); expect(h.options.onCompleted).toHaveBeenCalledWith(done, 20);
    await act(async () => { await h.result.current.toggleCompletion(done, 'incomplete', 10); });
    expect(completePieceOp).toHaveBeenLastCalledWith(expect.objectContaining({ opNo: 10, expectedPieceSetVersion: 2, intent: 'incomplete' }));
    expect(h.result.current.displayItems[0]).toMatchObject({ isCompleted: false, completedOpNos: [20] });
    expect(h.options.onIncomplete).toHaveBeenCalledOnce();
  });
  it('keeps an already saved operation when a subsequent write fails before GET acknowledges it', async () => {
    const entry = unit(); const h = setup([entry]);
    const saved = { ...entry, completedOpNos: [10], pieceSetVersion: 2, itemRevision: 'saved-op' };
    const completePieceOp = vi.fn().mockResolvedValueOnce(response([saved])).mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } });
    h.rerender({ ...h.options, completePieceOp });
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 10); });
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 20); });
    expect(h.result.current.displayItems[0]).toMatchObject({ completedOpNos: [10], itemRevision: 'saved-op', pieceSetVersion: 2 });
  });
  it.each([409, 403, 500])('rolls back operation changes after %i and refreshes conflicts', async status => {
    const entry = unit(); const h = setup([entry]);
    const completePieceOp = vi.fn().mockRejectedValue({ isAxiosError: true, response: { status } });
    h.rerender({ ...h.options, completePieceOp });
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 10); });
    expect(h.result.current.displayItems[0]?.completedOpNos).toEqual([]);
    expect(h.result.current.completionOverlay.size).toBe(0); expect(h.result.current.completionPendingParentIds.size).toBe(0);
    expect(h.refetch).toHaveBeenCalledTimes(status === 500 ? 0 : 1);
    expect(h.options.notify).toHaveBeenCalledWith(status === 409 ? '表示中のデータが更新されています。最新状態を取得してください。' : '完了状態を保存できませんでした。時間をおいて再試行してください。', 'error');
  });
  it.each([{ writePending: true }, { bulkReady: false }, { interactionLocked: true }, { piecePendingRef: { current: true } }])('honors existing write gates: %j', async gates => {
    const entry = unit(); const h = setup([entry]); const completePieceOp = vi.fn();
    h.rerender({ ...h.options, completePieceOp, ...gates });
    await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 10); });
    expect(completePieceOp).not.toHaveBeenCalled();
  });
});

it.each([false, true])('sends the suffix itemId for completion (whole interval=%s)', async whole => {
  const entry = piece('a', { itemId: 'pieceops:a:20', opRange: { fromOpNo: 20, toOpNo: 30 },
    unitRequiredMinutes: 30, ops: [{ opNo: 20, minutes: 10 }, { opNo: 30, minutes: 20 }], completedOpNos: [] });
  const h = setup([entry]); const completePieceOp = vi.fn().mockResolvedValue(response([entry]));
  h.rerender({ ...h.options, completePieceOp });
  await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', whole ? undefined : 20); });
  expect(whole ? h.options.completePiece : completePieceOp).toHaveBeenCalledWith(expect.objectContaining({
    itemId: entry.itemId, pieceId: 'a', intent: 'complete', expectedPieceSetVersion: 1, itemRevision: entry.itemRevision,
    ...(whole ? {} : { opNo: 20 })
  }));
  await act(async () => { await h.result.current.toggleCompletion(entry, 'complete', 10); });
  expect(completePieceOp).toHaveBeenCalledTimes(whole ? 0 : 1);
});
