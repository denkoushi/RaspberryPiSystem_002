import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteHaizenCurrentPlacement, deleteOrderPlacementBranch, getHaizenOverview, getMobilePlacementRegisteredShelves } from '../../api/domains/mobile-placement';
import { startVoiceTranscription } from '../../features/voice/voiceTranscription';

import { KioskHaizenPage } from './KioskHaizenPage';

vi.mock('../../api/domains/mobile-placement', () => ({ deleteHaizenCurrentPlacement: vi.fn(), deleteOrderPlacementBranch: vi.fn(), getHaizenOverview: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn() }));
vi.mock('../../features/mobile-placement/shelfPhoto/useShelfPhoto', () => ({ useShelfPhoto: () => ({ url: undefined, isError: false }) }));
vi.mock('../../features/voice/voiceTranscription', () => ({ startVoiceTranscription: vi.fn(), disposeVoiceSession: vi.fn() }));
const base = { source: 'branch' as const, manufacturingOrderBarcodeRaw: '123', fseiban: 'BA1S2320', fhincd: 'K0381', fhinmei: 'ブラケット', machineName: 'ＲＶ－１２Ａ' };
const rows = [
  { ...base, id: '1', shelfCodeRaw: '西-北-01', branchNo: 1, updatedAt: '2026-10-21T01:00:00Z' },
  { ...base, id: '2', shelfCodeRaw: '西-北-02', branchNo: 2, updatedAt: '2026-10-22T01:00:00Z' },
  { ...base, id: '3', shelfCodeRaw: '西-北-02', branchNo: 1, manufacturingOrderBarcodeRaw: '456', fseiban: 'UNIQUE', fhincd: 'ONLY', fhinmei: '新しい部品', updatedAt: '2026-10-22T02:00:00Z' }
];
let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><KioskHaizenPage /></MemoryRouter></QueryClientProvider>);
};
const search = async (input: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: '番号' }), { target: { value: input } });
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: false });
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [3, 2, 1].map(index => ({ shelfCodeRaw: `西-北-0${index}`, displayLabel: `棚名${index}`, isStructured: true })) });
});
afterEach(() => { cleanup(); client.clear(); });

