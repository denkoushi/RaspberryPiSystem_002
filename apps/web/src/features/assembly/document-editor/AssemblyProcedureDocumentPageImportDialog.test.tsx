import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentPageImportDialog } from './AssemblyProcedureDocumentPageImportDialog';

import type { AssemblyProcedureDocumentSummaryDto, ProcedureManualUsageDto } from '../types';

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
const renderImage = vi.hoisted(() => vi.fn<(pageUrl: string) => void>());
vi.mock('../../../api/client', () => ({ listAssemblyProcedureDocumentSummaries: api.list, getAssemblyProcedureDocument: api.get }));
vi.mock('../KioskDocumentPageImage', () => ({
  KioskDocumentPageImage: ({ pageUrl }: { pageUrl: string }) => {
    renderImage(pageUrl);
    return <span data-testid="image" data-url={pageUrl} />;
  }
}));

const myUsage = { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立' };
const otherUsage = { modelCode: 'DFD2', modelCodeKey: 'DFD2', processId: 'cut', processName: '切断' };
function makeDocument(id: string, name: string, manualAssignments: ProcedureManualUsageDto[], status: 'published' | 'draft' = 'draft'): AssemblyProcedureDocumentSummaryDto {
  return {
    id, name, manualAssignments, status, isActive: true, publishedAt: null,
    imageRelativePath: `/${id}-0.png`,
    updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    pages: [0, 1, 2].map(pageIndex => ({ pageIndex, imageRelativePath: `/${id}-${pageIndex}.png` })),
    assets: {},
    activeTemplateCount: 0, totalTemplateCount: 0
  };
}

const destination = makeDocument('current', '編集先', [myUsage]);
const source = makeDocument('source', '同じ機種の公開版', [myUsage], 'published');
const other = makeDocument('other', '別機種の下書き', [otherUsage]);
const context = { ...myUsage, processName: '加工 › 組立工程', mode: 'fix' as const };

function renderDialog(onClose = vi.fn()) {
  const onImport = vi.fn(async () => {});
  render(<AssemblyProcedureDocumentPageImportDialog document={destination} pages={destination.pages}
    selectedPageIndex={1} context={context} disabled={false} busy={false} error={null} onClose={onClose} onImport={onImport} />);
  return onImport;
}

describe('page import picker', () => {
  beforeEach(() => {
    renderImage.mockClear();
    api.list.mockResolvedValue([destination, source, other]);
    api.get.mockResolvedValue(source);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defers source, destination and insertion thumbnails while showing zoom immediately', async () => {
    const notifyByBox = new Map<Element, () => void>();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        notifyByBox.set(target, () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      disconnect() {}
    });

    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /同じ機種の公開版/ }));
    const firstSource = await screen.findByRole('button', { name: '1ページ目' });
    const destinationPages = within(screen.getByRole('region', { name: '差し込み先のページ' }));
    const firstDestination = destinationPages.getByRole('button', { name: '1ページ目を拡大' });
    fireEvent.click(firstSource);
    const position = screen.getByRole('button', { name: '2ページ目の後ろに入れる' });
    expect(screen.queryByTestId('image')).not.toBeInTheDocument();

    fireEvent.click(firstDestination);
    const viewer = screen.getByRole('dialog', { name: '1ページ目' });
    expect(within(viewer).getByTestId('image')).toHaveAttribute('data-url', '/current-0.png');
    fireEvent.click(within(viewer).getByRole('button', { name: '閉じる' }));

    for (const [button, url] of [
      [firstSource, '/source-0.png'],
      [firstDestination, '/current-0.png'],
      [position, '/source-0.png']
    ] as const) {
      const box = [...notifyByBox.keys()].find(target => button.contains(target))!;
      act(() => notifyByBox.get(box)!());
      expect(within(button).getByTestId('image')).toHaveAttribute('data-url', url);
    }
    expect(screen.getAllByTestId('image')).toHaveLength(3);
  });

  it('does not rerender existing thumbnails when choosing pages, moving the position or filtering', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /同じ機種の公開版/ }));
    const first = await screen.findByRole('button', { name: '1ページ目' });
    expect(screen.getAllByTestId('image')).toHaveLength(6);

    renderImage.mockClear();
    fireEvent.click(first);
    expect(renderImage.mock.calls).toEqual([['/source-0.png']]);

    renderImage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'すべて選ぶ' }));
    expect(renderImage.mock.calls).toEqual([['/source-1.png'], ['/source-2.png']]);

    renderImage.mockClear();
    const position = screen.getByRole('button', { name: '先頭に入れる' });
    fireEvent.click(position);
    expect(renderImage.mock.calls).toEqual([['/source-0.png'], ['/source-1.png'], ['/source-2.png']]);
    expect(within(position).getAllByTestId('image')).toHaveLength(3);

    renderImage.mockClear();
    fireEvent.change(screen.getByRole('searchbox', { name: '名前で絞り込み' }), { target: { value: '公' } });
    expect(renderImage).not.toHaveBeenCalled();
  });

  it('starts with the editor filters and supports independently clearing them and filtering by name', async () => {
    renderDialog();
    expect(await screen.findByRole('button', { name: /同じ機種の公開版/ })).toHaveTextContent('DFD1 › 組立 · 3ページ');
    expect(screen.queryByRole('button', { name: /編集先|別機種の下書き/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '機種の絞り込みを外す' }));
    expect(screen.queryByRole('button', { name: /別機種の下書き/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工程の絞り込みを外す' }));
    const otherRow = screen.getByRole('button', { name: /別機種の下書き/ });
    fireEvent.change(screen.getByRole('searchbox', { name: '名前で絞り込み' }), { target: { value: ' 下書き ' } });
    expect(screen.queryByRole('button', { name: /同じ機種の公開版/ })).not.toBeInTheDocument();
    expect(otherRow).toBeInTheDocument();
    expect(otherRow.querySelector('mark')).toHaveTextContent('下書き');
  });

  it('appends digits to the search field and finds matches in any model assignment', async () => {
    api.list.mockResolvedValue([destination, source, { ...other, manualAssignments: [myUsage, otherUsage] }]);
    renderDialog();
    await screen.findByRole('button', { name: /同じ機種の公開版/ });
    const search = screen.getByRole('searchbox', { name: '名前で絞り込み' });
    const tenkey = within(screen.getByRole('group', { name: '数字テンキー' }));
    fireEvent.change(search, { target: { value: 'ｄｆｄ' } });
    fireEvent.click(tenkey.getByRole('button', { name: '2' }));
    expect(search).toHaveValue('ｄｆｄ2');
    expect(screen.queryByRole('button', { name: /同じ機種の公開版/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /別機種の下書き/ }).querySelector('mark')).toHaveTextContent('DFD2');
    fireEvent.click(tenkey.getByRole('button', { name: '1文字消す' }));
    expect(search).toHaveValue('ｄｆｄ');
    expect(screen.getByRole('button', { name: /同じ機種の公開版/ })).toBeInTheDocument();
  });

  it('numbers pages in click order and defaults to the position after the selected destination page', async () => {
    const onImport = renderDialog();
    expect(screen.getByRole('button', { name: '0ページを入れる' })).toBeDisabled();
    const initialPosition = screen.getByRole('button', { name: '2ページ目の後ろに入れる' });
    expect(initialPosition).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByRole('button', { name: /同じ機種の公開版/ }));
    const third = await screen.findByRole('button', { name: '3ページ目' });
    const first = screen.getByRole('button', { name: '1ページ目' });
    fireEvent.click(third);
    fireEvent.click(first);
    expect(third).toHaveTextContent('1');
    expect(first).toHaveTextContent('2');
    expect(within(initialPosition).getAllByTestId('image').map(image => image.getAttribute('data-url'))).toEqual(['/source-2.png', '/source-0.png']);
    fireEvent.click(screen.getByRole('button', { name: '2ページを入れる' }));
    expect(onImport).toHaveBeenLastCalledWith('source', [2, 0], 1);

    fireEvent.click(third);
    fireEvent.click(third);
    fireEvent.click(screen.getByRole('button', { name: 'すべて選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '先頭に入れる' }));
    fireEvent.click(screen.getByRole('button', { name: '3ページを入れる' }));
    expect(onImport).toHaveBeenLastCalledWith('source', [0, 2, 1], -1);
    fireEvent.click(screen.getByRole('button', { name: '選択を外す' }));
    expect(screen.getByRole('button', { name: '0ページを入れる' })).toBeDisabled();
  });

  it('zooms source pages independently of selection and closes only the viewer', async () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.click(await screen.findByRole('button', { name: /同じ機種の公開版/ }));
    const sourcePages = within(screen.getByRole('region', { name: 'コピー元のページ' }));
    const zoomButton = await sourcePages.findByRole('button', { name: '1ページ目を拡大' });
    const firstPage = sourcePages.getByRole('button', { name: '1ページ目' });
    fireEvent.click(zoomButton);

    const viewer = screen.getByRole('dialog', { name: '1ページ目' });
    expect(firstPage).toHaveAttribute('aria-pressed', 'false');
    expect(within(viewer).getByRole('button', { name: '前のページ' })).toBeDisabled();
    expect(within(viewer).getByText('1 / 3')).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: '選ぶ' }));
    expect(within(viewer).getByRole('button', { name: '選択を外す' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(viewer).getByText('1')).toBeInTheDocument();
    expect(firstPage).toHaveTextContent('1');

    fireEvent.click(within(viewer).getByRole('button', { name: '次のページ' }));
    const next = screen.getByRole('dialog', { name: '2ページ目' });
    expect(within(next).getByTestId('image')).toHaveAttribute('data-url', '/source-1.png');
    fireEvent.click(within(next).getByRole('button', { name: '閉じる' }));
    expect(next).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1ページを入れる' })).toBeEnabled();

    fireEvent.click(zoomButton);
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '1ページ目' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'ほかの要領書から入れる' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('zooms destination pages for viewing and navigates with the arrow keys', async () => {
    renderDialog();
    await screen.findByRole('button', { name: /同じ機種の公開版/ });
    const destinationPages = within(screen.getByRole('region', { name: '差し込み先のページ' }));
    fireEvent.click(destinationPages.getByRole('button', { name: '2ページ目を拡大' }));
    const viewer = within(screen.getByRole('dialog', { name: '2ページ目' }));
    expect(viewer.getByTestId('image')).toHaveAttribute('data-url', '/current-1.png');
    expect(viewer.queryByRole('button', { name: '選ぶ' })).not.toBeInTheDocument();
    expect(viewer.queryByRole('button', { name: '選択を外す' })).not.toBeInTheDocument();
    fireEvent.keyDown(viewer.getByRole('button', { name: '閉じる' }), { key: 'ArrowRight' });
    const last = within(screen.getByRole('dialog', { name: '3ページ目' }));
    expect(last.getByRole('button', { name: '次のページ' })).toBeDisabled();
    fireEvent.keyDown(last.getByRole('button', { name: '閉じる' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: '2ページ目' })).toBeInTheDocument();
  });
});
