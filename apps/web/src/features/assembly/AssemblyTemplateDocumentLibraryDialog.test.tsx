import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyTemplateDocumentLibraryDialog } from './AssemblyTemplateDocumentLibraryDialog';

import type { AssemblyProcedureDocumentSummaryDto } from './types';

const documentFixture: AssemblyProcedureDocumentSummaryDto = {
  id: 'document-1',
  name: '手順書',
  imageRelativePath: '/api/document-1.png',
  status: 'published',
  publishedAt: '2026-09-03T00:00:00.000Z',
  isActive: true,
  pages: [{ pageIndex: 0, imageRelativePath: '/api/document-1-1.png' }],
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  activeTemplateCount: 0,
  totalTemplateCount: 0
};

function renderDialog(
  document = documentFixture,
  addingDocumentId: string | null = null
) {
  return render(
    <AssemblyTemplateDocumentLibraryDialog
      open
      documents={[document]}
      procedureItems={[]}
      addingDocumentId={addingDocumentId}
      search=""
      readOnly={false}
      onSearchChange={vi.fn()}
      onAdd={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe('AssemblyTemplateDocumentLibraryDialog', () => {
  it('explains that document-only additions still need an explicit step', () => {
    renderDialog();

    expect(
      screen.getByText('文書だけ追加は表示手順を作りません。未使用文書は保存前に手順化が必要です。')
    ).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('全ページを手順へ追加')).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: '文書だけ追加' })).toBeEnabled();
  });

  it('disables both add modes while another document is being added', () => {
    renderDialog(documentFixture, documentFixture.id);

    const item = screen.getByRole('listitem');
    expect(within(item).getByRole('button', { name: '追加' })).toBeDisabled();
    expect(within(item).getByRole('button', { name: '文書だけ追加' })).toBeDisabled();
  });

  it('does not offer a document with no effective page', () => {
    renderDialog({ ...documentFixture, imageRelativePath: '', pages: [] });

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('0ページ（ページ未取得）');
    expect(within(item).getByRole('button', { name: '追加' })).toBeDisabled();
    expect(within(item).getByRole('button', { name: '文書だけ追加' })).toBeDisabled();
  });
});
