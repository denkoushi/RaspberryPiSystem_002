import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import {
  PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES,
  __resetProtectedImageBlobUrlCacheForTests,
  useProtectedImageBlobUrl
} from '../../hooks/useProtectedImageBlobUrl';

import { KioskAssemblyPage } from './KioskAssemblyPage';

import type { AssemblyProcedureDocumentSummaryDto } from '../../features/assembly/types';

const { listTemplates, listDocuments, filterOptions } = vi.hoisted(() => ({
  listTemplates: vi.fn(async () => []), listDocuments: vi.fn(async () => [] as AssemblyProcedureDocumentSummaryDto[]), filterOptions: vi.fn(async () => ['候補'])
}));
vi.mock('../../api/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  listAssemblyTemplateSummaries: listTemplates,
  listAssemblyProcedureDocumentSummaries: listDocuments,
  listAssemblyLibraryFilterOptions: filterOptions
}));
vi.mock('../../features/kiosk-sop', () => ({
  KioskSopLauncher: ({ initialSheetId }: { initialSheetId: string }) => <button type="button" data-sheet={initialSheetId}>取説</button>
}));

function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>履歴を戻る</button></>;
}
function renderPage(search = '', width?: number) {
  return render(<div style={{ width }}><MemoryRouter initialEntries={[`/kiosk/assembly/library${search}`]}><KioskAssemblyPage /><LocationControls /></MemoryRouter></div>);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  cleanup();
  __resetProtectedImageBlobUrlCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KioskAssemblyPage library switch', () => {
  it('keeps exactly one visible h1 after the assembly-revision capture switches to templates', () => {
    const view = renderPage();
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'テンプレート', exact: true }));
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')).toBeVisible();
    expect(view.container.querySelector('#assembly-procedure-library-heading')).toBeNull();
    expect(screen.getByRole('button', { name: '取説' })).toHaveAttribute('data-sheet', 'assembly-revision');
    fireEvent.click(screen.getByRole('link', { name: '手順書', exact: true }));
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')).toBeVisible();
    expect(view.container.querySelector('#assembly-template-pane-heading')).toBeNull();
  });

  it.each([1280, 1366])('allows every template toolbar control to wrap at %ipx', width => {
    renderPage('?focus=templates', width);
    const search = screen.getByRole('textbox', { name: '全体検索' });
    const toolbar = search.parentElement!.parentElement!;
    expect(toolbar).toHaveClass('flex-wrap', 'min-h-14');
    expect(toolbar).not.toHaveClass('h-14');
    expect(search.parentElement).toHaveClass('min-w-[180px]', 'flex-1', 'max-w-[320px]');
    expect(search.parentElement).not.toHaveClass('shrink-0', 'w-80');
    for (const name of ['機種名', '手順パターン', 'テンプレートの手順書名']) {
      const filter = within(toolbar).getByRole('combobox', { name, exact: true });
      expect(filter).toBeVisible();
      expect(filter).toHaveClass('h-11');
      expect(filter.parentElement!.parentElement!.parentElement).toHaveClass('w-[88px]');
      expect(within(toolbar).getByRole('button', { name: `${name}の候補を表示` })).toBeVisible();
    }
    for (const name of ['有効', '無効化済みも表示', '更新中…', '解除', '取説']) {
      expect(within(toolbar).getByRole('button', { name, exact: true })).toBeVisible();
    }
    expect(within(toolbar).getByRole('link', { name: '組立へ戻る' })).toBeVisible();
  });

  it('defaults to procedures and synchronizes links, focus and browser history', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '組立', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '手順書', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('combobox', { name: '手順書名で検索' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '全体検索' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'テンプレート', exact: true }));
    expect(screen.getByTestId('location')).toHaveTextContent('/kiosk/assembly/library?focus=templates');
    expect(screen.getByRole('link', { name: 'テンプレート', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('combobox', { name: '手順書名で検索' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ファイルから登録' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '全体検索' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '履歴を戻る' }));
    await waitFor(() => expect(screen.getByRole('link', { name: '手順書', exact: true })).toHaveAttribute('aria-current', 'page'));
    expect(screen.getByRole('link', { name: '組立へ戻る' })).toHaveAttribute('href', '/kiosk/assembly');
  });

  it('opens templates directly from focus, retains modelCode and changes includeInactive with chips', async () => {
    renderPage('?focus=templates&modelCode=MODEL-A');
    expect(screen.getByRole('combobox', { name: '機種名', exact: true })).toHaveValue('MODEL-A');
    expect(screen.getByRole('button', { name: '有効', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '無効化済みも表示' }));
    expect(screen.getByRole('button', { name: '無効化済みも表示' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(listTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ includeInactive: true })));
    fireEvent.click(screen.getByRole('button', { name: '有効', exact: true }));
    await waitFor(() => expect(listTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ includeInactive: false })));
    fireEvent.click(screen.getByRole('link', { name: '手順書', exact: true }));
    expect(screen.getByTestId('location')).toHaveTextContent('?focus=procedures&modelCode=MODEL-A');
  });

  it('retains search and filter values across switches and resets template filters', async () => {
    renderPage('?focus=procedures');
    fireEvent.change(screen.getByRole('combobox', { name: '手順書名で検索' }), { target: { value: '手順書A' } });
    fireEvent.click(screen.getByRole('button', { name: '下書き', exact: true }));
    fireEvent.click(screen.getByRole('link', { name: 'テンプレート', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: '全体検索' }), { target: { value: '検索' } });
    fireEvent.change(screen.getByRole('combobox', { name: '機種名', exact: true }), { target: { value: '機種' } });
    fireEvent.change(screen.getByRole('combobox', { name: '手順パターン', exact: true }), { target: { value: '手順' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'テンプレートの手順書名', exact: true }), { target: { value: '文書' } });
    await waitFor(() => expect(listTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ q: '検索', modelCode: '機種', procedurePattern: '手順', procedureDocumentName: '文書' })));
    fireEvent.click(screen.getByRole('link', { name: '手順書', exact: true }));
    expect(screen.getByRole('combobox', { name: '手順書名で検索' })).toHaveValue('手順書A');
    expect(screen.getByRole('button', { name: '下書き', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(listDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ q: '手順書A' })));
    fireEvent.click(screen.getByRole('link', { name: 'テンプレート', exact: true }));
    expect(screen.getByRole('textbox', { name: '全体検索' })).toHaveValue('検索');
    fireEvent.click(screen.getByRole('button', { name: '解除' }));
    expect(screen.getByRole('textbox', { name: '全体検索' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '機種名', exact: true })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '手順パターン', exact: true })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'テンプレートの手順書名', exact: true })).toHaveValue('');
  });
});

