import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureLibrarySection } from './AssemblyProcedureLibrarySection';
import { AssemblyTemplateLibraryTable } from './AssemblyTemplateLibraryTable';

import type { AssemblyProcedureDocumentSummaryDto } from './types';

const { imageHook, listDocuments, deleteDocument, unpublishDocument } = vi.hoisted(() => ({
  imageHook: vi.fn(() => ({ blobUrl: 'blob:thumbnail' })),
  listDocuments: vi.fn(), deleteDocument: vi.fn(), unpublishDocument: vi.fn()
}));
vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({ useProtectedImageBlobUrl: imageHook }));
vi.mock('../../api/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  listAssemblyProcedureDocumentSummaries: listDocuments,
  listAssemblyLibraryFilterOptions: vi.fn(async () => []),
  deleteAssemblyProcedureDocument: deleteDocument,
  unpublishAssemblyProcedureDocument: unpublishDocument
}));

const document = {
  id: 'doc-1', name: '非常に長い組立手順書名でも操作欄に押しつぶされず確認できる手順書',
  imageRelativePath: '/image.png', status: 'published' as const, publishedAt: '2026-07-14T00:00:00.000Z',
  isActive: true, revisionNumber: 2, pages: [{ pageIndex: 0, imageRelativePath: '/image.png' }],
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T01:00:00.000Z',
  manualAssignments: [], activeTemplateCount: 1, totalTemplateCount: 1
};
const template = {
  id: 'template-1', modelCode: 'FH-VERY-LONG-MODEL-CODE-20A', procedurePattern: '手順7', name: '長い組立テンプレート名',
  version: 3, isActive: true, procedureDocumentId: document.id, procedureDocumentName: document.name,
  areaCount: 4, boltCount: 12, createdAt: document.createdAt, updatedAt: document.updatedAt
};

function renderProcedures(documents: AssemblyProcedureDocumentSummaryDto[] = [document]) {
  return render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} previewDocuments={documents} /></MemoryRouter>);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); imageHook.mockClear(); });

