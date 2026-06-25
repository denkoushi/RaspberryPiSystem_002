import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInspectionDrawingPrintPage } from './KioskInspectionDrawingPrintPage';

const mockGetTemplate = vi.fn();
const mockGetPaperPrint = vi.fn();
const mockUseResources = vi.fn();
const mockUseBlob = vi.fn();

vi.mock('../../api/client', () => ({
  getKioskInspectionDrawingTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  getSelfInspectionPaperReportPrint: (...args: unknown[]) => mockGetPaperPrint(...args),
  getResolvedClientKey: () => 'test-client-key',
  setClientKeyHeader: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useKioskProductionScheduleResources: (...args: unknown[]) => mockUseResources(...args)
}));

vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', () => ({
  usePartMeasurementDrawingBlobUrl: (...args: unknown[]) => mockUseBlob(...args)
}));

vi.mock('../../features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview', () => ({
  InspectionDrawingPrintPreview: ({
    showToolbar,
    viewModel,
    returnAction
  }: {
    showToolbar?: boolean;
    viewModel: { recordPages: Array<{ entrySlots: Array<{ entryLabel: string }> }> };
    returnAction?: { label: string; onClick: () => void };
  }) => (
    <div
      data-testid="print-preview"
      data-entry-labels={viewModel.recordPages[0]?.entrySlots.map((slot) => slot.entryLabel).join(',')}
    >
      {showToolbar ? 'toolbar-on' : 'toolbar-off'}
      {returnAction ? <button onClick={returnAction.onClick}>{returnAction.label}</button> : null}
    </div>
  )
}));

function buildTemplate() {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fhincd: 'DEMO-12345',
    resourceCd: 'R001',
    processGroup: 'cutting',
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: '検査図面',
    version: 1,
    isActive: true,
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    visualTemplateId: 'visual-1',
    visualTemplate: {
      id: 'visual-1',
      name: 'sample',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
      isActive: true,
      createdAt: '2026-06-14T08:00:00.000Z',
      updatedAt: '2026-06-14T08:00:00.000Z'
    },
    items: [
      {
        id: 'pt-1',
        sortOrder: 0,
        datumSurface: 'A',
        measurementPoint: 'P',
        measurementLabel: '穴径 A',
        displayMarker: '1',
        unit: 'mm',
        allowNegative: false,
        decimalPlaces: 3,
        markerXRatio: '0.35',
        markerYRatio: '0.42',
        nominalValue: '10',
        lowerLimit: '9.95',
        upperLimit: '10.05'
      }
    ]
  };
}

function buildPaperPrintDto(reportId = 'paper-report-1') {
  return {
    template: buildTemplate(),
    report: {
      id: reportId,
      sessionId: 'session-1',
      scheduleRowId: 'schedule-row-1',
      templateId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      status: 'ISSUED',
      issuedAt: '2026-06-14T08:51:00.000Z',
      supersededAt: null,
      importedAt: null,
      cancelledAt: null,
      clientDeviceId: 'test-client-key',
      plannedQuantity: 2,
      templateVersion: 1,
      createdAt: '2026-06-14T08:51:00.000Z',
      updatedAt: '2026-06-14T08:51:00.000Z',
      pages: [
        {
          id: 'paper-page-1',
          reportId,
          pageCode: 'A7K4M2Q9',
          pageNumber: 2,
          qrPayload: 'SIP1:A7K4M2Q9:5F',
          entryIndexFrom: 1,
          entryIndexTo: 2,
          markerNoFrom: 1,
          markerNoTo: 1,
          createdAt: '2026-06-14T08:51:00.000Z'
        }
      ]
    }
  };
}

