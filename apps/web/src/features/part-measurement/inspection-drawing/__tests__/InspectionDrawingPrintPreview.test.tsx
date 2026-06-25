import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE
} from '../inspectionDrawingPreviewFixtures';
import {
  INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM,
  INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER,
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM,
  INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE,
  getInspectionDrawingPrintRecordTableWidthMm
} from '../inspectionDrawingPrintConstants';
import { InspectionDrawingPrintPreview } from '../InspectionDrawingPrintPreview';
import { buildInspectionDrawingPrintViewModel } from '../inspectionDrawingPrintViewModel';

function loadPreviewDrawingProbe() {
  const probe = document.querySelector('img[src^="data:image"]') as HTMLImageElement;
  Object.defineProperty(probe, 'naturalWidth', { configurable: true, value: 800 });
  Object.defineProperty(probe, 'naturalHeight', { configurable: true, value: 600 });
  fireEvent.load(probe);
  return probe;
}

describe('InspectionDrawingPrintPreview', () => {
  const issuedAt = new Date('2026-06-14T08:51:00.000Z');
  const viewModel = buildInspectionDrawingPrintViewModel({
    template: INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE,
    resourceName: 'R001（FJV50/80）',
    issuedAt
  });

  it('disables print until the drawing natural size is known', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar
      />
    );

    const button = screen.getByRole('button', { name: '図面読込中…' });
    expect(button).toBeDisabled();

    loadPreviewDrawingProbe();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '印刷プレビュー' })).toBeEnabled();
    });
  });

  it('does not call window.print before the drawing is ready', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '図面読込中…' }));
    expect(printSpy).not.toHaveBeenCalled();

    loadPreviewDrawingProbe();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '印刷プレビュー' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '印刷プレビュー' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('omits sheet preview disclaimer and draft placeholder labels', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    await screen.findAllByTestId('inspection-print-sheet-header');

    expect(screen.queryByText(INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER)).toBeNull();
    expect(screen.queryByText(/QR予定/)).toBeNull();
    expect(screen.queryByText(/将来読取用/)).toBeNull();
    expect(screen.queryByText(/数値欄は仮配置/)).toBeNull();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('-0.05 - 0.05')).toBeInTheDocument();
  });

  it('keeps the preview disclaimer in the toolbar only', () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar
      />
    );

    expect(screen.getByText(INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER)).toBeInTheDocument();
  });

  it('uses a compact single header row on drawing and record pages', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    const headers = await screen.findAllByTestId('inspection-print-sheet-header');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent('検査図面 位置確認');
    expect(headers[1]).toHaveTextContent('検査値 記録欄');
    expect(headers[0]).toHaveTextContent('部品: DEMO-12345');
    expect(headers[0]).toHaveTextContent('資源: R001（FJV50/80）');
    expect(headers[0]).toHaveTextContent('帳票ID:');
    expect(screen.queryByText('帳票単位:')).toBeNull();
  });

  it('keeps P1 free of OCR fiducials and prints page-specific QR on record pages', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    await screen.findAllByTestId('inspection-print-sheet-header');

    const drawingArea = screen.getByTestId('inspection-print-drawing-area');
    expect(drawingArea.className).not.toContain('border-slate-900');
    expect(drawingArea).toHaveStyle({
      height: `${INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM}mm`
    });
    expect(screen.getAllByTestId('inspection-print-sheet-fiducial')).toHaveLength(
      viewModel.recordPages.length * 4
    );

    expect(screen.getByTestId('inspection-print-record-qr')).toHaveClass(
      'absolute',
      'right-[8mm]',
      'top-[2.4mm]'
    );
    const qrCodes = screen.getAllByTestId('inspection-print-record-qr-code');
    expect(qrCodes).toHaveLength(viewModel.recordPages.length);
    expect(qrCodes[0]).toHaveClass('h-[22mm]', 'w-[22mm]');

    const payload = JSON.parse(qrCodes[0]?.getAttribute('data-qr-payload') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      type: 'inspection-drawing-record-page',
      schemaVersion: 1,
      reportId: viewModel.metadata.previewIdentifier,
      templateId: viewModel.metadata.templateId,
      fhincd: 'DEMO-12345',
      resourceCd: 'R001',
      templateVersion: 3,
      pageNumber: 2,
      totalPages: 2,
      entryIndexFrom: 1,
      entryIndexTo: 5,
      markerNoFrom: 1,
      markerNoTo: 3
    });
    expect(screen.getByTestId('inspection-print-record-controls').className).toContain('w-[72mm]');
  });

  it('renders OCR-friendly split measurement boxes at form scale', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    const table = await screen.findByTestId('inspection-print-record-table');
    expect(table).toHaveStyle({
      width: `${getInspectionDrawingPrintRecordTableWidthMm(INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE)}mm`
    });
    expect(table.querySelectorAll('col')).toHaveLength(3 + INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE);
    expect(table.querySelectorAll('col')[1]).toHaveStyle({
      width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementPoint}mm`
    });
    expect(table.querySelectorAll('col')[2]).toHaveStyle({
      width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.specification}mm`
    });
    table.querySelectorAll('col').forEach((col, index) => {
      if (index >= 3) {
        expect(col).toHaveStyle({
          width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementValue}mm`
        });
      }
    });
    expect(screen.getAllByTestId('inspection-print-measurement-value-boxes')).toHaveLength(
      viewModel.points.length * INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE
    );
    expect(screen.getAllByTestId('inspection-print-measurement-value-boxes')[0]).toHaveClass(
      'h-[8.9mm]'
    );
    expect(screen.getByText('測定値（符号 / 整数4桁 / 小数3桁）')).toBeInTheDocument();
    expect(screen.getByText('1件目')).toBeInTheDocument();
    expect(screen.getByText('5件目')).toBeInTheDocument();
    expect(screen.queryByText('判定')).toBeNull();
    expect(screen.queryByText('確認')).toBeNull();
    expect(screen.queryByText('備考')).toBeNull();
  });

  it('renders print-only drawing markers at the reduced report size', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    const marker = (await screen.findAllByText('1')).find((element) =>
      element.classList.contains('absolute')
    );
    expect(marker).toBeDefined();
    expect(marker).toHaveClass('h-[4.5mm]', 'min-w-[4.5mm]', 'text-[6pt]');
  });
});
