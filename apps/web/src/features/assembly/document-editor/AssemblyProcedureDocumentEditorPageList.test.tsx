import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';

vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span /> }));

const pages = [0, 1].map(pageIndex => ({ pageIndex, imageRelativePath: `/${pageIndex}.png`, overlays: [] }));

describe('document editor page deletion button', () => {
  it('shows one delete button beside the selected thumbnail and forwards that index', () => {
    const onDeletePage = vi.fn(); const onSelect = vi.fn();
    const view = render(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={0} onSelect={onSelect} onAddBlankPage={vi.fn()} onDeletePage={onDeletePage} disabled={false} />);
    const button = screen.getByRole('button', { name: 'このページを削除' });
    expect(button.parentElement).toBe(screen.getByRole('button', { name: '1ページ目（選択中）' }).parentElement);
    expect(button.closest('button')).toBe(button);
    expect(screen.getAllByRole('button', { name: 'このページを削除' })).toHaveLength(1);
    fireEvent.click(button);
    expect(onDeletePage).toHaveBeenCalledWith(0);
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<AssemblyProcedureDocumentEditorPageList pages={pages} selectedPageIndex={1} onSelect={onSelect} onAddBlankPage={vi.fn()} onDeletePage={onDeletePage} disabled={false} />);
    expect(screen.getByRole('button', { name: 'このページを削除' }).parentElement).toBe(screen.getByRole('button', { name: '2ページ目（選択中）' }).parentElement);
  });
  it('hides deletion with one page and disables it while editing is blocked', () => {
    const props = { selectedPageIndex: 0, onSelect: vi.fn(), onAddBlankPage: vi.fn(), onDeletePage: vi.fn(), disabled: false };
    const view = render(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages.slice(0, 1)} />);
    expect(screen.queryByRole('button', { name: 'このページを削除' })).not.toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorPageList {...props} pages={pages} disabled />);
    expect(screen.getByRole('button', { name: 'このページを削除' })).toBeDisabled();
  });
});
