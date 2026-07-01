import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingLibraryTemplateGrid } from '../InspectionDrawingLibraryTemplateGrid';

import type { KioskInspectionDrawingTemplateSummaryDto } from '../../types';

const template: KioskInspectionDrawingTemplateSummaryDto = {
  id: 'template-1',
  fhincd: 'ABC-123',
  resourceCd: 'R001',
  processGroup: 'cutting',
  name: '7161テーブル ABC-123',
  version: 2,
  isActive: true,
  selfInspectionMode: 'full',
  selfInspectionFixedCount: null,
  selfInspectionSampleSize: null,
  visualTemplateId: 'visual-1',
  visualTemplate: {
    id: 'visual-1',
    name: '7161テーブル',
    drawingImageRelativePath: '/api/storage/sample.jpg',
    isActive: true,
    createdAt: '2026-07-01T07:46:02.229Z',
    updatedAt: '2026-07-01T07:46:02.229Z'
  },
  siblingGroupId: 'sibling-1',
  siblingGroup: {
    id: 'sibling-1',
    displayName: '7161テーブル ABC-123',
    fhincd: 'ABC-123',
    processGroup: 'cutting',
    activeResourceCds: ['R001', 'R002', 'R003', 'R004', 'R005'],
    createdAt: '2026-07-01T07:46:02.229Z',
    updatedAt: '2026-07-01T07:46:02.229Z'
  },
  itemCount: 12
};

describe('InspectionDrawingLibraryTemplateGrid', () => {
  it('keeps resource chips on one row and summarizes metadata on one line', () => {
    render(
      <MemoryRouter>
        <InspectionDrawingLibraryTemplateGrid
          templates={[template]}
          resourceNameMap={{}}
          onHistoryClick={vi.fn()}
          lineageGroupKey={(row) => row.id}
          editPath={() => '/edit'}
          printPath={() => '/print'}
          createFromSourcePath={() => '/copy'}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('inspection-template-resource-chips')).toHaveClass('flex-nowrap');
    expect(screen.getByText('+1')).toBeInTheDocument();

    const metadata = screen.getByTestId('inspection-template-card-metadata');
    expect(metadata).toHaveTextContent(/測定点 12 · 更新 .* · 図面 7161テーブル/);
    expect(metadata).toHaveClass('truncate');
    expect(metadata).toHaveAttribute('title', expect.stringContaining('図面 7161テーブル'));
  });

  it('keeps action button size while increasing action text size', () => {
    render(
      <MemoryRouter>
        <InspectionDrawingLibraryTemplateGrid
          templates={[template]}
          resourceNameMap={{}}
          onHistoryClick={vi.fn()}
          lineageGroupKey={(row) => row.id}
          editPath={() => '/edit'}
          printPath={() => '/print'}
          createFromSourcePath={() => '/copy'}
        />
      </MemoryRouter>
    );

    for (const label of ['編集', '帳票', '雛形新規', '履歴']) {
      expect(screen.getByRole(label === '履歴' ? 'button' : 'link', { name: label })).toHaveClass('min-h-9');
      expect(screen.getByRole(label === '履歴' ? 'button' : 'link', { name: label })).toHaveClass('text-[0.9rem]');
    }
  });
});
