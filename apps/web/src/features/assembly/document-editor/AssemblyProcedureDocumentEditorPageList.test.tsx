import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';

vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span /> }));

const pages = [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/${pageIndex}.png`, overlays: [] }));

describe('document editor page deletion button', () => {
  it('shows one delete button beside the selected thumbnail and forwards that index', () => {
    const onDeletePage = vi.fn(); const onSelect = vi.fn();
    const view = render(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={0} onSelect={onSelect} onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={onDeletePage} disabled={false} />);
    const button = screen.getByRole('button', { name: 'このページを削除' });
    expect(button.parentElement).toBe(screen.getByRole('button', { name: '1ページ目（選択中）' }).parentElement);
    expect(button.closest('button')).toBe(button);
    expect(screen.getAllByRole('button', { name: 'このページを削除' })).toHaveLength(1);
    fireEvent.click(button);
    expect(onDeletePage).toHaveBeenCalledWith(0);
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={1} onSelect={onSelect} onAddBlankPage={vi.fn()} onImportPages={vi.fn()} onDeletePage={onDeletePage} disabled={false} />);
    expect(screen.getByRole('button', { name: 'このページを削除' }).parentElement).toBe(screen.getByRole('button', { name: '2ページ目（選択中）' }).parentElement);
  });
  it('hides deletion with one page and disables it while editing is blocked', () => {
    const props = { selectedPageIndex: 0, onSelect: vi.fn(), onAddBlankPage: vi.fn(), onImportPages: vi.fn(), onDeletePage: vi.fn(), disabled: false };
    const view = render(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages.slice(0, 1)} />);
    expect(screen.queryByRole('button', { name: 'このページを削除' })).not.toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages} disabled />);
    expect(screen.getByRole('button', { name: 'このページを削除' })).toBeDisabled();
  });
  it('opens page import from a matching icon button below blank page creation', () => {
    const props = { pages, selectedPageIndex: 0, onSelect: vi.fn(), onAddBlankPage: vi.fn(), onImportPages: vi.fn(), onDeletePage: vi.fn() };
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
