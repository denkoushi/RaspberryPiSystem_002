import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { saveProcedureEditorAccess } from '../procedureEditorAccess';

import { ProcedureManualWorkshop } from './ProcedureManualWorkshop';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn(), knowledgeThumbnail: vi.fn(), workInstructionThumbnail: vi.fn(), createDocument: vi.fn(), count: vi.fn(), list: vi.fn(), ingest: vi.fn(), file: vi.fn(), discard: vi.fn(), restore: vi.fn(), unplace: vi.fn(), knowledge: vi.fn(), knowledgeImage: vi.fn(), importKnowledge: vi.fn(), workInstructions: vi.fn(), workInstructionImage: vi.fn(), importWorkInstructions: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureVideos: async () => [],
  listProcedureManualModels: async () => [], listProcedureManualProcesses: async () => [],
  getProcedureManualAssignments: vi.fn(), listAssemblyProcedureDocumentSummaries: vi.fn(),
  getAssemblyProcedureDocumentRevisions: vi.fn(), getKioskDocuments: vi.fn(), replaceProcedureManualAssignments: vi.fn(),
  listProcedureMaterials: (params: { q?: string }) => params.q === undefined ? mocks.count(params) : mocks.list(params), ingestProcedureMaterialsGmail: mocks.ingest, getProcedureMaterialFile: mocks.file, getProcedureMaterialThumbnail: mocks.thumbnail, getProcedureKnowledgeThumbnail: mocks.knowledgeThumbnail, getProcedureWorkInstructionThumbnail: mocks.workInstructionThumbnail,
  listProcedureKnowledgeCandidates: mocks.knowledge, getProcedureKnowledgeImage: mocks.knowledgeImage, importProcedureKnowledge: mocks.importKnowledge,
  createProcedureMaterialDocument: mocks.createDocument,
  listProcedureWorkInstructionCandidates: mocks.workInstructions, getProcedureWorkInstructionImage: mocks.workInstructionImage, importProcedureWorkInstructions: mocks.importWorkInstructions,
  discardProcedureMaterial: mocks.discard, restoreProcedureMaterial: mocks.restore, unplaceProcedureMaterial: mocks.unplace,
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({ AssemblyProcedureSequenceViewer: () => null }));
const text = { origin: 'GMAIL', id: 'text', kind: 'TEXT', text: '締付手順\n二行目\n三行目', subjectHint: 'DFD1 組立', fromEmail: 'sender@example.com', receivedAt: '2026-10-05T03:00:00Z', discardedAt: null, placedAt: null, documentId: null };
const photo = { ...text, id: 'photo', kind: 'PHOTO', text: null, originalFileName: '手順.png' };

