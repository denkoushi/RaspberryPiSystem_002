import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureLibrarySection } from './AssemblyProcedureLibrarySection';
import { AssemblyTemplateLibraryTable } from './AssemblyTemplateLibraryTable';

const document = {
  id: 'doc-1',
  name: '非常に長い組立手順書名でも操作欄に押しつぶされず確認できる手順書',
  imageRelativePath: '/image.png',
  status: 'published' as const,
  publishedAt: '2026-07-14T00:00:00.000Z',
  isActive: true,
  pages: [{ pageIndex: 0, imageRelativePath: '/image.png' }],
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T01:00:00.000Z',
  activeTemplateCount: 1,
  totalTemplateCount: 1
};

describe('assembly library two-row layout', () => {
  it('places procedure metadata on row one and the name/actions on row two without wrapping actions', () => {
    render(
      <MemoryRouter>
        <AssemblyProcedureLibrarySection
          onRegisterClick={vi.fn()}
          previewDocuments={[document]}
        />
      </MemoryRouter>
    );
    const table = screen.getByRole('table', { name: '手順書ライブラリ' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText(document.name)).toBeInTheDocument();
    const newButton = within(table).getByRole('link', { name: '新規' });
    expect(newButton.parentElement).toHaveClass('flex-nowrap');
    expect(screen.getByRole('combobox', { name: '手順書名で検索' })).toBeInTheDocument();
  });

  it('keeps model/procedure/document on row one and moves counts/update/actions to row two', () => {
    render(
      <MemoryRouter>
        <AssemblyTemplateLibraryTable
          templates={[{
            id: 'template-1',
            modelCode: 'FH-VERY-LONG-MODEL-CODE-20A',
            procedurePattern: '手順7',
            name: '長い組立テンプレート名',
            version: 3,
            isActive: true,
            procedureDocumentId: document.id,
            procedureDocumentName: document.name,
            areaCount: 4,
            boltCount: 12,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt
          }]}
          onHistoryClick={vi.fn()}
          lineageGroupKey={(template) => template.modelCode}
          onRetireClick={vi.fn()}
        />
      </MemoryRouter>
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('columnheader', { name: '型番' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: '工程' })).not.toBeInTheDocument();
    expect(within(table).getByText('工程 4')).toBeInTheDocument();
    expect(within(table).getByText('締付 12')).toBeInTheDocument();
  });
});
