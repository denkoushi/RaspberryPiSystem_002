import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE
} from '../inspectionDrawingPreviewFixtures';
import {
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

  it('shows preview disclaimer and omits draft placeholder labels', async () => {
    render(
      <InspectionDrawingPrintPreview
        viewModel={viewModel}
        imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
        showToolbar={false}
      />
    );

    loadPreviewDrawingProbe();

    await waitFor(() => {
      expect(screen.getAllByText(INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER).length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/QR予定/)).toBeNull();
    expect(screen.queryByText(/将来読取用/)).toBeNull();
    expect(screen.queryByText(/数値欄は仮配置/)).toBeNull();
    expect(screen.getByText(/10 \/ -0\.05 - 0\.05/)).toBeInTheDocument();
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

  it('keeps the handwritten measurement column at form scale', async () => {
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
    table.querySelectorAll('col').forEach((col, index) => {
      if (index >= 3) {
        expect(col).toHaveStyle({
          width: `${INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementValue}mm`
        });
      }
    });
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
