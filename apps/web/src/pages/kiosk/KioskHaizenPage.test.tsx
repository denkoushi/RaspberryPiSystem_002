import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getHaizenOverview, getMobilePlacementRegisteredShelves } from '../../api/domains/mobile-placement';
import { startVoiceTranscription } from '../../features/voice/voiceTranscription';

import { KioskHaizenPage } from './KioskHaizenPage';

vi.mock('../../api/domains/mobile-placement', () => ({ getHaizenOverview: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn() }));
vi.mock('../../features/mobile-placement/shelfPhoto/useShelfPhoto', () => ({ useShelfPhoto: () => ({ url: undefined, isError: false }) }));
vi.mock('../../features/voice/voiceTranscription', () => ({ startVoiceTranscription: vi.fn(), disposeVoiceSession: vi.fn() }));
const base = { manufacturingOrderBarcodeRaw: '123', fseiban: 'BA1S2320', fhincd: 'K0381', fhinmei: 'ブラケット', machineName: 'ＲＶ－１２Ａ' };
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
  fireEvent.click(await screen.findByRole('button', { name: '番号で探す' }));
  const dialog = screen.getByRole('dialog', { name: '番号で探す' });
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: input } });
  fireEvent.click(within(dialog).getByRole('button', { name: '探す', exact: true }));
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: false });
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [3, 2, 1].map(index => ({ shelfCodeRaw: `西-北-0${index}`, displayLabel: `棚名${index}`, isStructured: true })) });
});
afterEach(() => { cleanup(); client.clear(); });

describe('KioskHaizenPage', () => {
  it('renders registered shelves in code order, empty shelf, size and inventory back link', async () => {
    mount();
    await screen.findByRole('button', { name: '棚 西-北-01 棚名1' });
    expect(screen.getAllByRole('button', { name: /^棚 西/ }).map(button => button.getAttribute('aria-label'))).toEqual(['棚 西-北-01 棚名1', '棚 西-北-02 棚名2', '棚 西-北-03 棚名3']);
    expect(screen.getByText('棚名3 ・ 空き')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /在庫へ/ })).toHaveAttribute('href', '/kiosk/inventory');
    fireEvent.click(screen.getByRole('button', { name: '小', exact: true }));
    expect(screen.queryByText('ブラケット')).not.toBeInTheDocument();
    expect(screen.getByText(/更新$/)).toBeInTheDocument();
  });
  it('narrows to matching shelves and cancel restores the full grid', async () => {
    mount(); await screen.findByText('棚名1'); await search('ｂａ１ｓ ２３');
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(2);
    expect(screen.getByText('2 件 ・ 2 棚')).toBeInTheDocument();
    expect(screen.getAllByText('1件 一致')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(3);
  });
  it('opens a single-shelf result, highlights hits, keeps newest first and links other branches', async () => {
    mount(); await screen.findByText('棚名1'); await search('unique');
    expect(screen.getByRole('heading', { name: 'この棚の部品' })).toBeInTheDocument();
    const parts = screen.getAllByRole('article');
    expect(parts[0]).toHaveTextContent('新しい部品');
    expect(parts[0].querySelector('mark')).toHaveTextContent('UNIQUE');
    expect(within(parts[1]).getByText('RV-12A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '西-北-01 棚名1' }));
    expect(screen.getByRole('heading', { name: '棚名1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    fireEvent.click(screen.getByRole('button', { name: '次の棚 ›' }));
    expect(screen.getByRole('heading', { name: '棚名2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚の一覧へ' }));
    expect(screen.getAllByRole('button', { name: /^棚 西/ })).toHaveLength(3);
  });
  it('searches by candidate and keypad, and handles zero hits', async () => {
    mount(); await screen.findByText('棚名1');
    fireEvent.click(screen.getByRole('button', { name: '番号で探す' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '機種名', exact: true }));
    expect(within(dialog).getByRole('button', { name: 'RV-12A' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'R', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: '1', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: '1字消す' }));
    expect(within(dialog).getByRole('textbox')).toHaveValue('R');
    fireEvent.click(within(dialog).getByRole('button', { name: '全部消す' }));
    expect(within(dialog).getByRole('button', { name: '探す', exact: true })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'RV-12A' }));
    expect(screen.getByText('3 件 ・ 2 棚')).toBeInTheDocument();
    await search('NOTFOUND');
    expect(screen.getByText('一致する部品はどの棚にもありません')).toBeInTheDocument();
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
