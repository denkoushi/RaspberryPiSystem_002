import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
