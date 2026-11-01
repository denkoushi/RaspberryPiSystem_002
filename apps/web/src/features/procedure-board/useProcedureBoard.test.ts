import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { procedureBoardApi } from './procedureBoardApi';
import { emptyLayout, placeItem } from './procedureBoardLayout';
import { formatPreview, useProcedureBoard } from './useProcedureBoard';

import type { BoardResponse, FormatProposal, Suggestions } from './procedureBoardApi';
import type { BoardItem } from './procedureBoardLayout';

vi.mock('./procedureBoardApi', async original => ({ ...await original<typeof import('./procedureBoardApi')>(),
  procedureBoardApi: { open: vi.fn(), get: vi.fn(), save: vi.fn(), suggestions: vi.fn(), events: vi.fn(), decide: vi.fn(), requestFormat: vi.fn(), format: vi.fn(), decideFormat: vi.fn() } }));
const initial = (): BoardResponse => ({ boardId: 'b', procedureId: 'topic', version: 1, layout: emptyLayout() });
const item = (): BoardItem => ({ itemId: crypto.randomUUID(), kind: 'text', textKind: 'body', text: '手順', origin: 'human', style: 'body' });
const suggestions = (): Suggestions => ({ boardVersion: 1, status: 'ready', current: { id: 'ai', boardVersion: 1, placements: [], headings: [], gaps: [], conflicts: [] }, previous: null, pollAfterMs: 5000 });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderHook(() => useProcedureBoard('topic'), { wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children) });
}
function createText(text = item()) {
  return (layout: BoardResponse['layout']) => ({ layout: placeItem(layout, text, { page: 1, row: layout.pages[0].rows.length, col: 0, index: 0, mode: 'row' }),
    event: { type: 'text_created', payload: { itemId: text.itemId } } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(procedureBoardApi.events).mockResolvedValue({}); vi.mocked(procedureBoardApi.open).mockResolvedValue(initial());
  vi.mocked(procedureBoardApi.get).mockResolvedValue(initial()); vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(suggestions());
  vi.mocked(procedureBoardApi.save).mockImplementation(async (_id, version, layout) => ({ ...initial(), version: version + 1, layout }));
});
afterEach(() => vi.useRealTimers());
describe('useProcedureBoard', () => {
  it('updates immediately, debounces and serializes different operation events, and reloads saved content', async () => {
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    act(() => { hook.result.current.session.change(createText()); hook.result.current.session.change(createText()); });
    expect(hook.result.current.draft!.pages[0].rows).toHaveLength(2); expect(procedureBoardApi.save).not.toHaveBeenCalled();
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(procedureBoardApi.save).mock.calls.map(call => call[1])).toEqual([1, 2]);
    const saved = hook.result.current.board!; hook.unmount(); vi.mocked(procedureBoardApi.open).mockResolvedValue(saved);
    const reloaded = mount(); await waitFor(() => expect(reloaded.result.current.draft).toEqual(saved.layout)); reloaded.unmount();
  });
  it.each([403, 409])('preserves drafts and stops further writes on %s', async status => {
    vi.mocked(procedureBoardApi.save).mockRejectedValue({ response: status ? { status } : undefined });
    vi.mocked(procedureBoardApi.get).mockResolvedValue({ ...initial(), version: 9 });
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    act(() => hook.result.current.session.change(createText()));
    const draft = hook.result.current.draft;
    await waitFor(() => expect(hook.result.current.stopped).toBe(true));
    expect(hook.result.current.draft).toEqual(draft); expect(hook.result.current.forbidden).toBe(status === 403);
    if (status === 409) await waitFor(() => expect(hook.result.current.latest?.version).toBe(9));
    act(() => hook.result.current.session.change(createText()));
    expect(hook.result.current.draft).toBe(draft); expect(hook.result.current.pending).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 350)); expect(procedureBoardApi.save).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it.each(['suggestions', 'format'] as const)('does not stop saving after a %s polling GET failure', async source => {
    vi.mocked(procedureBoardApi[source]).mockRejectedValue(new Error('offline'));
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    if (source === 'format') act(() => hook.result.current.session.receiveFormat({ proposalId: 'f', boardVersion: 1, status: 'running', pollAfterMs: 5000 }));
    await waitFor(() => expect(procedureBoardApi[source]).toHaveBeenCalled());
    act(() => hook.result.current.session.change(createText()));
    await waitFor(() => expect(hook.result.current.board?.version).toBe(2));
    expect(hook.result.current.stopped).toBe(false); hook.unmount();
  });
  it.each([undefined, 503])('retries a failed save (%s) without blocking input or losing jobs', async status => {
    vi.mocked(procedureBoardApi.save).mockRejectedValueOnce(status ? { response: { status } } : new Error('offline'));
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    vi.useFakeTimers();
    act(() => hook.result.current.session.change(createText()));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(hook.result.current.stopped).toBe(false); expect(hook.result.current.pending).toBe(1);
    act(() => hook.result.current.session.change(createText()));
    expect(hook.result.current.draft!.pages[0].rows).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(999)); expect(procedureBoardApi.save).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(vi.mocked(procedureBoardApi.save).mock.calls.map(call => call[1])).toEqual([1, 1, 2]);
    expect(vi.mocked(procedureBoardApi.save).mock.calls[1][3].id).toBe(vi.mocked(procedureBoardApi.save).mock.calls[0][3].id);
    expect(hook.result.current.pending).toBe(0); expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.board!.layout.pages[0].rows).toHaveLength(2); hook.unmount();
  });
  it('backs off consecutive failures up to thirty seconds and resets after success', async () => {
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    vi.useFakeTimers(); vi.mocked(procedureBoardApi.save).mockRejectedValue(new Error('offline'));
    act(() => hook.result.current.session.change(createText()));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    let attempts = 1;
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await act(async () => vi.advanceTimersByTimeAsync(delay - 1)); expect(procedureBoardApi.save).toHaveBeenCalledTimes(attempts);
      await act(async () => vi.advanceTimersByTimeAsync(1)); expect(procedureBoardApi.save).toHaveBeenCalledTimes(++attempts);
    }
    vi.mocked(procedureBoardApi.save).mockImplementation(async (_id, version, layout) => ({ ...initial(), version: version + 1, layout }));
    await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(hook.result.current.pending).toBe(0);
    act(() => hook.result.current.session.change(createText()));
    await act(async () => vi.advanceTimersByTimeAsync(300)); expect(hook.result.current.board?.version).toBe(3); hook.unmount();
  });
  it('reapplies queued changes in order onto latest, discarding only changes that throw', async () => {
    const remote = item(); remote.kind === 'text' && (remote.text = '別端末');
    const latest = { ...initial(), version: 9, layout: createText(remote)(emptyLayout()).layout };
    vi.mocked(procedureBoardApi.get).mockResolvedValue(latest);
    vi.mocked(procedureBoardApi.save).mockRejectedValueOnce({ response: { status: 409, data: { code: 'PROCEDURE_BOARD_VERSION_CONFLICT' } } });
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    const first = item(), second = item();
    act(() => {
      hook.result.current.session.change(createText(first));
      hook.result.current.session.change(layout => {
        if (layout.pages[0].rows.some(row => row.cols.some(col => col.items.some(item => item.itemId === remote.itemId)))) throw new Error('no longer applicable');
        return createText()(layout);
      });
      hook.result.current.session.change(createText(second));
    });
    await waitFor(() => expect(hook.result.current.latest?.version).toBe(9));
    act(() => hook.result.current.session.latest());
    expect(hook.result.current.draft!.pages[0].rows.map(row => row.cols[0].items[0].itemId)).toEqual([remote.itemId, first.itemId, second.itemId]);
    await waitFor(() => expect(hook.result.current.pending).toBe(0));
    expect(vi.mocked(procedureBoardApi.save).mock.calls.map(call => call[1])).toEqual([1, 9, 10]);
    expect(hook.result.current.board?.version).toBe(11); hook.unmount();
  });
  it.each(['decision', 'events'])('retries failed %s writes with the same event ids', async source => {
    const value = suggestions(); value.current!.placements = [{ id: 'p', materialId: 'm', page: 1, row: 0, col: 0, index: 0, mode: 'row' }];
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(value);
    vi.mocked(procedureBoardApi.decide).mockResolvedValue({ ...initial(), version: 2 });
    const write = source === 'decision' ? procedureBoardApi.decide : procedureBoardApi.events;
    vi.mocked(write).mockRejectedValueOnce(new Error('offline'));
    const hook = mount(); await waitFor(() => expect(hook.result.current.suggestions).toBeDefined());
    vi.useFakeTimers();
    act(() => hook.result.current.session.decide('ai', { proposalId: 'p', action: 'dismiss' }));
    await act(async () => vi.advanceTimersByTimeAsync(300)); expect(hook.result.current.stopped).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.pending).toBe(0); expect(write).toHaveBeenCalledTimes(2);
    expect(vi.mocked(write).mock.calls[1]).toEqual(vi.mocked(write).mock.calls[0]); hook.unmount();
  });
  it.each(['placement', 'format'])('drops only a stale %s job, refetches proposals and continues saving', async source => {
    const value = suggestions(); value.current!.placements = [{ id: 'p', materialId: 'm', page: 1, row: 0, col: 0, index: 0, mode: 'row' }];
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(value);
    const format = { proposalId: 'f', boardVersion: 1, status: 'ready', pollAfterMs: 5000 };
    vi.mocked(procedureBoardApi.format).mockResolvedValue({ ...format, status: 'stale' });
    const write = source === 'placement' ? procedureBoardApi.decide : procedureBoardApi.decideFormat;
    vi.mocked(write).mockRejectedValue({ response: { status: 409, data: { code: 'PROCEDURE_BOARD_SUGGESTION_STALE' } } });
    const hook = mount(); await waitFor(() => expect(hook.result.current.suggestions).toBeDefined());
    act(() => {
      if (source === 'placement') hook.result.current.session.decide('ai', { proposalId: 'p', action: 'dismiss' });
      else { hook.result.current.session.receiveFormat(format); hook.result.current.session.decideFormat('accept'); }
      hook.result.current.session.change(createText());
    });
    await waitFor(() => expect(hook.result.current.board?.version).toBe(2));
    expect(hook.result.current.stopped).toBe(false); expect(hook.result.current.pending).toBe(0);
    expect(procedureBoardApi.suggestions).toHaveBeenCalledTimes(2); expect(procedureBoardApi.get).not.toHaveBeenCalled();
    if (source === 'format') { expect(procedureBoardApi.format).toHaveBeenCalled(); expect(hook.result.current.format?.status).toBe('stale'); }
    hook.unmount();
  });
  it('ignores older suggestions without fetching or replacing board/draft references', async () => {
    const hook = mount(); await waitFor(() => expect(hook.result.current.suggestions).toBeDefined());
    act(() => hook.result.current.session.change(createText()));
    await waitFor(() => expect(hook.result.current.board?.version).toBe(2));
    const snapshot = hook.result.current;
    await act(async () => { await hook.result.current.session.receive(suggestions()); await hook.result.current.session.receive(suggestions()); });
    expect(procedureBoardApi.get).not.toHaveBeenCalled();
    expect(hook.result.current.board).toBe(snapshot.board); expect(hook.result.current.draft).toBe(snapshot.draft);
    expect(hook.result.current.suggestions).toBe(snapshot.suggestions); hook.unmount();
  });
  it('does not overwrite new edits with an in-flight save response', async () => {
    let resolve!: (value: BoardResponse) => void;
    vi.mocked(procedureBoardApi.save).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    act(() => hook.result.current.session.change(createText())); await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    const saved = { ...initial(), version: 2, layout: hook.result.current.draft! };
    act(() => hook.result.current.session.change(createText()));
    await act(async () => resolve(saved));
    expect(hook.result.current.draft!.pages[0].rows).toHaveLength(2); hook.unmount();
  });
  it('holds suggestions during editing and fetches the board before applying a newer version', async () => {
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    act(() => hook.result.current.session.busy(true));
    const next = { ...suggestions(), boardVersion: 2 }; vi.mocked(procedureBoardApi.get).mockResolvedValue({ ...initial(), version: 2 });
    await act(async () => hook.result.current.session.receive(next));
    expect(hook.result.current.suggestions?.boardVersion).not.toBe(2); expect(procedureBoardApi.get).not.toHaveBeenCalled();
    act(() => hook.result.current.session.busy(false));
    await waitFor(() => expect(hook.result.current.suggestions?.boardVersion).toBe(2)); hook.unmount();
  });
  it('records displayed placements before sending decisions and rejects stale decisions', async () => {
    const value = suggestions(); value.current!.placements = [{ id: 'p', materialId: 'm', page: 1, row: 0, col: 0, index: 0, mode: 'row' }];
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(value); vi.mocked(procedureBoardApi.events).mockResolvedValue({});
    vi.mocked(procedureBoardApi.decide).mockResolvedValue({ ...initial(), version: 2 });
    const hook = mount(); await waitFor(() => expect(hook.result.current.suggestions?.current).toBeDefined());
    act(() => hook.result.current.session.decide('ai', { proposalId: 'p', action: 'accept', itemId: crypto.randomUUID() }));
    await waitFor(() => expect(procedureBoardApi.decide).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.events).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(procedureBoardApi.decide).mock.invocationCallOrder[0]);
    act(() => hook.result.current.session.decide('ai', { proposalId: 'p', action: 'dismiss' }));
    await new Promise(resolve => setTimeout(resolve, 350)); expect(procedureBoardApi.decide).toHaveBeenCalledOnce(); hook.unmount();
  });
  it('keeps format preview separate from canonical layout until acceptance succeeds', async () => {
    const board = initial(); board.layout = createText()(board.layout).layout;
    vi.mocked(procedureBoardApi.open).mockResolvedValue(board);
    const format: FormatProposal = { proposalId: 'f', boardVersion: 1, status: 'ready', pollAfterMs: 5000,
      result: { pages: board.layout.pages.map(page => ({ page: page.page, rows: page.rows.map(row => ({ w: row.w, cols: row.cols.map(col => ({ itemIds: col.items.map(item => item.itemId) })) })) })),
        styles: [{ itemId: board.layout.pages[0].rows[0].cols[0].items[0].itemId, style: 'caution' }] } };
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toEqual(board.layout));
    act(() => hook.result.current.session.receiveFormat(format));
    expect(formatPreview(board.layout, format)!.pages[0].rows[0].cols[0].items[0].style).toBe('caution');
    expect(hook.result.current.board!.layout).toEqual(board.layout);
    let resolve!: (value: BoardResponse) => void;
    vi.mocked(procedureBoardApi.decideFormat).mockImplementation(() => new Promise(done => { resolve = done; }));
    act(() => hook.result.current.session.decideFormat('accept')); await waitFor(() => expect(procedureBoardApi.decideFormat).toHaveBeenCalledOnce());
    expect(hook.result.current.board!.layout).toEqual(board.layout);
    await act(async () => resolve({ ...board, version: 2, layout: formatPreview(board.layout, format)! }));
    expect(hook.result.current.board!.version).toBe(2); hook.unmount();
  });
});