describe('KioskAssemblyPage thumbnail references', () => {
  async function renderVisibleThumbnails() {
    const callbacks: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); disconnect = disconnect;
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    });
    const documents: AssemblyProcedureDocumentSummaryDto[] = Array.from({ length: PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1 }, (_, index) => ({
      id: `doc-${index}`, name: `手順書${index}`, imageRelativePath: `/image-${index}.png`,
      status: 'published', isActive: true, pages: [{ pageIndex: 0, imageRelativePath: `/image-${index}.png` }],
      manualAssignments: [], activeTemplateCount: 0, totalTemplateCount: 0, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z'
    }));
    listDocuments.mockResolvedValueOnce(documents);
    const apiGet = vi.spyOn(api, 'get').mockImplementation(async () => ({ data: new Blob(['image']) }) as never);
    let sequence = 0;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => `blob:thumbnail-${sequence++}`),
      revokeObjectURL
    });
    const view = renderPage();
    await screen.findByText('手順書0');
    act(() => callbacks.forEach(callback => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)));
    await waitFor(() => expect(screen.getAllByRole('img', { name: '1ページ目' })).toHaveLength(documents.length));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    return { view, callbacks, disconnect, revokeObjectURL, apiGet };
  }

  it('releases an offscreen image reference and keeps observing so re-entry mounts it again', async () => {
    const { view, callbacks, disconnect, revokeObjectURL, apiGet } = await renderVisibleThumbnails();
    act(() => callbacks[0]([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getAllByRole('img', { name: '1ページ目' })).toHaveLength(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-0');
    expect(disconnect).not.toHaveBeenCalled();
    act(() => callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(screen.getAllByRole('img', { name: '1ページ目' })).toHaveLength(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1));
    expect(apiGet).toHaveBeenCalledTimes(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 2);
    expect(callbacks).toHaveLength(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1);
    expect(disconnect).not.toHaveBeenCalled();
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1);
  });

  it('releases all image references when switching panes so the LRU can evict them', async () => {
    const { disconnect, revokeObjectURL } = await renderVisibleThumbnails();
    fireEvent.click(screen.getByRole('link', { name: 'テンプレート', exact: true }));
    expect(screen.queryByRole('img', { name: '1ページ目', hidden: true })).not.toBeInTheDocument();
    expect(disconnect).toHaveBeenCalledTimes(PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1);
    const next = renderHook(({ path }) => useProtectedImageBlobUrl(path), { initialProps: { path: '/next-0.png' } });
    for (let index = 0; index < PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES; index += 1) {
      if (index > 0) next.rerender({ path: `/next-${index}.png` });
      await waitFor(() => expect(next.result.current.blobUrl).toBe(`blob:thumbnail-${PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES + 1 + index}`));
    }
    for (let index = 0; index <= PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES; index += 1) {
      expect(revokeObjectURL).toHaveBeenCalledWith(`blob:thumbnail-${index}`);
    }
    next.unmount();
  });
});
