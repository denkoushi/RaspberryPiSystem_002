import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { listPartMeasurementVisualTemplates } from '../../../../api/client';
import { KioskInspectionDrawingVisualLibrarySection } from '../KioskInspectionDrawingVisualLibrarySection';

import type { PartMeasurementVisualTemplateDto } from '../../types';

vi.mock('../../../../api/client', () => ({
  getResolvedClientKey: vi.fn(() => undefined),
  listPartMeasurementVisualTemplates: vi.fn(),
  updatePartMeasurementVisualTemplateName: vi.fn()
}));

const visuals: PartMeasurementVisualTemplateDto[] = [
  {
    id: 'visual-1',
    name: '7161テーブル',
    drawingImageRelativePath: '/api/storage/sample.jpg',
    isActive: true,
    createdAt: '2026-07-01T07:46:02.229Z',
    updatedAt: '2026-07-01T07:46:02.229Z'
  }
];

describe('KioskInspectionDrawingVisualLibrarySection', () => {
  it('renders visual library rows as a compact table in preview mode', () => {
    render(
      <MemoryRouter>
        <KioskInspectionDrawingVisualLibrarySection
          previewVisuals={visuals}
          onRegisterClick={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(listPartMeasurementVisualTemplates).not.toHaveBeenCalled();
    expect(screen.getByRole('table', { name: '図面ライブラリ' })).toBeInTheDocument();
    expect(screen.getByTestId('inspection-visual-library-scroll')).toHaveClass('flex-1');
    expect(screen.getByTestId('inspection-visual-library-scroll')).toHaveClass('min-h-0');
    expect(screen.getByTestId('inspection-visual-library-scroll')).toHaveClass('overflow-auto');
    expect(screen.getByTestId('inspection-visual-name-column')).toHaveClass('w-[60%]');
    for (const header of ['図面名', '更新', '操作']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('7161テーブル')).toHaveAttribute('title', '7161テーブル');
    expect(screen.getByRole('link', { name: '新規' })).toHaveAttribute('title', '新規作成');
    expect(screen.getByRole('button', { name: '名称' })).toHaveAttribute('title', '名称変更');
    expect(screen.getByRole('button', { name: '名称' })).toBeDisabled();
  });

  it('renders resource CD chips on the secondary row when resourceCdsByVisualId is provided', () => {
    render(
      <MemoryRouter>
        <KioskInspectionDrawingVisualLibrarySection
          previewVisuals={visuals}
          onRegisterClick={vi.fn()}
          resourceCdsByVisualId={{
            'visual-1': ['R001', 'R002', 'R003', 'R004', 'R005']
          }}
          resourceNameMap={{}}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('inspection-visual-resource-chips')).toBeInTheDocument();
    expect(screen.getByText('R001')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('資源CD')).not.toBeInTheDocument();
  });

  it('does not render a resource chip row when the visual has no mapped resource CDs', () => {
    const mixedVisuals: PartMeasurementVisualTemplateDto[] = [
      ...visuals,
      {
        id: 'visual-2',
        name: '図面なし資源CD',
        drawingImageRelativePath: '/api/storage/sample2.jpg',
        isActive: true,
        createdAt: '2026-07-01T07:46:02.229Z',
        updatedAt: '2026-07-01T07:46:02.229Z'
      }
    ];

    render(
      <MemoryRouter>
        <KioskInspectionDrawingVisualLibrarySection
          previewVisuals={mixedVisuals}
          onRegisterClick={vi.fn()}
          resourceCdsByVisualId={{
            'visual-1': ['R001']
          }}
          resourceNameMap={{}}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByTestId('inspection-visual-resource-chips')).toHaveLength(1);
    expect(screen.getByText('図面なし資源CD')).toBeInTheDocument();
    expect(screen.queryByText('R002')).not.toBeInTheDocument();
  });
});