function renderPage(
  templateId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  search = ''
) {
  return render(
    <MemoryRouter initialEntries={[`/kiosk/part-measurement/inspection/templates/${templateId}/print${search}`]}>
      <Routes>
        <Route
          path="/kiosk/part-measurement/inspection/templates/:templateId/print"
          element={<KioskInspectionDrawingPrintPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPaperReportPage(reportId = 'paper-report-1', search = '') {
  return render(
    <MemoryRouter
      initialEntries={[`/kiosk/part-measurement/inspection/paper-reports/${reportId}/print${search}`]}
    >
      <Routes>
        <Route
          path="/kiosk/part-measurement/inspection/paper-reports/:reportId/print"
          element={<KioskInspectionDrawingPrintPage />}
        />
        <Route
          path="/kiosk/production-schedule/leader-order-board"
          element={<div>順位ボード画面</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskInspectionDrawingPrintPage', () => {
  beforeEach(() => {
    mockGetTemplate.mockReset();
    mockGetPaperPrint.mockReset();
    mockUseResources.mockReturnValue({
      data: { resourceNameMap: { R001: ['FJV50/80'] } }
    });
    mockUseBlob.mockReturnValue({
      blobUrl: 'blob:preview-drawing',
      error: null
    });
  });

  it('shows loading then renders print preview on success', async () => {
    mockGetTemplate.mockResolvedValue({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      templateScope: 'three_key',
      candidateFhinmei: null,
      name: '検査図面',
      version: 1,
      isActive: true,
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'visual-1',
      visualTemplate: {
        id: 'visual-1',
        name: 'sample',
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
        isActive: true,
        createdAt: '2026-06-14T08:00:00.000Z',
        updatedAt: '2026-06-14T08:00:00.000Z'
      },
      items: [
        {
          id: 'pt-1',
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P',
          measurementLabel: '穴径 A',
          displayMarker: '1',
          unit: 'mm',
          allowNegative: false,
          decimalPlaces: 3,
          markerXRatio: '0.35',
          markerYRatio: '0.42',
          nominalValue: '10',
          lowerLimit: '9.95',
          upperLimit: '10.05'
        }
      ]
    });

    renderPage();

    expect(screen.getByText('帳票を準備中')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('print-preview')).toBeInTheDocument();
    });
  });

  it('uses plannedQuantity query for full inspection record columns', async () => {
    mockGetTemplate.mockResolvedValue({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      templateScope: 'three_key',
      candidateFhinmei: null,
      name: '検査図面',
      version: 1,
      isActive: true,
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'visual-1',
      visualTemplate: {
        id: 'visual-1',
        name: 'sample',
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
        isActive: true,
        createdAt: '2026-06-14T08:00:00.000Z',
        updatedAt: '2026-06-14T08:00:00.000Z'
      },
      items: [
        {
          id: 'pt-1',
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P',
          measurementLabel: '穴径 A',
          displayMarker: '1',
          unit: 'mm',
          allowNegative: false,
          decimalPlaces: 3,
          markerXRatio: '0.35',
          markerYRatio: '0.42',
          nominalValue: '10',
          lowerLimit: '9.95',
          upperLimit: '10.05'
        }
      ]
    });

    renderPage('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '?plannedQuantity=3');

    await waitFor(() => {
      expect(screen.getByTestId('print-preview')).toHaveAttribute(
        'data-entry-labels',
        '1件目,2件目,3件目'
      );
    });
  });

  it('passes a paper report return action to the print preview', async () => {
    mockGetPaperPrint.mockResolvedValue(buildPaperPrintDto());

    renderPaperReportPage(
      'paper-report-1',
      '?returnTo=%2Fkiosk%2Fproduction-schedule%2Fleader-order-board%3Fq%3Dabc%23slot-1'
    );

    await waitFor(() => {
      expect(screen.getByTestId('print-preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '順位ボードに戻る' }));

    expect(screen.getByText('順位ボード画面')).toBeInTheDocument();
    expect(mockGetPaperPrint).toHaveBeenCalledWith('paper-report-1', 'test-client-key');
  });

  it('uses the leader board fallback return link when paper report returnTo is unsafe', async () => {
    mockGetPaperPrint.mockRejectedValue({
      response: { status: 404, data: { message: '紙帳票が見つかりません。' } }
    });

    renderPaperReportPage('paper-report-1', '?returnTo=https%3A%2F%2Fevil.example');

    await waitFor(() => {
      expect(screen.getByText('帳票が見つかりません')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '順位ボードに戻る' })).toHaveAttribute(
      'href',
      '/kiosk/production-schedule/leader-order-board'
    );
  });

  it('shows not found for 404', async () => {
    mockGetTemplate.mockRejectedValue({
      response: { status: 404, data: { message: 'テンプレートが見つかりません。' } }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('テンプレートが見つかりません')).toBeInTheDocument();
      expect(screen.getByText('テンプレートが見つかりません。')).toBeInTheDocument();
    });
  });

  it('shows unsupported message for 409', async () => {
    mockGetTemplate.mockRejectedValue({
      response: { status: 409, data: { message: '検査図面帳票の対象外テンプレートです。' } }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('帳票の対象外')).toBeInTheDocument();
      expect(screen.getByText('検査図面帳票の対象外テンプレートです。')).toBeInTheDocument();
    });
  });

  it('shows blob failure separately from template load failure', async () => {
    mockGetTemplate.mockResolvedValue({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      processGroup: 'cutting',
      templateScope: 'three_key',
      candidateFhinmei: null,
      name: '検査図面',
      version: 1,
      isActive: true,
      selfInspectionMode: 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'visual-1',
      visualTemplate: {
        id: 'visual-1',
        name: 'sample',
        drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
        isActive: true,
        createdAt: '2026-06-14T08:00:00.000Z',
        updatedAt: '2026-06-14T08:00:00.000Z'
      },
      items: [
        {
          id: 'pt-1',
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P',
          measurementLabel: '穴径 A',
          displayMarker: '1',
          unit: 'mm',
          allowNegative: false,
          decimalPlaces: 3,
          markerXRatio: '0.35',
          markerYRatio: '0.42',
          nominalValue: '10',
          lowerLimit: '9.95',
          upperLimit: '10.05'
        }
      ]
    });
    mockUseBlob.mockReturnValue({
      blobUrl: null,
      error: '図面の読み込みに失敗しました'
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Blob 取得失敗')).toBeInTheDocument();
    });
    expect(screen.getAllByText('図面の読み込みに失敗しました').length).toBeGreaterThan(0);
  });
});
