import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureSequenceViewer } from './AssemblyProcedureSequenceViewer';

import type { AssemblyProcedureSequenceDto } from './types';

const mockUseProtectedImageBlobUrl = vi.fn();

vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: (...args: unknown[]) => mockUseProtectedImageBlobUrl(...args)
}));

const baseDocument: AssemblyProcedureSequenceDto['documents'][number] = {
  orderItemId: 'item-1',
  sortOrder: 0,
  label: null,
  documentType: 'assembly_procedure_document',
  kioskDocumentId: null,
  assemblyProcedureDocumentId: 'doc-1',
  title: 'MH-AX 締付手順',
  displayTitle: null,
  filename: 'mh-ax.png',
  confirmedDocumentNumber: null,
  confirmedSummaryText: null,
  pageCount: 1,
  updatedAt: '2026-07-06T00:00:00.000Z',
  pageUrls: ['/api/storage/assembly-procedure-images/mh-ax.png']
};

const assemblySequence: AssemblyProcedureSequenceDto = {
  mode: 'configured',
  reason: null,
  machineName: 'MH-AX',
  machineNameKey: 'MH-AX',
  fallbackProcedureDocument: null,
  documents: [baseDocument]
};

describe('AssemblyProcedureSequenceViewer', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    mockUseProtectedImageBlobUrl.mockReset();
    mockUseProtectedImageBlobUrl.mockReturnValue({ blobUrl: 'blob:sequence-image', error: null });
  });

  it('renders assembly procedure images via protected image fetch', () => {
    render(<AssemblyProcedureSequenceViewer sequence={assemblySequence} />);
    expect(mockUseProtectedImageBlobUrl).toHaveBeenCalledWith('/api/storage/assembly-procedure-images/mh-ax.png');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:sequence-image');
  });

  it('renders pdf page images without protected image fetch', () => {
    const pdfSequence: AssemblyProcedureSequenceDto = {
      ...assemblySequence,
      documents: [{ ...baseDocument, documentType: 'kiosk_document', kioskDocumentId: 'kiosk-doc-1', assemblyProcedureDocumentId: null, pageUrls: ['/api/storage/pdf-pages/doc/page-1.png'] }]
    };
    render(<AssemblyProcedureSequenceViewer sequence={pdfSequence} />);
    expect(mockUseProtectedImageBlobUrl).toHaveBeenCalledWith(null);
    expect(screen.getByRole('img').getAttribute('src')).toContain('/api/storage/pdf-pages/doc/page-1.png');
  });

  it('navigates explicit crop steps with instructions, minimap, and crop-local marker coordinates', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      top: 0,
      right: 400,
      bottom: 300,
      left: 0,
      toJSON: () => ({})
    });
    const sequence: AssemblyProcedureSequenceDto = {
      ...assemblySequence,
      stepSource: 'template_steps',
      steps: [
        {
          id: 'step-1',
          sortOrder: 0,
          kioskDocumentId: null,
          assemblyProcedureDocumentId: 'doc-1',
          pageIndex: 0,
          viewMode: 'crop',
          cropXRatio: 0.2,
          cropYRatio: 0.2,
          cropWidthRatio: 0.4,
          cropHeightRatio: 0.4,
          title: '重点締付',
          instructionText: '丸数字を確認',
          emphasis: 'important',
          documentType: 'assembly_procedure_document',
          documentTitle: 'MH-AX 締付手順',
          pageUrl: '/api/storage/assembly-procedure-images/mh-ax.png'
        },
        {
          id: 'step-2',
          sortOrder: 1,
          kioskDocumentId: null,
          assemblyProcedureDocumentId: 'doc-1',
          pageIndex: 0,
          viewMode: 'full_page',
          cropXRatio: null,
          cropYRatio: null,
          cropWidthRatio: null,
          cropHeightRatio: null,
          title: '全体確認',
          instructionText: null,
          emphasis: 'normal',
          documentType: 'assembly_procedure_document',
          documentTitle: 'MH-AX 締付手順',
          pageUrl: '/api/storage/assembly-procedure-images/mh-ax.png'
        }
      ]
    };
    render(
      <AssemblyProcedureSequenceViewer
        sequence={sequence}
        boltMarkers={[
          {
            id: 'bolt-1',
            markerNo: 1,
            xRatio: 0.4,
            yRatio: 0.4,
            calloutTipXRatio: 0.8,
            calloutTipYRatio: 0.4,
            label: '丸数字1'
          }
        ]}
        checkMarkers={[
          {
            id: 'check-1',
            markerNo: 2,
            xRatio: 0.5,
            yRatio: 0.5,
            label: '共有チェック',
            required: true,
            checked: true
          }
        ]}
      />
    );
    expect(screen.getByText(/手順 1\/2/)).toBeInTheDocument();
    expect(screen.getByText('丸数字を確認')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-procedure-crop-minimap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '丸数字1' })).toHaveStyle({
      left: '50%',
      top: '50%'
    });
    expect(screen.getByTestId('image-marker-callout-svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '共有チェック' })).toHaveAttribute(
      'data-marker-id',
      'check-1'
    );
    fireEvent.click(screen.getByRole('button', { name: '次手順' }));
    expect(screen.getByText(/手順 2\/2/)).toBeInTheDocument();
    expect(screen.getAllByText(/全体確認/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '丸数字1' })).toHaveAttribute(
      'data-marker-id',
      'bolt-1'
    );
    expect(screen.getByRole('button', { name: '共有チェック' })).toHaveAttribute(
      'data-marker-id',
      'check-1'
    );
  });
});
