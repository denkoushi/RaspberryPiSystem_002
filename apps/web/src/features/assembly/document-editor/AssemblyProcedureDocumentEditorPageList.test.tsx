import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';

vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span data-testid="page-image" /> }));
vi.mock('../AssemblyProcedureOverlayLayer', () => ({ AssemblyProcedureOverlayLayer: () => <span data-testid="page-overlays" /> }));

const pages = [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/${pageIndex}.png`, overlays: [] }));

afterEach(() => vi.unstubAllGlobals());

describe('document editor page thumbnails', () => {
  it('renders the image and overlays only after entering view and keeps them mounted', () => {
    const observers = new Map<Element, {
      notify: (isIntersecting: boolean) => void;
      disconnect: () => void;
      options?: IntersectionObserverInit;
    }>();
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn();
      constructor(private callback: IntersectionObserverCallback, private options?: IntersectionObserverInit) {}
      observe(target: Element) {
        observers.set(target, {
          notify: isIntersecting => this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
          disconnect: this.disconnect,
          options: this.options
        });
      }
    });

    render(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={0} onSelect={vi.fn()}
      onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={vi.fn()} disabled={false} />);
    const first = screen.getByRole('button', { name: '1ページ目（選択中）' });
    const box = first.firstElementChild!;
    expect(box).toHaveClass('aspect-[1/1.414]');
    const observer = observers.get(box)!;
    expect(observer.options).toEqual({ rootMargin: '300px' });
    act(() => observer.notify(false));
    expect(screen.queryByTestId('page-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-overlays')).not.toBeInTheDocument();

    act(() => observer.notify(true));
    const image = within(first).getByTestId('page-image');
    const overlays = within(first).getByTestId('page-overlays');
    expect(screen.getAllByTestId('page-image')).toHaveLength(1);
    expect(screen.getAllByTestId('page-overlays')).toHaveLength(1);
    expect(observer.disconnect).toHaveBeenCalledOnce();

    act(() => observer.notify(false));
    expect(within(first).getByTestId('page-image')).toBe(image);
    expect(within(first).getByTestId('page-overlays')).toBe(overlays);
  });
});

describe('document editor page deletion button', () => {
  it('shows one delete button beside the selected thumbnail and forwards that index', () => {
    const onDeletePage = vi.fn(); const onSelect = vi.fn();
    const view = render(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={0} onSelect={onSelect} onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={onDeletePage} onMovePage={vi.fn()} disabled={false} />);
    const button = screen.getByRole('button', { name: 'このページを削除' });
    expect(button.parentElement).toBe(screen.getByRole('button', { name: '1ページ目（選択中）' }).parentElement);
    expect(button.closest('button')).toBe(button);
    expect(screen.getAllByRole('button', { name: 'このページを削除' })).toHaveLength(1);
    fireEvent.click(button);
    expect(onDeletePage).toHaveBeenCalledWith(0);
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={1} onSelect={onSelect} onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={onDeletePage} onMovePage={vi.fn()} disabled={false} />);
    expect(screen.getByRole('button', { name: 'このページを削除' }).parentElement).toBe(screen.getByRole('button', { name: '2ページ目（選択中）' }).parentElement);
  });
  it('hides deletion with one page and disables it while editing is blocked', () => {
    const props = { selectedPageIndex: 0, onSelect: vi.fn(), onAddBlankPage: vi.fn(), onImportPages: vi.fn(), onDeletePage: vi.fn(), onMovePage: vi.fn(), disabled: false };
    const view = render(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages.slice(0, 1)} />);
    expect(screen.queryByRole('button', { name: 'このページを削除' })).not.toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages} disabled />);
    expect(screen.getByRole('button', { name: 'このページを削除' })).toBeDisabled();
  });
  it('opens page import from a matching icon button below blank page creation', () => {
    const props = { pages, selectedPageIndex: 0, onSelect: vi.fn(), onAddBlankPage: vi.fn(), onImportPages: vi.fn(), onDeletePage: vi.fn(), onMovePage: vi.fn() };
    const view = render(<AssemblyProcedureDocumentEditorPageList {...props} disabled={false} />);
    const button = screen.getByRole('button', { name: 'ほかの要領書から入れる' });
    expect(button.previousElementSibling).toBe(screen.getByRole('button', { name: '白紙ページを追加' }));
    expect(button).toHaveAttribute('title', 'ほかの要領書から入れる');
    expect(button).toHaveClass('h-12', 'w-[100px]', 'border-dashed');
    fireEvent.click(button);
    expect(props.onImportPages).toHaveBeenCalledOnce();
    view.rerender(<AssemblyProcedureDocumentEditorPageList {...props} disabled />);
    expect(button).toBeDisabled();
  });

});

describe('document editor page reorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'touch';
      }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderPages(options: { disabled?: boolean; locked?: boolean; single?: boolean } = {}) {
    const onMovePage = vi.fn(), onSelect = vi.fn(), onDeletePage = vi.fn();
    const view = render(<AssemblyProcedureDocumentEditorPageList
      pages={options.single ? pages.slice(0, 1) : pages} selectedPageIndex={0}
      onSelect={onSelect} onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={onDeletePage}
      onMovePage={onMovePage} disabled={options.disabled ?? false} locked={options.locked}
    />);
    const list = screen.getByRole('complementary', { name: '手順書ページ一覧' });
    const thumbnails = screen.getAllByRole('button', { name: /ページ目/ });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 120, 220));
    thumbnails.forEach((thumbnail, index) => {
      const rect = new DOMRect(10, index * 108, 100, 100);
      vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue(rect);
      vi.spyOn(thumbnail.parentElement!, 'getBoundingClientRect').mockReturnValue(rect);
    });
    return { ...view, list, thumbnails, onMovePage, onSelect, onDeletePage };
  }

  it.each([
    { pointerType: 'touch', from: 0, to: 1, startY: 40, endY: 190 },
    { pointerType: 'mouse', from: 1, to: 0, startY: 170, endY: 40 }
  ])('moves page $from to $to after a $pointerType long press and suppresses the release click', ({ pointerType, from, to, startY, endY }) => {
    const { container, list, thumbnails, onMovePage, onSelect } = renderPages();
    const pointer = { pointerId: 1, pointerType, button: 0, clientX: 30 };
    fireEvent.pointerDown(thumbnails[from], { ...pointer, clientY: startY });
    act(() => vi.advanceTimersByTime(449));
    expect(list.style.touchAction).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(list.style.touchAction).toBe('none');
    expect(thumbnails[from].parentElement).toHaveClass('opacity-35');
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    fireEvent(list, touchMove);
    expect(touchMove.defaultPrevented).toBe(pointerType === 'touch');
    fireEvent.pointerMove(window, { ...pointer, clientY: endY });
    expect(thumbnails[to].parentElement?.querySelector('.h-1')).toBeInTheDocument();
    expect(container.querySelector('.fixed')).not.toBeInTheDocument();
    expect(document.body.querySelector('.fixed')).toBeInTheDocument();
    fireEvent.pointerUp(window, { ...pointer, clientY: endY });
    fireEvent.click(thumbnails[from], { detail: 1 });
    expect(onMovePage).toHaveBeenCalledExactlyOnceWith(from, to);
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.style.touchAction).toBe('');
  });

  it('cancels before lift at 10 pixels and allows native scrolling', () => {
    const { list, thumbnails: [first], onMovePage } = renderPages();
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 50 });
    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    fireEvent(list, move);
    expect(move.defaultPrevented).toBe(false);
    act(() => vi.advanceTimersByTime(450));
    expect(list.style.touchAction).toBe('');
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 190 });
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 190 });
    expect(onMovePage).not.toHaveBeenCalled();
  });

  it('scrolls near an edge after lifting and cancels on pointercancel', () => {
    const { list, thumbnails: [first], onMovePage } = renderPages();
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientY: 40 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 215 });
    act(() => vi.advanceTimersByTime(64));
    expect(list.scrollTop).toBeGreaterThan(0);
    fireEvent.pointerCancel(window, { pointerId: 1, clientY: 215 });
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 215 });
    expect(onMovePage).not.toHaveBeenCalled();
    expect(list.style.touchAction).toBe('');
  });

  it.each(['disabled', 'locked', 'single', 'delete'] as const)('does not lift for %s', condition => {
    const { list, thumbnails: [first], onMovePage } = renderPages({ [condition]: true });
    const target = condition === 'delete' ? screen.getByRole('button', { name: 'このページを削除' }) : first;
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientY: 40 });
    act(() => vi.advanceTimersByTime(450));
    expect(list.style.touchAction).toBe('');
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 190 });
    expect(onMovePage).not.toHaveBeenCalled();
  });
});
