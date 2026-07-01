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
    for (const header of ['図面名', '更新', '操作']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('7161テーブル')).toHaveAttribute('title', '7161テーブル');
    expect(screen.getByRole('link', { name: '新規' })).toHaveAttribute('title', '新規作成');
    expect(screen.getByRole('button', { name: '名称' })).toHaveAttribute('title', '名称変更');
    expect(screen.getByRole('button', { name: '名称' })).toBeDisabled();
  });
});
