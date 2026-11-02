import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardEventSchema, validateLayoutEvent } from '../../../../api/src/services/knowledge/procedure-board.service';

import { ProcedureBoard } from './ProcedureBoard';
import { procedureBoardApi } from './procedureBoardApi';
import * as layoutFunctions from './procedureBoardLayout';
import { boardItems, emptyLayout, placeItem } from './procedureBoardLayout';

import type { BoardResponse, Material, Suggestions } from './procedureBoardApi';
import type { BoardItem, BoardTarget } from './procedureBoardLayout';

vi.mock('./procedureBoardApi', async original => ({ ...await original<typeof import('./procedureBoardApi')>(), procedureBoardApi: {
  open: vi.fn(), get: vi.fn(), save: vi.fn(), suggestions: vi.fn(), events: vi.fn(), decide: vi.fn(), requestFormat: vi.fn(), format: vi.fn(), decideFormat: vi.fn() } }));
const material: Material = { materialId: 'm', text: '素材の原文', createdAt: '2026-11-01T00:00:00Z', images: [], pdf: null };
const text = (): BoardItem => ({ itemId: crypto.randomUUID(), kind: 'text', textKind: 'body', text: '<img src=x onerror=alert(1)>', origin: 'human', style: 'body' });
const target: BoardTarget = { page: 1, row: 0, col: 0, index: 0, mode: 'row' };
let board: BoardResponse;
function show(materialError?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ProcedureBoard procedureId="topic" title="点検" materials={[material]} materialError={materialError} /></MemoryRouter></QueryClientProvider>);
}
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
function dragTo(from: HTMLElement, zone: HTMLElement, x: number, y: number) {
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
  fireEvent.pointerDown(from, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(from, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(from, { pointerId: 1, clientX: x, clientY: y });
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
  board = { boardId: 'b', procedureId: 'topic', version: 1, layout: placeItem(emptyLayout(), text(), target) };
  vi.mocked(procedureBoardApi.open).mockImplementation(async () => board);
  vi.mocked(procedureBoardApi.get).mockImplementation(async () => board);
  vi.mocked(procedureBoardApi.events).mockResolvedValue({});
  vi.mocked(procedureBoardApi.save).mockImplementation(async (_id, version, layout, event) => { validateLayoutEvent(board.layout, layout, boardEventSchema.parse(event)); board = { ...board, layout, version: version + 1 }; return board; });
  vi.mocked(procedureBoardApi.suggestions).mockResolvedValue({ boardVersion: 1, status: 'pending', current: null, previous: null, pollAfterMs: 5000 });
});
afterEach(() => vi.useRealTimers());
describe('ProcedureBoard', () => {
  it('renders literal text and edits in place with IME Enter, Escape and blur', async () => {
    show(); const original = await screen.findByText('<img src=x onerror=alert(1)>');
    expect(original.querySelector('img')).toBeNull(); fireEvent.click(original);
    const editor = screen.getByRole('textbox', { name: '本文を編集' });
    fireEvent.change(editor, { target: { value: '変換中' } }); fireEvent.compositionStart(editor); fireEvent.keyDown(editor, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('textbox')).toBeInTheDocument(); expect(procedureBoardApi.save).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor); fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    fireEvent.click(screen.getByText('<img src=x onerror=alert(1)>')); fireEvent.change(screen.getByRole('textbox'), { target: { value: '確定本文' } });
    fireEvent.blur(screen.getByRole('textbox')); expect(screen.getByText('確定本文')).toBeInTheDocument();
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.save).mock.calls[0][3].type).toBe('text_edited');
  });
  it.each(['タイトル', 'サブタイトル', '本文'])('creates %s immediately after selection and cancels empty additions', async label => {
    show(); fireEvent.click(await screen.findByText('<img src=x onerror=alert(1)>'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(procedureBoardApi.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: label + '追加' } }); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByText(label + '追加')).toBeInTheDocument();
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    expect(boardItems(board.layout).map(entry => entry.item.kind === 'text' && entry.item.text)).toEqual(['<img src=x onerror=alert(1)>', label + '追加']);
  });
  it('duplicates with a new identity and removes via Delete without deleting source material', async () => {
    const view = show(); const original = await screen.findByText('<img src=x onerror=alert(1)>'); fireEvent.focus(original.closest('article')!);
    fireEvent.click(screen.getByRole('button', { name: '複製' })); expect(screen.getAllByText('<img src=x onerror=alert(1)>')).toHaveLength(2);
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    expect(new Set(boardItems(board.layout).map(entry => entry.item.itemId)).size).toBe(2);
    fireEvent.keyDown(screen.getAllByText('<img src=x onerror=alert(1)>')[1].closest('article')!, { key: 'Delete' });
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledTimes(2)); expect(boardItems(board.layout)).toHaveLength(1);
    view.unmount(); show(); expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
  it('places beside text, resizes, moves to closed page end and restores a single column', async () => {
    show(); await screen.findByText('<img src=x onerror=alert(1)>');
    const page = screen.getByRole('region', { name: 'ページ1' }); const card = within(page).getByRole('article');
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(400, 100, 400, 100));
    dragTo(screen.getByText('素材の原文').closest('article')!, page, 790, 130);
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce()); expect(board.layout.pages[0].rows[0].cols).toHaveLength(2);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '65' } });
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledTimes(2)); expect(board.layout.pages[0].rows[0].w).toEqual([.65, .35]);
    fireEvent.click(screen.getByRole('button', { name: 'ページ2を閉じる' }));
    dragTo(within(page).getByText('素材の原文').closest('article')!, screen.getByRole('region', { name: 'ページ2' }), 1100, 400);
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledTimes(3)); expect(board.layout.pages[0].rows[0].w).toEqual([1]);
    expect(board.layout.pages[1].rows).toHaveLength(1);
  });
  it('shows dashed placement and heading proposals, conflict choices and disables stale adoption', async () => {
    const response: Suggestions = { boardVersion: 1, status: 'ready', current: { id: 'ai', boardVersion: 1,
      placements: [{ ...target, row: 1, id: 'p', materialId: 'm' }], headings: [{ id: 'h', page: 1, text: '見出し案' }], gaps: [{ ...target, id: 'g', text: '確認済みですか' }],
      conflicts: [{ id: 'c', materialIds: ['m', 'other'], quotes: ['100', '200'] }] }, previous: null, pollAfterMs: 5000 };
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue(response); vi.mocked(procedureBoardApi.events).mockResolvedValue({});
    vi.mocked(procedureBoardApi.decide).mockResolvedValue({ ...board, version: 2 });
    show(); await screen.findByText('見出し案'); expect(screen.getByRole('button', { name: 'ここに置く' }).closest('article')).toHaveClass('pb-ghost');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled());
    expect(screen.getByRole('group', { name: '食い違い' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '見出しにする' }));
    await waitFor(() => expect(procedureBoardApi.decide).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.decide).mock.calls[0][3]).toEqual({ proposalId: 'h', action: 'accept', itemId: expect.any(String) });
    expect(screen.getByRole('button', { name: 'ここに置く' })).toBeDisabled();
  });
  it.each([1, 3])('drags a heading ghost to page %s as acceptance or relocation', async pageNumber => {
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue({ boardVersion: 1, status: 'ready', current: {
      id: 'ai', boardVersion: 1, placements: [], headings: [{ id: 'h', page: 1, text: '見出し案' }], gaps: [], conflicts: [],
    }, previous: null, pollAfterMs: 5000 });
    vi.mocked(procedureBoardApi.decide).mockResolvedValue({ ...board, version: 2 });
    show(); await waitFor(() => expect(screen.getByRole('button', { name: '見出しにする' })).toBeEnabled());
    const ghost = screen.getByText('見出し案').closest<HTMLElement>('.pb-card')!;
    expect(ghost).toHaveAttribute('data-ghost', 'h');
    const original = within(screen.getByRole('region', { name: 'ページ1' })).getByRole('article');
    vi.spyOn(original, 'getBoundingClientRect').mockReturnValue(rect(400, 200, 400, 100));
    dragTo(ghost, screen.getByRole('region', { name: `ページ${pageNumber}` }), 500, 100);
    await waitFor(() => expect(procedureBoardApi.decide).toHaveBeenCalledOnce());
    const decision = vi.mocked(procedureBoardApi.decide).mock.calls[0][3];
    expect(decision).toEqual({ proposalId: 'h', action: pageNumber === 1 ? 'accept' : 'relocate', itemId: expect.any(String),
      ...(pageNumber === 3 ? { target: { ...target, page: 3 } } : {}) });
    expect(decision.itemId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('shows source date and kind only for loaded conflict materials', async () => {
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue({ boardVersion: 1, status: 'ready', current: {
      id: 'ai', boardVersion: 1, placements: [], headings: [], gaps: [],
      conflicts: [{ id: 'c', materialIds: ['m', 'missing'], quotes: ['100', '200'] }],
    }, previous: null, pollAfterMs: 5000 });
    show();
    const conflict = await screen.findByRole('group', { name: '食い違い' });
    const known = within(conflict).getByRole('button', { name: '100 11-01 メモ' });
    expect(known.querySelector('time')).toHaveAttribute('dateTime', material.createdAt);
    expect(within(conflict).getByRole('button', { name: '200', exact: true }).querySelector('small')).toBeNull();
  });
  it('records a dragged ghost as relocation while ordinary editing remains available', async () => {
    vi.mocked(procedureBoardApi.suggestions).mockResolvedValue({ boardVersion: 1, status: 'ready', current: { id: 'ai', boardVersion: 1,
      placements: [{ ...target, row: 1, id: 'p', materialId: 'm' }], headings: [], gaps: [], conflicts: [] }, previous: null, pollAfterMs: 5000 });
    vi.mocked(procedureBoardApi.events).mockResolvedValue({}); vi.mocked(procedureBoardApi.decide).mockResolvedValue({ ...board, version: 2 });
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'ここに置く' })).toBeEnabled());
    dragTo(screen.getByRole('button', { name: 'ここに置く' }).closest('article')!, screen.getByRole('region', { name: 'ページ3' }), 1500, 400);
    await waitFor(() => expect(procedureBoardApi.decide).toHaveBeenCalledOnce());
    expect(vi.mocked(procedureBoardApi.decide).mock.calls[0][3]).toMatchObject({ action: 'relocate', target: { page: 3, mode: 'row' } });
    fireEvent.click(screen.getByText('<img src=x onerror=alert(1)>')); expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
  it.each([403, 409])('disables editing controls, inline editing and dragging while stopped on %s', async status => {
    vi.mocked(procedureBoardApi.save).mockRejectedValue({ response: { status } });
    show(); const original = await screen.findByText('<img src=x onerror=alert(1)>');
    fireEvent.click(original); fireEvent.change(screen.getByRole('textbox'), { target: { value: '未保存' } }); fireEvent.blur(screen.getByRole('textbox'));
    await screen.findByRole('alert');
    for (const name of ['タイトル', 'サブタイトル', '本文', '複製', 'AIで整える', '外す']) expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
    fireEvent.click(screen.getByText('未保存')); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    dragTo(screen.getByText('素材の原文').closest('article')!, screen.getByRole('region', { name: 'ページ3' }), 1500, 400);
    expect(screen.getByText('素材の原文').closest('[data-drop]')).toHaveAttribute('data-drop', 'tray');
    fireEvent.keyDown(screen.getByText('未保存').closest('article')!, { key: 'Delete' });
    expect(screen.getByText('未保存')).toBeInTheDocument(); expect(procedureBoardApi.save).toHaveBeenCalledOnce();
  });
  it.each([503, 403])('only stops for a forbidden material GET (%s)', async status => {
    show({ response: { status } }); const original = await screen.findByText('<img src=x onerror=alert(1)>');
    if (status === 403) { await screen.findByRole('alert'); expect(screen.getByRole('button', { name: '本文', exact: true })).toBeDisabled(); }
    else {
      fireEvent.click(original); fireEvent.change(screen.getByRole('textbox'), { target: { value: '保存継続' } }); fireEvent.blur(screen.getByRole('textbox'));
      await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce());
    }
  });
  it('uses cached item positions during animation frames', async () => {
    show(); await screen.findByText('<img src=x onerror=alert(1)>');
    const shelf = screen.getByText('素材の原文').closest('article')!;
    const page = screen.getByRole('region', { name: 'ページ1' });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(page);
    const card = within(page).getByRole('article');
    const measure = vi.spyOn(card, 'getBoundingClientRect');
    const query = vi.spyOn(page, 'querySelectorAll');
    const scan = vi.spyOn(layoutFunctions, 'boardItems');
    fireEvent.pointerDown(shelf, { button: 0, clientX: 10, clientY: 10 }); scan.mockClear(); measure.mockClear(); query.mockClear();
    for (const x of [500, 600]) {
      fireEvent.pointerMove(shelf, { clientX: x, clientY: 200 });
      await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    expect(scan).not.toHaveBeenCalled(); expect(measure).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    fireEvent.scroll(page.querySelector('.pb-scroll')!);
    fireEvent.pointerMove(shelf, { clientX: 650, clientY: 200 });
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(measure).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledOnce();
    fireEvent.pointerCancel(shelf);
  });
  it('keeps pages and shelf cards memoized through busy changes and save completion', async () => {
    const shelfReads = vi.fn(() => '素材の原文');
    Object.defineProperty(material, 'text', { get: () => '素材の原文', configurable: true });
    const shelfText = vi.spyOn(material, 'text', 'get');
    shelfText.mockImplementation(shelfReads);
    const headingReads = vi.fn(() => ''); Object.defineProperty(board.layout.pages[2], 'heading', { get: headingReads, enumerable: true });
    let finish!: (value: BoardResponse) => void;
    vi.mocked(procedureBoardApi.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    show(); const original = await screen.findByText('<img src=x onerror=alert(1)>');
    const shelf = screen.getByText('素材の原文').closest('article')!;
    shelfReads.mockClear(); headingReads.mockClear();
    fireEvent.pointerDown(shelf, { button: 0, clientX: 10, clientY: 10 }); fireEvent.pointerCancel(shelf);
    expect(headingReads).not.toHaveBeenCalled(); expect(shelfReads).not.toHaveBeenCalled();
    fireEvent.click(original); fireEvent.change(screen.getByRole('textbox'), { target: { value: '新本文' } }); fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(procedureBoardApi.save).toHaveBeenCalledOnce()); shelfReads.mockClear();
    await act(async () => finish({ ...board, version: 2, layout: vi.mocked(procedureBoardApi.save).mock.calls[0][2] }));
    expect(shelfReads).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('新本文')); expect(screen.getByRole('textbox')).toHaveValue('新本文');
  });
  it.each(['early move', 'early release', 'cancel', 'hold'])('requires a touch hold before dragging: %s', async action => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerType: string; pointerId: number;
      constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerType = init.pointerType ?? ''; this.pointerId = init.pointerId ?? 0; }
    });
    const view = show(); await screen.findByText('<img src=x onerror=alert(1)>');
    const shelf = screen.getByText('素材の原文').closest('article')!;
    const capture = vi.fn(); shelf.setPointerCapture = capture;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(screen.getByRole('region', { name: 'ページ3' }));
    vi.useFakeTimers();
    const touch = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 10, clientY: 10 };
    fireEvent.pointerDown(shelf, touch);
    await act(async () => vi.advanceTimersByTimeAsync(249)); expect(capture).not.toHaveBeenCalled();
    if (action === 'early move') fireEvent.pointerMove(shelf, { ...touch, clientY: 30 });
    if (action === 'early release') fireEvent.pointerUp(shelf, touch);
    if (action === 'cancel') fireEvent.pointerCancel(shelf, touch);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(capture).toHaveBeenCalledTimes(action === 'hold' ? 1 : 0);
    fireEvent.pointerMove(shelf, { ...touch, clientX: 1500, clientY: 400 });
    fireEvent.pointerUp(shelf, { ...touch, clientX: 1500, clientY: 400 });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(procedureBoardApi.save).toHaveBeenCalledTimes(action === 'hold' ? 1 : 0); view.unmount();
  });
  it('does not start dragging below six pixels', async () => {
    show(); await screen.findByText('<img src=x onerror=alert(1)>');
    const card = screen.getByText('素材の原文').closest('article')!;
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 10, clientY: 10 }); fireEvent.pointerMove(card, { pointerId: 1, clientX: 13, clientY: 12 });
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 13, clientY: 12 }); expect(procedureBoardApi.save).not.toHaveBeenCalled();
  });
});