describe('KioskHaizenPage', () => {
  it('renders branch zero as なし', async () => {
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows: [{ ...rows[0], branchNo: 0 }], truncated: false });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 棚名1' }));
    const part = screen.getByRole('article', { name: 'ブラケット 分配なし' });
    expect(within(part).getByText('なし', { exact: true })).toBeInTheDocument();
  });
  it('renders registered shelves in code order, empty shelf, size and inventory back link', async () => {
    mount();
    await screen.findByRole('button', { name: '棚 西-北-01 棚名1' });
    expect(screen.getAllByRole('button', { name: /^棚 西/ }).map(button => button.getAttribute('aria-label'))).toEqual(['棚 西-北-01 棚名1', '棚 西-北-02 棚名2', '棚 西-北-03 棚名3']);
    expect(screen.getByText('空き')).toBeInTheDocument();
    expect(screen.queryByText('ブラケット')).not.toBeInTheDocument();
    expect(screen.queryByText('BA1S2320')).not.toBeInTheDocument();
    expect(screen.queryByText('西-北-01')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '番号で探す' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /在庫へ/ })).toHaveAttribute('href', '/kiosk/inventory');
    fireEvent.click(screen.getByRole('button', { name: '小', exact: true }));
    expect(screen.queryByText('ブラケット')).not.toBeInTheDocument();
    expect(screen.getByText(/更新$/)).toBeInTheDocument();
  });
  it('narrows to matching shelves and cancel restores the full grid', async () => {
    mount(); await screen.findByText('棚名1'); await search('ｂａ１ｓ ２３');
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(2);
    expect(screen.getByText('を含む 2 件 ・ 2 棚')).toBeInTheDocument();
    expect(screen.getAllByText('1件 一致')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(3);
  });
  it('opens a matching shelf on click, highlights hits, keeps newest first and links other branches', async () => {
    mount(); await screen.findByText('棚名1'); await search('unique');
    fireEvent.click(screen.getByRole('button', { name: '棚 西-北-02 棚名2' }));
    expect(screen.getByRole('heading', { name: 'この棚の部品' })).toBeInTheDocument();
    const parts = screen.getAllByRole('article');
    expect(parts[0]).toHaveTextContent('新しい部品');
    expect(parts[0].querySelector('mark')).toHaveTextContent('UNIQUE');
    expect(within(parts[1]).getByText('RV-12A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚名1' }));
    expect(screen.getByRole('heading', { name: '棚名1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    fireEvent.click(screen.getByRole('button', { name: '次の棚 ›' }));
    expect(screen.getByRole('heading', { name: '棚名2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚の一覧へ' }));
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(3);
  });
  it('filters live with keypad, keeps text on kind change, backspaces and clears with C', async () => {
    mount(); await screen.findByText('棚名1');
    expect(screen.getByRole('button', { name: '製番', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2', exact: true }));
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '3', exact: true }));
    expect(screen.getByRole('textbox')).toHaveValue('23');
    fireEvent.click(screen.getByRole('button', { name: '機種名', exact: true }));
    expect(screen.getByRole('textbox')).toHaveValue('23');
    expect(screen.getByText('一致する部品はどの棚にもありません')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1字消す' }));
    expect(screen.getByRole('textbox')).toHaveValue('2');
    expect(screen.getByText('を含む 3 件 ・ 2 棚')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部消す' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '品番', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '0', exact: true }));
    expect(screen.getByText('を含む 2 件 ・ 2 棚')).toBeInTheDocument();
  });
  it('shows a delayed text-only hover table with matched rows first and clears on leave', async () => {
    mount(); await screen.findByText('棚名2'); await search('2320');
    const card = screen.getByRole('button', { name: '棚 西-北-02 棚名2' });
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const tooltip = await screen.findByRole('tooltip');
    expect(card).toHaveAttribute('aria-describedby', tooltip.id);
    expect(tooltip.querySelector('img')).toBeNull();
    for (const name of ['製番', '品名', '品番', '機種名']) expect(within(tooltip).getByRole('columnheader', { name })).toBeInTheDocument();
    expect(within(tooltip).getAllByRole('row')[1]).toHaveTextContent('BA1S2320ブラケットK0381RV-12A');
    expect(within(tooltip).getAllByRole('row')[1]).toHaveClass('text-inv-cyan');
    expect(card).toHaveClass('ring-inv-cyan');
    expect(screen.getByRole('button', { name: '棚 西-北-01 棚名1' })).toHaveClass('opacity-[.55]');
    fireEvent.pointerLeave(card);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute('aria-describedby');
  });
  it('limits hover content to 15 rows and describes empty shelves', async () => {
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows: Array.from({ length: 18 }, (_, index) => ({ ...rows[0], id: String(index) })), truncated: false });
    mount(); await screen.findByText('棚名1');
    fireEvent.pointerEnter(screen.getByRole('button', { name: '棚 西-北-01 棚名1' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getAllByRole('row')).toHaveLength(16);
    expect(tooltip).toHaveTextContent('ほか 3 件（押すと全部見られます）');
    fireEvent.pointerEnter(screen.getByRole('button', { name: '棚 西-北-03 棚名3' }));
    expect(await screen.findByText('この棚には何も置かれていません')).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('confirms deletion inline, disables pending controls, refreshes and shows a four-second toast', async () => {
    let resolveDelete!: (value: Awaited<ReturnType<typeof deleteOrderPlacementBranch>>) => void;
    vi.mocked(deleteOrderPlacementBranch).mockImplementation(() => new Promise(resolve => { resolveDelete = resolve; }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 棚名1' }));
    const card = screen.getByRole('article');
    fireEvent.click(within(card).getByRole('button', { name: '消す', exact: true }));
    expect(card).toHaveTextContent('この品物を消しますか？');
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'やめる' }));
    expect(card).not.toHaveTextContent('この品物を消しますか？');
    fireEvent.click(within(card).getByRole('button', { name: '消す', exact: true }));
    fireEvent.click(within(card).getByRole('button', { name: '🗑 消す' }));
    await waitFor(() => expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith('1'));
    expect(within(card).getByRole('button', { name: '🗑 消す' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'やめる' })).toBeDisabled();
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows: rows.slice(1), truncated: false });
    resolveDelete({ deleted: rows[0] });
    expect(await screen.findByText('「ブラケット」を消しました')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('「ブラケット」を消しました')).not.toBeInTheDocument(), { timeout: 4500 });
  });
  it('shows, searches and deletes a Zero2W row independently of a branch with the same id', async () => {
    const zero2w = { ...rows[0], source: 'zero2w' as const, branchNo: null, fseiban: 'ZERO', fhinmei: '棚番端末の部品', updatedAt: '2026-10-24T00:00:00Z' };
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows: [...rows, zero2w], truncated: false });
    vi.mocked(deleteHaizenCurrentPlacement).mockResolvedValue({ deleted: zero2w });
    mount(); await screen.findByText('棚名1'); await search('zero');
    const shelf = screen.getByRole('button', { name: '棚 西-北-01 棚名1' });
    expect(shelf).toHaveTextContent('1件 一致');
    fireEvent.pointerEnter(shelf);
    const tooltip = await screen.findByRole('tooltip');
    const hoverRows = within(tooltip).getAllByRole('row');
    expect(hoverRows[1]).toHaveTextContent('棚番端末の部品');
    expect(hoverRows[1]).toHaveClass('text-inv-cyan');
    expect(hoverRows[2]).not.toHaveClass('text-inv-cyan');
    fireEvent.click(shelf);
    const card = screen.getByRole('article', { name: '棚番端末の部品 分配—' });
    const branch = screen.getByRole('article', { name: 'ブラケット 分配1' });
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('null');
    expect(card.querySelector('mark')).toHaveTextContent('ZERO');
    expect(branch.querySelector('mark')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '消す', exact: true }));
    expect(branch).not.toHaveTextContent('この品物を消しますか？');
    expect(deleteHaizenCurrentPlacement).not.toHaveBeenCalled();
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: false });
    fireEvent.click(within(card).getByRole('button', { name: '🗑 消す' }));
    await waitFor(() => expect(deleteHaizenCurrentPlacement).toHaveBeenCalledExactlyOnceWith('1'));
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('article', { name: '棚番端末の部品 分配—' })).not.toBeInTheDocument());
    expect(screen.getByRole('article', { name: 'ブラケット 分配1' })).toBeInTheDocument();
  });
  it('shows the API deletion error and keeps the item', async () => {
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { data: { message: 'この品物はもうありません' } } });
    mount(); fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 棚名1' }));
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '🗑 消す' }));
    expect(await screen.findByRole('status')).toHaveTextContent('この品物はもうありません');
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🗑 消す' })).toBeEnabled();
  });
  it('applies voice transcription and shows microphone failure gracefully', async () => {
    vi.mocked(startVoiceTranscription).mockImplementation(async (_session, _active, _processing, onTranscript) => { await onTranscript('製番 UNIQUE'); });
    mount(); await screen.findByText('棚名1');
    fireEvent.click(screen.getByRole('button', { name: '声で探す' }));
    await screen.findByRole('heading', { name: 'この棚の部品' });
    expect(screen.getByText('聞き取り:「製番 UNIQUE」')).toBeInTheDocument();
    vi.mocked(startVoiceTranscription).mockImplementation(async (_session, _active, _processing, _transcript, onError) => { onError('マイクを使えません'); });
    fireEvent.click(screen.getByRole('button', { name: '声で探す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('マイクを使えません');
  });
  it('keeps a branch on a shelf absent from the master reachable', async () => {
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows: [{ ...rows[2], shelfCodeRaw: 'LEGACY-A' }], truncated: false });
    mount(); await screen.findByText('棚マスタ未登録');
    await search('unique');
    fireEvent.click(screen.getByRole('button', { name: '棚 LEGACY-A 棚マスタ未登録' }));
    expect(screen.getByRole('heading', { name: 'この棚の部品' })).toBeInTheDocument();
    expect(screen.getByText('LEGACY-A')).toBeInTheDocument();
  });

  it('shows truncation and refresh failures without presenting stale data as freshly updated', async () => {
    vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: true });
    mount(); await screen.findByText(/最新3,000件/);
    vi.mocked(getHaizenOverview).mockRejectedValue(new Error('offline'));
    await client.invalidateQueries({ queryKey: ['mobile-placement', 'haizen-overview'] });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('前回取得した情報'));
    expect(screen.getByText('棚名1')).toBeInTheDocument();
  });
});