describe('display and work records', () => {
  it('records only observed proposals, batches them once and completes material work after saving', async () => {
    const value = suggestions(); value.current!.placements = ['p1', 'p2'].map(id => ({ id, materialId: id, page: 1, row: 0, col: 0, index: 0, mode: 'row' }));
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(value);
    const hook = mount(); await waitFor(() => expect(hook.result.current.suggestions).toBeDefined());
    expect(procedureBoardApi.events).not.toHaveBeenCalled();
    act(() => { hook.result.current.session.show('p1'); hook.result.current.session.show('p1'); hook.result.current.session.show('p2'); });
    await waitFor(() => expect(procedureBoardApi.events).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.events).mock.calls[0][2].map(event => event.payload.proposalId)).toEqual(['p1', 'p2']);
    const materialItem: BoardItem = { itemId: crypto.randomUUID(), kind: 'material', materialId: 'p1', origin: 'human', style: 'body' };
    act(() => { hook.result.current.session.touch('p1'); hook.result.current.session.change(layout => {
      const result = placeItem(layout, materialItem, { page: 1, row: 0, col: 0, index: 0, mode: 'row' });
      return { layout: result, event: { type: 'material_placed', payload: { itemId: materialItem.itemId, materialId: 'p1', to: { page: 1, row: 0, col: 0, index: 0 } } } };
    }); });
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    const payload = vi.mocked(procedureBoardApi.save).mock.calls[0][3].payload;
    expect(payload).toMatchObject({ materialId: 'p1', workId: expect.any(String), activeMs: expect.any(Number) });
    await waitFor(() => expect(procedureBoardApi.events).toHaveBeenCalledTimes(2));
    expect(vi.mocked(procedureBoardApi.events).mock.calls[1][2][0]).toMatchObject({ type: 'material_work', payload: { completed: true, workId: payload.workId } }); hook.unmount();
  });
  it('merges continuous same-row width changes into a single valid save', async () => {
    const board = initial(); board.layout = placeItem(placeItem(emptyLayout(), item(), { page: 1, row: 0, col: 0, index: 0, mode: 'row' }), item(), { page: 1, row: 0, col: 1, index: 0, mode: 'col' });
    vi.mocked(procedureBoardApi.open).mockResolvedValue(board);
    const hook = mount(); await waitFor(() => expect(hook.result.current.draft).toBeDefined());
    act(() => { for (const left of [.55, .6, .7]) hook.result.current.session.change(layout => {
      const result = structuredClone(layout); result.pages[0].rows[0].w = [left, 1 - left];
      return { layout: result, event: { type: 'columns_resized', payload: { page: 1, row: 0 } } };
    }, 'width:1:0'); });
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.save).mock.calls[0][2].pages[0].rows[0].w).toEqual([.7, 1 - .7]); hook.unmount();
  });
});
