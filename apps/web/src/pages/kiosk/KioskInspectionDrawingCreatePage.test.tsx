import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInspectionDrawingCreatePage } from './KioskInspectionDrawingCreatePage';

import type { InspectionDrawingVisualLinkedFhincdResult } from '../../features/part-measurement/types';

const mockGetVisualTemplate = vi.fn();
const mockResolveVisualLinkedFhincd = vi.fn();
const mockListMeasurementLabelSettings = vi.fn();
const mockUseResources = vi.fn();
const mockUseDrawingBlobUrl = vi.fn();
const mockSelectLocalPreviewFile = vi.fn();
const mockResetLocalPreview = vi.fn();

vi.mock('../../api/client', () => ({
  addKioskInspectionDrawingTemplateGroupResources: vi.fn(),
  activatePartMeasurementTemplate: vi.fn(),
  createKioskInspectionDrawingTemplateGroup: vi.fn(),
  createPartMeasurementTemplate: vi.fn(),
  createPartMeasurementVisualTemplate: vi.fn(),
  deleteUnusedPartMeasurementVisualTemplate: vi.fn(),
  existsActivePartMeasurementTemplate: vi.fn().mockResolvedValue(false),
  getKioskInspectionDrawingTemplate: vi.fn(),
  getPartMeasurementVisualTemplate: (...args: unknown[]) => mockGetVisualTemplate(...args),
  getPartMeasurementVisualTemplateOcrStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
  getResolvedClientKey: vi.fn(() => 'test-client-key'),
  listInspectionDrawingMeasurementLabelSettings: (...args: unknown[]) =>
    mockListMeasurementLabelSettings(...args),
  listPartMeasurementDrawingOcrCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
  listPartMeasurementVisualTemplates: vi.fn().mockResolvedValue([]),
  reviseKioskInspectionDrawingTemplate: vi.fn(),
  reviseKioskInspectionDrawingTemplateGroup: vi.fn(),
  resolveInspectionDrawingVisualLinkedFhincd: (...args: unknown[]) =>
    mockResolveVisualLinkedFhincd(...args)
}));

vi.mock('../../api/hooks', () => ({
  useKioskProductionScheduleResources: (...args: unknown[]) => mockUseResources(...args)
}));

vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', () => ({
  usePartMeasurementDrawingBlobUrl: (...args: unknown[]) => mockUseDrawingBlobUrl(...args)
}));

vi.mock('../../features/part-measurement/usePartMeasurementDrawingLocalPreview', () => ({
  usePartMeasurementDrawingLocalPreview: () => ({
    localPreviewUrl: null,
    saveFile: null,
    previewResolving: false,
    previewError: null,
    pendingPreviewFile: null,
    hasLocalRenderablePreview: false,
    hasPendingLocalSelection: false,
    selectFile: mockSelectLocalPreviewFile,
    reset: mockResetLocalPreview
  })
}));

vi.mock('../../features/part-measurement/inspection-drawing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/part-measurement/inspection-drawing')>();
  return {
    ...actual,
    InspectionDrawingCanvas: () => <div data-testid="inspection-drawing-canvas" />,
    InspectionDrawingCanvasZoomControls: () => <div data-testid="inspection-drawing-zoom" />
  };
});

const visualTemplate = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '7161テーブル',
  drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
  isActive: true,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z'
};

function renderCreatePage() {
  render(
    <MemoryRouter initialEntries={[`/kiosk/part-measurement/inspection/create?visualTemplateId=${visualTemplate.id}`]}>
      <Routes>
        <Route
          path="/kiosk/part-measurement/inspection/create"
          element={<KioskInspectionDrawingCreatePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskInspectionDrawingCreatePage visual-linked fhincd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVisualTemplate.mockResolvedValue(visualTemplate);
    mockResolveVisualLinkedFhincd.mockResolvedValue({ kind: 'unique', fhincd: 'MD0004167150' });
    mockListMeasurementLabelSettings.mockResolvedValue([]);
    mockUseResources.mockReturnValue({
      data: { resources: ['033'], resourceNameMap: {} }
    });
    mockUseDrawingBlobUrl.mockReturnValue({ blobUrl: 'blob:sample', error: null });
  });

  it('fills fhincd and template name from a unique visual-linked fhincd', async () => {
    renderCreatePage();

    await waitFor(() => {
      expect(screen.getByLabelText('品番')).toHaveValue('MD0004167150');
    });
    expect(screen.getByLabelText('テンプレ')).toHaveValue('7161テーブル MD0004167150');
    expect(mockResolveVisualLinkedFhincd).toHaveBeenCalledWith(
      visualTemplate.id,
      'test-client-key'
    );
  });

  it('does not autofill fhincd when the visual is linked to multiple fhincds', async () => {
    mockResolveVisualLinkedFhincd.mockResolvedValue({
      kind: 'multiple',
      fhincds: ['MD0004167150', 'MD9999999999']
    });

    renderCreatePage();

    await waitFor(() => {
      expect(screen.getByText(/複数の品番が紐付いています/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('品番')).toHaveValue('');
    expect(screen.getByLabelText('テンプレ')).toHaveValue('7161テーブル');
  });

  it('keeps a manually entered fhincd when a delayed autofill result arrives', async () => {
    let resolveLinkedFhincd: (result: InspectionDrawingVisualLinkedFhincdResult) => void = () => undefined;
    mockResolveVisualLinkedFhincd.mockReturnValue(
      new Promise<InspectionDrawingVisualLinkedFhincdResult>((resolve) => {
        resolveLinkedFhincd = resolve;
      })
    );

    renderCreatePage();

    await waitFor(() => {
      expect(mockResolveVisualLinkedFhincd).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('品番'), { target: { value: 'MANUAL-001' } });
    resolveLinkedFhincd({ kind: 'unique', fhincd: 'AUTO-001' });

    await waitFor(() => {
      expect(screen.getByLabelText('品番')).toHaveValue('MANUAL-001');
    });
    expect(screen.getByLabelText('テンプレ')).toHaveValue('7161テーブル MANUAL-001');
  });

  it('falls back to fhincd embedded in the visual name when linked fhincd is none', async () => {
    const visualWithEmbeddedFhincd = {
      ...visualTemplate,
      name: '7161ストッパー台（1）MD004121651'
    };
    mockGetVisualTemplate.mockResolvedValue(visualWithEmbeddedFhincd);
    mockResolveVisualLinkedFhincd.mockResolvedValue({ kind: 'none' });

    renderCreatePage();

    await waitFor(() => {
      expect(screen.getByLabelText('品番')).toHaveValue('MD004121651');
    });
    expect(screen.getByText(/図面名から品番/)).toBeInTheDocument();
    expect(screen.getByLabelText('テンプレ')).toHaveValue(
      '7161ストッパー台（1）MD004121651 MD004121651'
    );
  });

  it('prompts manual fhincd entry when linked fhincd is none and name has no token', async () => {
    mockResolveVisualLinkedFhincd.mockResolvedValue({ kind: 'none' });

    renderCreatePage();

    await waitFor(() => {
      expect(screen.getByText(/品番を手入力してください/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('品番')).toHaveValue('');
    expect(screen.getByLabelText('テンプレ')).toHaveValue('7161テーブル');
  });
});