describe('procedure-manuals material shelf', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear(); saveProcedureEditorAccess('2520'); mocks.count.mockResolvedValue([]); mocks.list.mockResolvedValue([text, photo]); mocks.file.mockResolvedValue(new Blob(['photo'], { type: 'image/png' }));
    mocks.ingest.mockResolvedValue({ scanned: 2, processed: 2, saved: 2, duplicate: 0, skipped: 1, retryable: 0, deferred: 0, skippedAttachments: 1, errors: [], messages: [{ messageId: 'unsupported', reason: '本文が空で、対応する写真がありません', warnings: [] }] });
    mocks.knowledge.mockResolvedValue({ enabled: false, items: [] });
    mocks.knowledgeImage.mockResolvedValue(new Blob(['knowledge'])); mocks.knowledgeThumbnail.mockResolvedValue(new Blob(['knowledge-thumbnail']));
    mocks.importKnowledge.mockResolvedValue({ imported: 2, duplicate: 0, failed: [] });
    mocks.workInstructions.mockResolvedValue({ items: [] });
    mocks.workInstructionImage.mockResolvedValue(new Blob(['work-instruction'])); mocks.workInstructionThumbnail.mockResolvedValue(new Blob(['work-thumbnail'])); mocks.thumbnail.mockResolvedValue(new Blob(['thumbnail']));
    mocks.importWorkInstructions.mockResolvedValue({ imported: 2, duplicate: 0, failed: [] });
    mocks.discard.mockResolvedValue(undefined); mocks.restore.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('loads only the active list without filters, then fetches four tabs in parallel and reuses queries across tabs', async () => {
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ state: 'unplaced', q: '', limit: 500 });
    expect(mocks.knowledge).not.toHaveBeenCalled(); expect(mocks.workInstructions).not.toHaveBeenCalled();
    let resolveMaterial!: (items: unknown[]) => void;
    let resolveKnowledge!: (result: unknown) => void;
    let resolveWork!: (result: unknown) => void;
    const pendingMaterials = new Promise<unknown[]>((resolve) => { resolveMaterial = resolve; });
    mocks.list.mockReturnValue(pendingMaterials);
    mocks.knowledge.mockReturnValue(new Promise((resolve) => { resolveKnowledge = resolve; }));
    mocks.workInstructions.mockReturnValue(new Promise((resolve) => { resolveWork = resolve; }));
    const input = screen.getByRole('searchbox', { name: '素材を探す' });
    fireEvent.change(input, { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.workInstructions).toHaveBeenCalledExactlyOnceWith({ q: 'DFD1', limit: 1000 }));
    expect(mocks.knowledge).toHaveBeenCalledExactlyOnceWith({ q: 'DFD1', limit: 100 });
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: 'DFD1', limit: 500 });
    expect(mocks.list).toHaveBeenCalledWith({ state: 'placed', q: 'DFD1', limit: 500 });
    await act(async () => { resolveMaterial([text, photo]); resolveKnowledge({ enabled: true, items: [] }); resolveWork({ items: [] }); });
    expect(screen.getByRole('tab', { name: /^未配置\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^配置済み\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^ナレッジから\s*0$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^加工の写真\s*0$/ })).toBeInTheDocument();
    for (const name of [/^配置済み/, /^ナレッジから/, /^加工の写真/, /^未配置/]) {
      fireEvent.click(screen.getByRole('tab', { name })); expect(input).toHaveValue('DFD1');
    }
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledTimes(3); expect(mocks.knowledge).toHaveBeenCalledOnce(); expect(mocks.workInstructions).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '検索語を消す' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^DFD1 組立/ })).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'DFD1' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^DFD1 組立/ })).not.toBeInTheDocument());
    expect(mocks.list).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(5));
    expect(mocks.knowledge).toHaveBeenCalledTimes(2); expect(mocks.workInstructions).toHaveBeenCalledTimes(2);
  });
  it('filters loaded lists and tab counts with multiple sources and kinds, and shows only supported chips', async () => {
    const recent = new Date(Date.now() - 60000).toISOString();
    mocks.list.mockResolvedValue([
      { ...text, receivedAt: recent }, { ...photo, receivedAt: recent },
      { ...photo, id: 'processing', origin: 'WORK_INSTRUCTION', receivedAt: recent },
      { ...photo, id: 'old', kind: 'PDF', receivedAt: new Date(Date.now() - 40 * 86400000).toISOString() },
    ]);
    mocks.knowledge.mockResolvedValue({ enabled: true, items: [{ candidateKey: 'knowledge:text', kind: 'TEXT', title: '知識', preview: '本文', sourceLabel: 'Chat', alreadyImported: false }] });
    mocks.workInstructions.mockResolvedValue({ items: [{ candidateKey: 'work:1', partNumber: 'MH-1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset', alreadyImported: false }] });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    const chips = screen.getByLabelText('素材の絞り込み');
    fireEvent.click(within(chips).getByRole('button', { name: '写真' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^加工の写真\s*1$/ })).toBeInTheDocument());
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('2 件');
    expect(screen.getByRole('tab', { name: /^未配置\s*2$/ })).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('button', { name: 'メール' }));
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('1 件');
    fireEvent.click(within(chips).getByRole('button', { name: '加工' }));
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('2 件');
    fireEvent.click(within(chips).getByRole('button', { name: '文章' }));
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('3 件');
    fireEvent.click(within(chips).getByRole('button', { name: '7日' }));
    fireEvent.click(within(chips).getByRole('button', { name: '30日' }));
    expect(within(chips).getByRole('button', { name: '7日' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(chips).getByRole('button', { name: '30日' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(chips).getByRole('button', { name: '絞り込みを外す' }));
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('4 件');
    expect(within(chips).queryByRole('button', { name: '絞り込みを外す' })).not.toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('button', { name: '7日' }));
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('3 件');
    expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.knowledge).toHaveBeenCalledOnce(); expect(mocks.workInstructions).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    expect(within(chips).queryByRole('button', { name: '7日' })).not.toBeInTheDocument();
    expect(within(chips).queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('1 件');
    fireEvent.click(screen.getByRole('tab', { name: /^加工の写真/ }));
    expect(within(chips).queryByRole('button', { name: '7日' })).not.toBeInTheDocument();
    expect(within(chips).queryByRole('button', { name: '文章' })).not.toBeInTheDocument();
    expect(within(chips).queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '一致件数' })).toHaveTextContent('1 件');
  });
  it('highlights full-width search in titles and existing excerpts without bundles', async () => {
    mocks.workInstructions.mockResolvedValue({ items: [{ candidateKey: 'work:1', partNumber: 'MH-4521', shootingTarget: '外径', step: 1, memo: 'mh-4521 のメモ', assetId: 'asset', alreadyImported: false }] });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＭＨ－４５２１' } });
    await waitFor(() => expect(mocks.workInstructions).toHaveBeenCalledWith({ q: 'ＭＨ－４５２１', limit: 1000 }));
    fireEvent.click(screen.getByRole('tab', { name: /^加工の写真/ }));
    const checkbox = await screen.findByRole('checkbox', { name: 'MH-4521 外径 手順 1' });
    const card = checkbox.closest('li')!;
    expect(card.querySelectorAll('mark')).toHaveLength(3);
    expect([...card.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['MH-4521', 'MH-4521', 'mh-4521']);
    expect(screen.queryByRole('button', { name: '束を全部選ぶ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '検索語を消す' }));
    expect(await screen.findByRole('button', { name: /^MH-4521 撮影対象/ })).toBeInTheDocument();
  });
  it('shows a highlighted body match beyond the opening lines and on photos/PDFs from the same listed email', async () => {
    const body = `${'冒頭の文章\n'.repeat(8)}${'前の文'.repeat(12)} mh-4521 を締める。後の文${'続き'.repeat(30)}`;
    mocks.list.mockResolvedValue([
      { ...text, subjectHint: '本文', gmailMessageId: 'mail-1', text: body },
      { ...photo, subjectHint: '写真', gmailMessageId: 'mail-1' },
      { ...photo, id: 'pdf', kind: 'PDF', subjectHint: 'PDF', gmailMessageId: 'mail-1' },
      { ...photo, id: 'other', subjectHint: '別メール', gmailMessageId: 'mail-2' },
      { ...photo, id: 'null', subjectHint: 'メールなし', gmailMessageId: null },
    ]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', '品番・ヒント・本文');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＭＨ－４５２１' } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: 'ＭＨ－４５２１', limit: 500 }));
    for (const title of ['本文', '写真', 'PDF']) {
      await waitFor(() => expect(screen.getByRole('checkbox', { name: title }).closest('li')!.querySelector('mark')).toHaveTextContent('mh-4521'));
      const card = screen.getByRole('checkbox', { name: title }).closest('li')!;
      expect(card).toHaveTextContent('前の文 mh-4521 を締める。後の文');
      expect(card).not.toHaveTextContent('冒頭の文章');
      if (title !== '本文') expect(card.querySelector('p.truncate')).toBeInTheDocument();
    }
    for (const title of ['別メール', 'メールなし']) expect(screen.getByRole('checkbox', { name: title }).closest('li')!.querySelector('mark')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '本文' }).closest('li')).toHaveTextContent('冒頭の文章'));
    expect(screen.getByRole('dialog').querySelector('p.truncate')).toBeNull();
  });
  it('retains hidden selections across search and chips, places their saved DTO, and clears on tab switches', async () => {
    mocks.list.mockImplementation(({ q }: { q: string }) => Promise.resolve(q ? [] : [photo]));
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '見えない' } });
    await screen.findByText('見つかりません');
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    fireEvent.click(within(screen.getByLabelText('素材の絞り込み')).getByRole('button', { name: '文章' }));
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    expect(await within(screen.getByLabelText('選択した素材のサムネイル')).findByRole('img')).toHaveAttribute('src', 'blob:photo');
    expect(mocks.thumbnail).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith(photo));
    fireEvent.click(within(screen.getByLabelText('素材の絞り込み')).getByRole('button', { name: '絞り込みを外す' }));
    fireEvent.click(screen.getByRole('button', { name: '検索語を消す' }));
    await screen.findByRole('tab', { name: '未配置 (0)' });
    fireEvent.click(screen.getByRole('tab', { name: /^配置済み/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.click(screen.getByRole('tab', { name: /^未配置/ }));
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('0 件を選択中');
    expect(screen.queryByLabelText('選択した素材のサムネイル')).not.toBeInTheDocument();
  });
  it('imports processing selections that disappear from the current search and clears them after success', async () => {
    const candidate = { candidateKey: 'work:1', partNumber: 'MH-1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset', alreadyImported: false };
    mocks.workInstructions.mockImplementation(({ q }: { q: string }) => Promise.resolve({ items: q ? [] : [candidate] }));
    mocks.importWorkInstructions.mockResolvedValue({ imported: 1, duplicate: 0, failed: [{ candidateKey: 'other', reason: '別候補' }] });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'MH-1 外径 手順 1' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '別の品番' } });
    await screen.findByText('見つかりません');
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    await waitFor(() => expect(mocks.importWorkInstructions).toHaveBeenCalledExactlyOnceWith([{ candidateKey: 'work:1', partNumber: 'MH-1', shootingTarget: '外径' }]));
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('0 件を選択中');
  });
  it('keeps successful tabs usable when another tab fails, omits its count and retries it on revisit', async () => {
    mocks.knowledge.mockRejectedValue(new Error('候補の取得失敗'));
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'DFD1' } });
    await screen.findByRole('tab', { name: /^未配置\s*2$/ });
    expect(screen.getByRole('tab', { name: 'ナレッジから' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'ナレッジから' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('候補の取得失敗');
    fireEvent.click(screen.getByRole('tab', { name: /^配置済み/ }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mocks.knowledge.mockResolvedValue({ enabled: true, items: [] });
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.knowledge.mock.calls.length).toBeGreaterThan(1);
  });
  it.each(['browse', 'place', 'replace'] as const)('shows a PDF card and creates a document in %s mode', async (mode) => {
    mocks.list.mockResolvedValue([{ ...photo, id: 'pdf', kind: 'PDF', subjectHint: null, originalFileName: '原本.pdf' }]);
    mocks.createDocument.mockResolvedValue({ id: 'created-document', name: '原本' });
    const onSelect = mode === 'browse' ? undefined : vi.fn();
    const onCreatedDocument = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={onSelect} mode={mode === 'replace' ? 'replace' : 'place'} onCreatedDocument={onCreatedDocument} />);
    expect(await screen.findByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('原本.pdf')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: '原本.pdf' });
    if (mode === 'browse') expect(checkbox).toBeEnabled();
    else expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '要領書を作る' }));
    expect(await screen.findByText('要領書『原本』を作成しました')).toBeInTheDocument();
    expect(mocks.createDocument).toHaveBeenCalledExactlyOnceWith('pdf');
    expect(onCreatedDocument).toHaveBeenCalledExactlyOnceWith('created-document');
    expect(mocks.file).not.toHaveBeenCalled();
    if (onSelect) expect(onSelect).not.toHaveBeenCalled();
  });
  it('shows create errors and disables creation for placed or discarded PDFs', async () => {
    mocks.list.mockResolvedValue([{ ...photo, id: 'pdf', kind: 'PDF' }]);
    mocks.createDocument.mockRejectedValue(new Error('failed'));
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '要領書を作る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('failed');
    mocks.list.mockResolvedValue([{ ...photo, id: 'pdf', kind: 'PDF', documentId: 'created', placedAt: '2026-10-07T06:00:00Z' }]);
    fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
    expect(await screen.findByRole('button', { name: '要領書を作る' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '配置を取り消す' })).not.toBeInTheDocument();
    mocks.list.mockResolvedValue([{ ...photo, id: 'pdf', kind: 'PDF', discardedAt: '2026-10-07T06:00:00Z' }]);
    fireEvent.click(screen.getByRole('button', { name: '捨てた素材' }));
    expect(await screen.findByRole('button', { name: '要領書を作る' })).toBeDisabled();
  });
  it('opens the shelf from the workshop, shows text/photo metadata, filters hints, and manually ingests/reloads', async () => {
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    expect(await screen.findByText(/締付手順/)).toHaveClass('line-clamp-6');
    expect(await screen.findByRole('img', { name: '手順.png' })).toHaveAttribute('src', 'blob:photo');
    expect(screen.getAllByText('DFD1 組立')).toHaveLength(3);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 500 });
    fireEvent.change(screen.getByLabelText('素材を探す'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: 'DFD1', limit: 500 }));
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText('見つけた 2 通・取込 2件・保存済み 0件・スキップ 1通・再試行 0通・再試行待ち 0通・除外添付 1件')).toBeInTheDocument(); expect(screen.getByText('本文が空で、対応する写真がありません')).toBeInTheDocument();
    expect(screen.queryByText('受信トレイに未読の対象メールがありません')).not.toBeInTheDocument();
    expect(mocks.ingest).toHaveBeenCalledOnce(); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(5));
    expect(screen.queryByRole('button', { name: '現在ページに配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('opens only the first bundle, restores expansion after search, and resets it when switching tabs', async () => {
    mocks.list.mockResolvedValue([
      { ...text, subjectHint: 'DFD1 組立' },
      { ...photo, subjectHint: 'DFD2 組立' },
      { ...photo, id: 'other', subjectHint: '検査' },
    ]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    const first = await screen.findByRole('button', { name: /^DFD1 組立/ });
    const second = screen.getByRole('button', { name: /^DFD2 組立/ });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(mocks.file).not.toHaveBeenCalled();
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    await screen.findByRole('img', { name: '手順.png' });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByLabelText('素材を探す'), { target: { value: 'DFD' } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: 'DFD', limit: 500 }));
    expect(screen.queryByRole('button', { name: /^DFD1 組立/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^DFD2 組立/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('素材を探す'), { target: { value: '' } });
    expect(await screen.findByRole('button', { name: /^DFD1 組立/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^DFD2 組立/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
    expect(await screen.findByRole('button', { name: /^DFD1 組立/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^DFD2 組立/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('tab', { name: /^未配置/ }));
    expect(await screen.findByRole('button', { name: /^DFD1 組立/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^DFD2 組立/ })).toHaveAttribute('aria-expanded', 'false');
  });
  it.each(['unplaced', 'placed'] as const)('adds and removes only selectable cards in a %s bundle without affecting other bundles or expansion', async (tab) => {
    mocks.list.mockResolvedValue([text, photo, { ...photo, id: 'pdf', kind: 'PDF' }, { ...text, id: 'other', subjectHint: '別の束' }]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByRole('button', { name: /^DFD1 組立/ });
    if (tab === 'placed') {
      fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
      await screen.findByRole('button', { name: /^DFD1 組立/ });
    }
    const otherHeader = await screen.findByRole('button', { name: /^別の束/ });
    fireEvent.click(otherHeader);
    fireEvent.click(screen.getByRole('checkbox', { name: '別の束' }));
    const header = screen.getByRole('button', { name: /^DFD1 組立/ });
    const pick = within(header).getByRole('button', { name: '束を全部選ぶ' });
    fireEvent.click(pick);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('3 件を選択中');
    const checks = screen.getAllByRole('checkbox', { name: 'DFD1 組立' });
    expect(checks.filter((check) => (check as HTMLInputElement).checked)).toHaveLength(2);
    expect(checks[2]).toBeDisabled();
    fireEvent.click(pick);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    expect(screen.getByRole('checkbox', { name: '別の束' })).toBeChecked();
  });
  it('bulk-selects processing photos within the import limit and excludes imported candidates', async () => {
    mocks.workInstructions.mockResolvedValue({ items: Array.from({ length: 52 }, (_, index) => ({
      candidateKey: `work:${index}`, partNumber: 'DFD1', shootingTarget: '外径', step: index + 1, memo: '', assetId: `asset-${index}`, alreadyImported: index === 0,
    })) });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    const header = await screen.findByRole('button', { name: /^DFD1 撮影対象/ });
    expect(mocks.workInstructions).toHaveBeenCalledWith({ q: '', limit: 1000 });
    const pick = within(header).getByRole('button', { name: '束を全部選ぶ' });
    fireEvent.click(pick);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('50 件を選択中');
    expect(screen.getByRole('checkbox', { name: 'DFD1 外径 手順 1' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'DFD1 外径 手順 52' })).toBeDisabled();
    fireEvent.click(pick);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('0 件を選択中');
  });
  it('hides bundle selection in replacement mode on material and processing tabs', async () => {
    mocks.workInstructions.mockResolvedValue({ items: [{ candidateKey: 'work:1', partNumber: 'DFD1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset', alreadyImported: false }] });
    render(<ProcedureMaterialShelfDialog mode="replace" onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findAllByRole('checkbox');
    expect(screen.queryByRole('button', { name: '束を全部選ぶ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    await screen.findByRole('checkbox', { name: 'DFD1 外径 手順 1' });
    expect(screen.queryByRole('button', { name: '束を全部選ぶ' })).not.toBeInTheDocument();
  });
  it('tabs to a closed replacement bundle through the focus trap and toggles it with Enter and Space', async () => {
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
    try {
      mocks.list.mockResolvedValue([text, { ...photo, subjectHint: '写真' }]);
      render(<ProcedureMaterialShelfDialog mode="replace" onClose={vi.fn()} onSelect={vi.fn()} />);
      const header = await screen.findByRole('button', { name: /^写真/, expanded: false });
      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(header).toHaveAttribute('tabindex', '0');
      const first = screen.getByRole('searchbox', { name: '素材を探す' });
      first.focus();
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(header).toHaveFocus();
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(header).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('checkbox', { name: '写真' })).toBeInTheDocument();
      fireEvent.keyDown(header, { key: ' ' });
      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('checkbox', { name: '写真' })).not.toBeInTheDocument();
      fireEvent.keyDown(header, { key: 'Tab' });
      expect(first).toHaveFocus();
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      fireEvent.keyDown(header, { key: ' ' });
      expect(header).toHaveAttribute('aria-expanded', 'true');
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(header).toHaveAttribute('aria-expanded', 'false');
    } finally {
      offsetParent.mockRestore();
    }
  });
  it('keeps expansion independent for file bases and the literal missing-hint label', async () => {
    mocks.list.mockResolvedValue([text, { ...photo, subjectHint: 'ヒントなし' }, { ...photo, id: 'missing', subjectHint: null }]);
    render(<ProcedureMaterialShelfDialog mode="replace" onClose={vi.fn()} onSelect={vi.fn()} />);
    const headers = await screen.findAllByRole('button', { name: /^(ヒントなし|手順)/ });
    expect(headers).toHaveLength(2);
    fireEvent.click(headers[0]);
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true');
    expect(headers[1]).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(headers[1]);
    fireEvent.click(headers[0]);
    expect(headers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(headers[1]).toHaveAttribute('aria-expanded', 'true');
  });
  it('shows each attachment warning below its message reason and leaves empty warnings blank', async () => {
    const reason = '本文が空で、対応する写真・動画がありません';
    const unsupported = 'ハンドル2.png (image/x-png): 対応外の添付';
    const oversized = '写真.jpg: 10 MB超過';
    const otherReason = '送信元のドメインが許可されていません';
    mocks.ingest.mockResolvedValue({ scanned: 2, processed: 2, saved: 0, duplicate: 0, skipped: 2, retryable: 0, deferred: 0, skippedAttachments: 2, errors: [], messages: [
      { messageId: 'unsupported', reason, warnings: [unsupported, oversized] },
      { messageId: 'sender', reason: otherReason, warnings: [] },
    ] });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    const reasonLine = await screen.findByText(reason);
    expect(reasonLine.nextElementSibling).toHaveTextContent(unsupported);
    expect(reasonLine.nextElementSibling?.nextElementSibling).toHaveTextContent(oversized);
    expect(screen.getByText(unsupported).tagName).toBe('P');
    expect(screen.getByText(oversized).tagName).toBe('P');
    const otherReasonLine = screen.getByText(otherReason);
    expect(otherReasonLine.nextElementSibling).toBeNull();
    expect(otherReasonLine.parentElement).not.toHaveTextContent(unsupported);
  });
  it('shows warnings for saved messages without a reason', async () => {
    const warning = '手順.heic (image/heic): 対応外の添付';
    mocks.ingest.mockResolvedValue({ scanned: 1, processed: 1, saved: 1, duplicate: 0, skipped: 0, retryable: 0, deferred: 0, skippedAttachments: 1, errors: [], messages: [
      { messageId: 'saved', status: 'saved', warnings: [warning] },
    ] });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText(warning)).toBeInTheDocument();
  });
  it('shows a no-unread-mail message when ingestion finds no messages', async () => {
    mocks.ingest.mockResolvedValue({ scanned: 0, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 0, skippedAttachments: 0, errors: [], messages: [] });
    render(<ProcedureMaterialShelfDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText('受信トレイに未読の対象メールがありません')).toBeInTheDocument();
    expect(screen.getByText('見つけた 0 通・取込 0件・保存済み 0件・スキップ 0通・再試行 0通・再試行待ち 0通・除外添付 0件')).toBeInTheDocument();
  });
  it('shows deferred counts without a no-unread-mail message when messages were found', async () => {
    mocks.ingest.mockResolvedValue({ scanned: 2, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 2, skippedAttachments: 0, errors: [], messages: [] });
    render(<ProcedureMaterialShelfDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText('見つけた 2 通・取込 0件・保存済み 0件・スキップ 0通・再試行 0通・再試行待ち 2通・除外添付 0件')).toBeInTheDocument();
    expect(screen.queryByText('受信トレイに未読の対象メールがありません')).not.toBeInTheDocument();
  });
  it('fetches only visible photos once and disconnects observers/revokes URLs on close', async () => {
    const observers: Array<{ notify: (visible: boolean) => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ notify: (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver), observe: this.observe, disconnect: this.disconnect });
      }
    });
    mocks.list.mockResolvedValue([photo, { ...photo, id: 'offscreen', originalFileName: '範囲外.png' }]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(observers[0]!.observe).toHaveBeenCalledOnce();
    expect(mocks.thumbnail).not.toHaveBeenCalled();
    act(() => { observers[0]!.notify(false); });
    expect(mocks.thumbnail).not.toHaveBeenCalled();
    act(() => { observers[0]!.notify(true); observers[0]!.notify(true); });
    expect(await screen.findByRole('img', { name: '手順.png' })).toBeInTheDocument();
    expect(mocks.thumbnail).toHaveBeenCalledExactlyOnceWith('photo');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:photo');
  });
  it('does not create an object URL if a photo response arrives after closing', async () => {
    let resolve: (blob: Blob) => void = () => undefined;
    mocks.thumbnail.mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    mocks.list.mockResolvedValue([photo]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => { resolve(new Blob(['photo'])); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('discards then lists discarded materials and restores them', async () => {
    mocks.list.mockResolvedValueOnce([text]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, discardedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.click(screen.getByRole('button', { name: '捨てる' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材を捨てる' })).getByRole('button', { name: '捨てる' }));
    await screen.findByText('見つかりません'); expect(mocks.discard).toHaveBeenCalledWith('text');
    fireEvent.click(screen.getByRole('button', { name: '捨てた素材' }));
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('text'));
    await screen.findByText('見つかりません'); expect(mocks.list).toHaveBeenLastCalledWith({ state: 'discarded', q: '', limit: 500 });
  });
  it('selects unplaced materials with the existing hint filter and keeps placement failures visible', async () => {
    mocks.list.mockResolvedValue([text]);
    const onSelect = vi.fn().mockRejectedValueOnce(new Error('配置エラー')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 500 });
    expect(screen.getByRole('tab', { name: /^配置済み/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('配置エラー');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledWith(text);
    expect(screen.queryByRole('checkbox', { name: 'DFD1 組立' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^未配置/ })).toHaveTextContent('未配置 (0)');
  });
  it('selects placed text/photos without unplace or discard actions and retains them after repeated placement', async () => {
    const placedText = { ...text, documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' };
    const placedPhoto = { ...photo, subjectHint: '配置済み写真', documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' };
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([placedText, placedPhoto]);
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    await screen.findByText('見つかりません');
    fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
    const textCheck = await screen.findByRole('checkbox', { name: 'DFD1 組立' });
    fireEvent.click(screen.getByRole('button', { name: /^配置済み写真/ }));
    const photoCheck = screen.getByRole('checkbox', { name: '配置済み写真' });
    expect(textCheck).toBeEnabled(); expect(photoCheck).toBeEnabled();
    expect(mocks.list).toHaveBeenLastCalledWith({ state: 'placed', q: '', limit: 500 });
    expect(screen.queryByRole('button', { name: '配置を取り消す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '捨てる' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '現在ページに配置' })).not.toBeInTheDocument();
    fireEvent.click(textCheck); fireEvent.click(photoCheck);
    const place = screen.getByRole('button', { name: '現在ページに配置' });
    expect(place).toBeEnabled();
    fireEvent.click(place);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenNthCalledWith(1, placedText);
    expect(onSelect).toHaveBeenNthCalledWith(2, placedPhoto);
    expect(textCheck).toBeInTheDocument(); expect(textCheck).not.toBeChecked();
    expect(photoCheck).toBeInTheDocument(); expect(photoCheck).not.toBeChecked();
    fireEvent.click(photoCheck); fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(onSelect).toHaveBeenNthCalledWith(3, placedPhoto);
    expect(mocks.unplace).not.toHaveBeenCalled(); expect(mocks.discard).not.toHaveBeenCalled();
  });
  it('returns placed materials to the shelf through the placed tab', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, documentId: 'document', placedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await screen.findByText('見つかりません');
    fireEvent.click(screen.getByRole('tab', { name: /^配置済み/ }));
    fireEvent.click(await screen.findByRole('button', { name: '配置を取り消す' }));
    await waitFor(() => expect(mocks.unplace).toHaveBeenCalledWith('text'));
    expect(mocks.list).toHaveBeenCalledWith({ state: 'placed', q: '', limit: 500 });
  });
  it.each(['unplaced', 'placed'] as const)('allows only one photo in replacement mode on the %s tab and keeps failed replacement selections visible', async (state) => {
    const first = { ...photo, subjectHint: '写真1' };
    const second = { ...photo, id: 'photo-2', subjectHint: '写真2' };
    const materials = [text, first, second].map((material) => state === 'placed' ? { ...material, documentId: 'old-document', placedAt: '2026-10-05T04:00:00Z' } : material);
    mocks.list.mockResolvedValue(materials);
    const onSelect = vi.fn().mockRejectedValueOnce(new Error('現在は画像を差し替えできません')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog mode="replace" onClose={onClose} onSelect={onSelect} />);
    await screen.findByRole('checkbox', { name: 'DFD1 組立' });
    if (state === 'placed') fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
    const textCheck = await screen.findByRole('checkbox', { name: 'DFD1 組立' });
    expect(textCheck).toBeDisabled();
    expect(screen.getByRole('tab', { name: state === 'placed' ? /^配置済み/ : /^未配置/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '配置を取り消す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'この素材に差し替え' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '現在ページに配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^写真1/ }));
    fireEvent.click(screen.getByRole('button', { name: /^写真2/ }));
    const firstCheck = screen.getByRole('checkbox', { name: '写真1' });
    const secondCheck = screen.getByRole('checkbox', { name: '写真2' });
    fireEvent.click(firstCheck);
    expect(firstCheck).toBeChecked();
    fireEvent.click(secondCheck);
    expect(firstCheck).not.toBeChecked();
    expect(secondCheck).toBeChecked();
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    fireEvent.click(secondCheck);
    expect(screen.queryByRole('button', { name: 'この素材に差し替え' })).not.toBeInTheDocument();
    fireEvent.click(secondCheck);
    const button = screen.getByRole('button', { name: 'この素材に差し替え' });
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('現在は画像を差し替えできません');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(materials[2]);
    expect(secondCheck).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '写真1' })).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(materials[2]);
  });
  it('disables knowledge text and imports only the latest selected photo in replacement mode', async () => {
    mocks.knowledge.mockResolvedValue({ enabled: true, items: [
      { candidateKey: 'knowledge:text', kind: 'TEXT', title: '文章候補', preview: '文章', sourceLabel: 'Chat 投稿', alreadyImported: false },
      { candidateKey: 'knowledge:first', kind: 'PHOTO', imageId: 'first', title: '写真候補1', preview: '', sourceLabel: 'Chat 投稿', alreadyImported: false },
      { candidateKey: 'knowledge:second', kind: 'PHOTO', imageId: 'second', title: '写真候補2', preview: '', sourceLabel: 'Chat 投稿', alreadyImported: false }
    ] });
    render(<ProcedureMaterialShelfDialog mode="replace" onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    fireEvent.click(screen.getByRole('tab', { name: 'ナレッジから' }));
    expect(await screen.findByRole('checkbox', { name: '文章候補' })).toBeDisabled();
    const first = screen.getByRole('checkbox', { name: '写真候補1' });
    const second = screen.getByRole('checkbox', { name: '写真候補2' });
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).not.toBeChecked();
    expect(second).toBeChecked();
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    await waitFor(() => expect(mocks.importKnowledge).toHaveBeenCalledExactlyOnceWith(['knowledge:second']));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^未配置/ })).toHaveAttribute('aria-selected', 'true'));
  });
  it('lists, searches, selects knowledge text/photo and imports them into unplaced materials', async () => {
    const candidates = [
      { candidateKey: 'knowledge:text', kind: 'TEXT', title: 'Chat 素材', summary: '整理した要約', preview: '投稿本文', sourceLabel: 'Chat 投稿', alreadyImported: false },
      { candidateKey: 'knowledge:photo', kind: 'PHOTO', imageId: 'image-1', title: '手順写真', preview: '写真の説明', sourceLabel: '手順書: 組立', alreadyImported: false },
      { candidateKey: 'knowledge:old', kind: 'TEXT', title: '古い素材', preview: '保存済み', sourceLabel: 'Chat 投稿', alreadyImported: true },
    ];
    mocks.knowledge.mockResolvedValue({ enabled: true, items: candidates });
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([{ ...text, origin: 'KNOWLEDGE', text: '取り込んだ本文' }]);
    const onSelect = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={onSelect} />);
    await screen.findByText('見つかりません');
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    expect(await screen.findByText('投稿本文')).toBeInTheDocument();
    expect(screen.getByText('整理した要約')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '手順写真' })).toBeInTheDocument();
    expect(mocks.knowledgeThumbnail).toHaveBeenCalledWith('image-1');
    expect(screen.getByText('手順書: 組立')).toBeInTheDocument();
    expect(screen.getByText('写真の説明')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '古い素材' })).toBeDisabled();
    expect(screen.getByText(/取込済み/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚に取り込む' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('素材を探す'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.knowledge).toHaveBeenLastCalledWith({ q: 'DFD1', limit: 100 }));
    await screen.findByRole('checkbox', { name: 'Chat 素材' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chat 素材' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '手順写真' }));
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    expect(await screen.findByText('取り込んだ本文')).toBeInTheDocument();
    expect(mocks.importKnowledge).toHaveBeenCalledExactlyOnceWith(['knowledge:text', 'knowledge:photo']);
    expect(screen.getByRole('tab', { name: /^未配置/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByLabelText('素材一覧')).getByText('ナレッジ')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '現在ページに配置' })).not.toBeInTheDocument();
  });
  it('lists and searches processing photos, imports multiple selections and shows provenance in the shelf', async () => {
    const candidates = [
      { candidateKey: 'work:first', partNumber: 'DFD1', shootingTarget: '外径', step: 1, memo: '公開メモ', assetId: 'asset-1', alreadyImported: false },
      { candidateKey: 'work:second', partNumber: 'DFD1', shootingTarget: '内径', step: 2, memo: '', assetId: 'asset-2', alreadyImported: false },
      { candidateKey: 'work:old', partNumber: 'DFD2', shootingTarget: '外径', step: 3, memo: '以前の写真', assetId: 'asset-3', alreadyImported: true },
    ];
    mocks.workInstructions.mockResolvedValue({ items: candidates });
    const material = { ...photo, origin: 'WORK_INSTRUCTION', subjectHint: 'DFD1 外径 手順1', workInstructionRef: {
      rowId: 'row', sourceVersionId: 'version', step: 1, assetId: 'asset-1', partNumber: 'DFD1', shootingTarget: '外径', memo: '保存メモ' } };
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([material]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findByText('見つかりません');
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    expect(await screen.findByText('公開メモ')).toHaveClass('line-clamp-2');
    expect(await screen.findByRole('img', { name: 'DFD1 外径 手順 1' })).toBeInTheDocument();
    expect(mocks.workInstructionThumbnail).toHaveBeenCalledWith('asset-1');
    expect(mocks.knowledgeThumbnail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^DFD2/ }));
    expect(screen.getByRole('checkbox', { name: 'DFD2 外径 手順 3' })).toBeDisabled();
    expect(screen.getByText(/取込済み/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚に取り込む' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('素材を探す')).toHaveAttribute('placeholder', '品番・ヒント・本文');
    fireEvent.change(screen.getByLabelText('素材を探す'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.workInstructions).toHaveBeenLastCalledWith({ q: 'DFD1', limit: 1000 }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 外径 手順 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'DFD1 内径 手順 2' }));
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    expect(await screen.findByText('保存メモ')).toHaveClass('line-clamp-2');
    expect(mocks.importWorkInstructions).toHaveBeenCalledExactlyOnceWith([
      { candidateKey: 'work:first', partNumber: 'DFD1', shootingTarget: '外径' },
      { candidateKey: 'work:second', partNumber: 'DFD1', shootingTarget: '内径' },
    ]);
    expect(screen.getByRole('tab', { name: /^未配置/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByLabelText('素材一覧')).getByText('加工')).toBeInTheDocument();
    expect(await screen.findByText('DFD1 外径 · 手順 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配置済み' }));
    expect(await screen.findByText('保存メモ')).toBeInTheDocument();
    expect(within(screen.getByLabelText('素材一覧')).getByText('加工')).toBeInTheDocument();
  });
  it('caps processing-photo selection at 50 even when selecting imports for replacement', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.workInstructions.mockResolvedValue({ items: Array.from({ length: 51 }, (_, index) => ({
      candidateKey: `work:${index}`, partNumber: 'DFD1', shootingTarget: '外径', step: index + 1, memo: '', assetId: `asset-${index}`, alreadyImported: false,
    })) });
    render(<ProcedureMaterialShelfDialog mode="replace" onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    const checks = await screen.findAllByRole('checkbox');
    for (const check of checks.slice(0, 50)) fireEvent.click(check);
    expect(checks[50]).toBeDisabled();
    expect(checks[0]).toBeEnabled();
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('50 件を選択中');
    fireEvent.click(checks[0]);
    expect(checks[50]).toBeEnabled();
  });
  it('shows processing-photo import failures and write permission errors without switching tabs', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.workInstructions.mockResolvedValue({ items: [{ candidateKey: 'work:first', partNumber: 'DFD1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset', alreadyImported: false }] });
    mocks.importWorkInstructions.mockResolvedValueOnce({ imported: 0, duplicate: 0, failed: [{ candidateKey: 'work:first', reason: '写真がありません' }] })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 } });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '加工の写真' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 外径 手順 1' }));
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    expect(await screen.findByText('写真がありません')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '加工の写真' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mocks.workInstructions).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 外径 手順 1' }));
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
  });
  it('shows a short disabled message in the knowledge tab without image requests', async () => {
    mocks.list.mockResolvedValue([]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    expect(await screen.findByText('ナレッジ機能は無効です')).toBeInTheDocument();
    expect(mocks.knowledgeThumbnail).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '棚に取り込む' })).not.toBeInTheDocument();
  });
  it('fetches only visible knowledge photos and retains their URLs on tab switch', async () => {
    const observers: Array<{ notify: () => void }> = [];
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ notify: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) });
      }
    });
    mocks.list.mockResolvedValue([]);
    mocks.knowledge.mockResolvedValue({ enabled: true, items: ['first', 'offscreen'].map((id) => ({ candidateKey: id, kind: 'PHOTO', imageId: id, title: id, preview: '', sourceLabel: 'Chat 投稿', alreadyImported: false })) });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(mocks.knowledgeThumbnail).not.toHaveBeenCalled();
    act(() => observers[0]!.notify());
    await screen.findByRole('img', { name: 'first' });
    expect(mocks.knowledgeThumbnail).toHaveBeenCalledExactlyOnceWith('first');
    fireEvent.click(screen.getByRole('tab', { name: /^未配置/ }));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('switches 6/4/3 columns and remembers the terminal size, including unavailable storage', async () => {
    const view = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findByText(/締付手順/);
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' });
    fireEvent.click(screen.getByRole('button', { name: '小' }));
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' });
    fireEvent.click(screen.getByRole('button', { name: '大' }));
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
    view.unmount();
    const next = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '大' })).toHaveAttribute('aria-pressed', 'true');
    next.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '中' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '小' }));
    expect(screen.getByRole('button', { name: '小' })).toHaveAttribute('aria-pressed', 'true');
    vi.restoreAllMocks();
  });
  it('places multiple materials in selection order and retains only unplaced selections after a failure', async () => {
    let finishFirst: () => void = () => undefined;
    const onSelect = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; })).mockRejectedValueOnce(new Error('写真の配置に失敗')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    const checks = await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    fireEvent.click(checks[0]); fireEvent.click(checks[1]);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('2 件を選択中');
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(text);
    await act(async () => finishFirst());
    expect(await screen.findByRole('alert')).toHaveTextContent('写真の配置に失敗');
    expect(onSelect).toHaveBeenNthCalledWith(2, photo);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenNthCalledWith(3, photo);
  });
  it('fetches the original only on zoom, then closes only the lightbox on Escape', async () => {
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} />);
    const zoom = await screen.findByRole('button', { name: '手順.pngを原寸表示' });
    await waitFor(() => expect(zoom).toBeEnabled());
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.thumbnail).toHaveBeenCalledOnce();
    fireEvent.click(zoom);
    const lightbox = screen.getByRole('dialog', { name: '素材の原寸表示' });
    expect(within(lightbox).getByRole('status')).toHaveTextContent('読込中…');
    await within(lightbox).findByRole('img');
    expect(within(lightbox).getByRole('img')).toHaveAttribute('src', 'blob:photo');
    expect(within(lightbox).getByRole('img')).toHaveClass('max-w-none');
    expect(mocks.file).toHaveBeenCalledOnce();
    fireEvent.click(within(lightbox).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog', { name: '素材の原寸表示' })).not.toBeInTheDocument();
    fireEvent.click(zoom);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '素材の原寸表示' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(['material', 'knowledge', 'work'] as const)('reuses %s thumbnails across bundles, search and tabs, fetching originals only on zoom', async (source) => {
    mocks.list.mockResolvedValue([photo]);
    mocks.knowledge.mockResolvedValue({ enabled: true, items: [{ candidateKey: 'knowledge:photo', kind: 'PHOTO', imageId: 'image-1', title: 'DFD1 写真', preview: '', sourceLabel: 'Chat 投稿', alreadyImported: false }] });
    mocks.workInstructions.mockResolvedValue({ items: [{ candidateKey: 'work:photo', partNumber: 'DFD1', shootingTarget: '外径', step: 1, memo: '', assetId: 'asset-1', alreadyImported: false }] });
    const tab = source === 'material' ? /^未配置/ : source === 'knowledge' ? /^ナレッジから/ : /^加工の写真/;
    const title = source === 'material' ? '手順.png' : source === 'knowledge' ? 'DFD1 写真' : 'DFD1 外径 手順 1';
    const label = '素材を探す';
    const thumbnail = source === 'material' ? mocks.thumbnail : source === 'knowledge' ? mocks.knowledgeThumbnail : mocks.workInstructionThumbnail;
    const original = source === 'material' ? mocks.file : source === 'knowledge' ? mocks.knowledgeImage : mocks.workInstructionImage;
    const list = source === 'material' ? mocks.list : source === 'knowledge' ? mocks.knowledge : mocks.workInstructions;
    const view = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findByRole('img', { name: '手順.png' });
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    await screen.findByRole('img', { name: title });
    if (source !== 'knowledge') {
      fireEvent.click(screen.getByRole('button', { name: /^DFD1/, expanded: true }));
      expect(screen.queryByRole('img', { name: title })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^DFD1/, expanded: false }));
      await screen.findByRole('img', { name: title });
    }
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'DFD1' } });
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'DFD1' })));
    await screen.findByRole('img', { name: title });
    fireEvent.click(screen.getByRole('tab', { name: source === 'material' ? /^ナレッジから/ : /^未配置/ }));
    await waitFor(() => expect(screen.queryByRole('img', { name: title })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    await screen.findByRole('img', { name: title });
    expect(thumbnail).toHaveBeenCalledOnce(); expect(original).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `${title}を原寸表示` }));
    const lightbox = screen.getByRole('dialog', { name: '素材の原寸表示' });
    await within(lightbox).findByRole('img');
    expect(original).toHaveBeenCalledOnce();
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it.each(['material', 'knowledge', 'work'] as const)('debounces consecutive %s input and waits for IME composition', async (source) => {
    const view = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findByRole('img', { name: '手順.png' });
    if (source !== 'material') {
      fireEvent.click(screen.getByRole('tab', { name: source === 'knowledge' ? /^ナレッジから/ : '加工の写真' }));
      await screen.findByText(source === 'knowledge' ? 'ナレッジ機能は無効です' : '見つかりません');
    }
    const list = source === 'material' ? mocks.list : source === 'knowledge' ? mocks.knowledge : mocks.workInstructions;
    const input = screen.getByLabelText('素材を探す');
    list.mockClear(); vi.useFakeTimers();
    for (const value of ['D', 'DF', 'DFD1']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(list).not.toHaveBeenCalled();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(list).toHaveBeenCalledTimes(source === 'material' ? 2 : 1); expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'DFD1' }));
    list.mockClear(); fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '組' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(list).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(299); }); expect(list).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(source === 'material' ? 2 : 1); expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: '組' }));
    vi.useRealTimers(); view.unmount();
  });
  it('shows original-image failures and ignores a response after closing the lightbox', async () => {
    mocks.file.mockRejectedValueOnce(new Error('failed'));
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findByRole('img', { name: '手順.png' });
    fireEvent.click(screen.getByRole('button', { name: '手順.pngを原寸表示' }));
    const lightbox = screen.getByRole('dialog', { name: '素材の原寸表示' });
    expect(await within(lightbox).findByRole('alert')).toHaveTextContent('写真を取得できません');
    fireEvent.click(within(lightbox).getByRole('button', { name: '閉じる' }));
    let finish!: (blob: Blob) => void;
    mocks.file.mockImplementationOnce(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '手順.pngを原寸表示' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    const count = vi.mocked(URL.createObjectURL).mock.calls.length;
    await act(async () => { finish(new Blob(['original'])); });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(count);
    expect(screen.queryByRole('dialog', { name: '素材の原寸表示' })).not.toBeInTheDocument();
  });
  it('shows write permission errors near the action controls', async () => {
    mocks.ingest.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await screen.findByRole('button', { name: '今すぐ取り込む' });
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
  });
});
