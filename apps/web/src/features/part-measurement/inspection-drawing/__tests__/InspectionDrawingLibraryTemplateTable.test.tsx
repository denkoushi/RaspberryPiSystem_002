import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingLibraryTemplateTable } from '../InspectionDrawingLibraryTemplateTable';

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

describe('InspectionDrawingLibraryTemplateTable', () => {
  it('renders compact table columns and keeps resource chips on one row', () => {
    render(
      <MemoryRouter>
        <InspectionDrawingLibraryTemplateTable
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

    expect(screen.getByRole('table', { name: '検査図面テンプレート' })).toBeInTheDocument();
    for (const header of ['品番', '図面名', '資源CD', '工程', '点', '更新', '操作']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('ABC-123')).toBeInTheDocument();
    expect(screen.getByText('7161テーブル')).toHaveAttribute('title', '7161テーブル');
    expect(screen.getByText('12')).toBeInTheDocument();

    expect(screen.getByTestId('inspection-template-resource-chips')).toHaveClass('flex-nowrap');
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('uses shortened action labels with compact button classes', () => {
    render(
      <MemoryRouter>
        <InspectionDrawingLibraryTemplateTable
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

    for (const label of ['編集', '帳票', '雛形', '履歴']) {
      const action = screen.getByRole(label === '履歴' ? 'button' : 'link', { name: label });
      expect(action).toHaveClass('min-h-6');
      expect(action).toHaveClass('text-[0.68rem]');
    }
    expect(screen.getByRole('link', { name: '雛形' })).toHaveAttribute('title', '雛形新規');
  });

  it('renders loading empty state', () => {
    render(
      <InspectionDrawingLibraryTemplateTable
        templates={[]}
        resourceNameMap={{}}
        busy
        onHistoryClick={vi.fn()}
        lineageGroupKey={(row) => row.id}
      />
    );

    expect(screen.getByText('読込中…')).toBeInTheDocument();
  });
});
