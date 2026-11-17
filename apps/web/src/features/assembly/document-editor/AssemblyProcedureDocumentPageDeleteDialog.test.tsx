import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentPageDeleteDialog } from './AssemblyProcedureDocumentPageDeleteDialog';

vi.mock('../KioskDocumentPageImage', () => ({ KioskDocumentPageImage: () => <span /> }));

const page = { pageIndex: 1, imageRelativePath: '/2.png', overlays: [{ id: 'draft', pageIndex: 1, kind: 'TEXT' as const, text: '未保存の文章', zIndex: 1, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 } }] };

describe('page deletion dialog', () => {
  it('shows the page with unsaved overlays, focuses cancel, and closes on cancel', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <AssemblyProcedureDocumentPageDeleteDialog page={page} disabled={false} onClose={() => setOpen(false)} onDelete={vi.fn()} /> : null;
    }
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: '2ページ目を削除' })).toBeInTheDocument();
    expect(screen.getByText('未保存の文章')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'やめる' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('invokes only the explicit delete action', () => {
    const onDelete = vi.fn();
    render(<AssemblyProcedureDocumentPageDeleteDialog page={page} disabled={false} onClose={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