describe('assembly dense library', () => {
  it('uses one 56px procedure row with accessible headers and symbol actions', () => {
    renderProcedures();
    const table = screen.getByRole('table', { name: '手順書ライブラリ' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['サムネイル', '名前', '状態', '使用先', '頁', 'テンプレ', '更新', '操作']);
    expect(table.querySelector('thead')).toHaveClass('sr-only');
    expect(within(table).getByText(document.name).closest('tr')).toHaveClass('h-14');
    expect(within(table).getByText('公開 第2版')).toBeInTheDocument();
    for (const label of ['内容確認', '改版編集', 'テンプレート新規作成', '公開取消', '名前変更', '削除']) {
      const action = within(table).getByLabelText(label);
      expect(action).not.toHaveAttribute('title');
      fireEvent.pointerEnter(action.parentElement!);
      expect(screen.getByRole('tooltip')).toHaveTextContent(label === '削除' ? 'テンプレートで使用中のため削除できません' : label);
      fireEvent.pointerLeave(action.parentElement!);
      expect(action).toHaveClass('h-11', 'w-11');
      expect(action.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(action).toHaveTextContent('');
    }
  });

  it('filters published, draft and all and keeps draft actions unavailable', () => {
    renderProcedures([document, { ...document, id: 'draft', name: '下書き手順', status: 'draft', publishedAt: null }, { ...document, id: 'inactive', name: '無効手順', isActive: false }]);
    fireEvent.click(screen.getByRole('button', { name: '下書き' }));
    expect(screen.getByRole('button', { name: '下書き' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(document.name)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '内容確認・公開' })).not.toHaveAttribute('title');
    expect(screen.getByRole('link', { name: '編集' })).not.toHaveAttribute('title');
    expect(screen.getByRole('link', { name: 'テンプレート新規作成' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: '公開取消' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '公開' }));
    expect(screen.getByText(document.name)).toBeInTheDocument();
    expect(screen.queryByText('下書き手順')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全て' }));
    expect(screen.getByText('無効')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '手順書名で検索' }), { target: { value: '下書き手順' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('keeps delete reference guards and confirmation before unpublish/delete', async () => {
    listDocuments.mockResolvedValueOnce([document, { ...document, id: 'unused', name: '未参照手順', totalTemplateCount: 0, manualAssignments: [], activeTemplateCount: 0 }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} /></MemoryRouter>);
    const usedRow = (await screen.findByText(document.name)).closest('tr')!;
    const unusedRow = screen.getByText('未参照手順').closest('tr')!;
    expect(within(usedRow).getByRole('button', { name: '削除' })).toBeDisabled();
    expect(within(unusedRow).getByRole('button', { name: '削除' })).toBeEnabled();
    fireEvent.click(within(unusedRow).getByRole('button', { name: '削除' }));
    fireEvent.click(within(usedRow).getByRole('button', { name: '公開取消' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(unpublishDocument).not.toHaveBeenCalled();
  });

  it('shows assignment chips, filters unused documents with a count, and reports filter changes', () => {
    const onStatusFilterChange = vi.fn();
    render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} onStatusFilterChange={onStatusFilterChange} previewDocuments={[
      { ...document, manualAssignments: [
        { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立' },
        { modelCode: 'DFD2', modelCodeKey: 'DFD2', processId: 'inspection', processName: '検査' }
      ] },
      { ...document, id: 'unused', name: '未参照手順' }
    ]} /></MemoryRouter>);
    expect(screen.getByText(/DFD1/).parentElement).toHaveTextContent('DFD1 · 組立');
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('未使用', { selector: 'span' })).toHaveClass('border-dashed', 'border-amber-400');
    fireEvent.click(screen.getByRole('button', { name: '未使用 1' }));
    expect(onStatusFilterChange).toHaveBeenCalledWith('unused');
    expect(screen.queryByText(document.name)).not.toBeInTheDocument();
    expect(screen.getByText('未参照手順')).toBeInTheDocument();
  });

  it('disables deletion for manual assignments even without template references', async () => {
    listDocuments.mockResolvedValueOnce([{ ...document, totalTemplateCount: 0, manualAssignments: [
      { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立' }
    ] }]);
    render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} /></MemoryRouter>);
    const row = (await screen.findByText(document.name)).closest('tr')!;
    const button = within(row).getByRole('button', { name: '削除' });
    expect(button).toBeDisabled(); expect(button).not.toHaveAttribute('title');
    fireEvent.pointerEnter(button.parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('使用中は削除できません');
    fireEvent.click(button);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('restores the unused filter through initialStatusFilter', () => {
    render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} initialStatusFilter="unused" previewDocuments={[
      document, { ...document, id: 'used', name: '使用中', manualAssignments: [{ modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立' }] }
    ]} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '未使用 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('使用中')).not.toBeInTheDocument();
  });

  it('renders one template table with symbol labels, history/retire handlers and inactive guards', () => {
    const history = vi.fn(), retire = vi.fn();
    render(<MemoryRouter><AssemblyTemplateLibraryTable templates={[template, { ...template, id: 'inactive', isActive: false }]} onHistoryClick={history} lineageGroupKey={row => row.modelCode} onRetireClick={retire} /></MemoryRouter>);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['機種', '手順', '手順書', '版', '有効', '更新', '操作']);
    expect(table.querySelector('thead')).toHaveClass('sr-only');
    const rows = table.querySelectorAll('tbody tr');
    for (const label of ['改版', '複製して新規', '履歴', '無効']) {
      const action = within(rows[0] as HTMLElement).getByLabelText(label);
      expect(action).toHaveAttribute('title', label);
      expect(action.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: '履歴' }));
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: '無効' }));
    expect(history).toHaveBeenCalledWith(template.modelCode);
    expect(retire).toHaveBeenCalledWith(template);
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: '無効' })).toBeDisabled();
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: '表示' })).toHaveAttribute('title', '表示');
  });

  it('places Gmail import after file register and exposes busy state', () => {
    const onImportClick = vi.fn();
    const view = render(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} onImportClick={onImportClick} previewDocuments={[document]} /></MemoryRouter>);
    const register = screen.getByRole('button', { name: 'ファイルから登録' });
    const importButton = screen.getByRole('button', { name: 'Gmailから取り込む' });
    expect(register.nextElementSibling).toBe(importButton);
    expect(importButton).toHaveTextContent('Gmail から取込');
    fireEvent.click(importButton);
    expect(onImportClick).toHaveBeenCalledTimes(1);
    view.rerender(<MemoryRouter><AssemblyProcedureLibrarySection onRegisterClick={vi.fn()} onImportClick={onImportClick} importing importMessage="Gmail取込: 新規1件" previewDocuments={[document]} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '取込中…' })).toBeDisabled();
    expect(screen.getByText('Gmail取込: 新規1件')).toBeInTheDocument();
  });

  it('does not offer legacy unpublish for immutable revision heads', () => {
    renderProcedures([{ ...document, id: 'published-revision', revisionRootId: 'revision-root-1' }]);
    expect(screen.queryByRole('button', { name: '公開取消' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '改版編集' })).toHaveAttribute('href', '/kiosk/assembly/procedure-documents/published-revision/edit');
  });

  it('requests thumbnails only near the viewport and disconnects on unmount', async () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const options: (IntersectionObserverInit | undefined)[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); disconnect = disconnect;
      constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) { callbacks.push(callback); options.push(init); }
    });
    const view = renderProcedures([document, { ...document, id: 'offscreen', imageRelativePath: '', pages: [{ pageIndex: 0, imageRelativePath: '/second.png' }] }]);
    expect(imageHook).not.toHaveBeenCalled();
    expect(options).toEqual([{ rootMargin: '200px' }, { rootMargin: '200px' }]);
    act(() => callbacks[0]([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(imageHook).not.toHaveBeenCalled();
    act(() => callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(imageHook).toHaveBeenCalledWith('/image.png'));
    expect(imageHook).not.toHaveBeenCalledWith('/second.png');
    expect(screen.getByRole('img', { name: '1ページ目' })).toHaveClass('h-full', 'w-full');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('requests existing first pages immediately without IntersectionObserver and skips missing images', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderProcedures([document, { ...document, id: 'no-image', imageRelativePath: '', pages: [] }]);
    expect(imageHook).toHaveBeenCalledWith('/image.png');
    expect(screen.getAllByRole('img', { name: '1ページ目' })).toHaveLength(1);
  });
});
