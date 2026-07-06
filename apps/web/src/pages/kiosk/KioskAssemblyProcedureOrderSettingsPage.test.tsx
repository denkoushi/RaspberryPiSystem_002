import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyProcedureOrderSettingsPage } from './KioskAssemblyProcedureOrderSettingsPage';

import type { KioskDocumentSummary } from '../../api/client';
import type { AssemblyProcedureOrderDto } from '../../features/assembly/types';

const mockVerifyAccessPassword = vi.fn();
const mockGetAssemblyProcedureOrder = vi.fn();
const mockSaveAssemblyProcedureOrder = vi.fn();
const mockGetKioskDocuments = vi.fn();

vi.mock('../../api/client', () => ({
  verifyAssemblyProcedureOrderAccessPassword: (...args: unknown[]) => mockVerifyAccessPassword(...args),
  getAssemblyProcedureOrder: (...args: unknown[]) => mockGetAssemblyProcedureOrder(...args),
  saveAssemblyProcedureOrder: (...args: unknown[]) => mockSaveAssemblyProcedureOrder(...args),
  getKioskDocuments: (...args: unknown[]) => mockGetKioskDocuments(...args)
}));

const documentA: KioskDocumentSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'MH-AX X軸要領書',
  displayTitle: 'X軸要領書',
  filename: 'mh-ax-x.pdf',
  extractedText: null,
  ocrStatus: 'COMPLETED',
  ocrEngine: null,
  ocrStartedAt: null,
  ocrFinishedAt: null,
  ocrRetryCount: 0,
  ocrFailureReason: null,
  candidateFhincd: null,
  candidateDrawingNumber: null,
  candidateProcessName: null,
  candidateResourceCd: null,
  candidateDocumentNumber: null,
  summaryCandidate1: null,
  summaryCandidate2: null,
  summaryCandidate3: null,
  confidenceFhincd: null,
  confidenceDrawingNumber: null,
  confidenceProcessName: null,
  confidenceResourceCd: null,
  confidenceDocumentNumber: null,
  confirmedFhincd: null,
  confirmedDrawingNumber: null,
  confirmedProcessName: null,
  confirmedResourceCd: null,
  confirmedDocumentNumber: '産1-G025AAK',
  confirmedSummaryText: 'X軸の組立要領',
  documentCategory: null,
  sourceType: 'MANUAL',
  gmailMessageId: null,
  sourceAttachmentName: null,
  pageCount: 3,
  enabled: true,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z'
};

const emptyOrder: AssemblyProcedureOrderDto = {
  id: null,
  machineName: 'MH-AX',
  machineNameKey: 'MH-AX',
  configured: false,
  items: []
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly/procedure-order-settings?machineName=mh-ax']}>
      <Routes>
        <Route path="/kiosk/assembly/procedure-order-settings" element={<KioskAssemblyProcedureOrderSettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyProcedureOrderSettingsPage', () => {
  beforeEach(() => {
    mockVerifyAccessPassword.mockReset();
    mockGetAssemblyProcedureOrder.mockReset();
    mockSaveAssemblyProcedureOrder.mockReset();
    mockGetKioskDocuments.mockReset();
    mockVerifyAccessPassword.mockResolvedValue({ success: true });
    mockGetAssemblyProcedureOrder.mockResolvedValue(emptyOrder);
    mockGetKioskDocuments.mockResolvedValue([documentA]);
    mockSaveAssemblyProcedureOrder.mockImplementation(async (payload) => ({
      ...emptyOrder,
      configured: payload.items.length > 0,
      items: payload.items.map((item: { kioskDocumentId: string; label?: string | null }, index: number) => ({
        id: `item-${index}`,
        sortOrder: index,
        label: item.label ?? null,
        kioskDocumentId: item.kioskDocumentId,
        document: documentA
      }))
    }));
  });

  it('authenticates, adds a PDF document, and saves order items', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('パスワード'), { target: { value: '2520' } });
    fireEvent.click(screen.getByRole('button', { name: '認証' }));

    await waitFor(() => expect(mockVerifyAccessPassword).toHaveBeenCalledWith({ password: '2520' }));
    await waitFor(() => expect(mockGetAssemblyProcedureOrder).toHaveBeenCalledWith('MH-AX'));
    expect(await screen.findByText(/産1-G025AAK X軸要領書/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /産1-G025AAK X軸要領書/ }));
    fireEvent.change(screen.getByPlaceholderText('例: X軸'), { target: { value: 'X軸' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockSaveAssemblyProcedureOrder).toHaveBeenCalledWith({
        machineName: 'MH-AX',
        accessPassword: '2520',
        items: [{ kioskDocumentId: documentA.id, label: 'X軸' }]
      })
    );
    expect(await screen.findByText('閲覧順設定を保存しました。')).toBeInTheDocument();
  });
});
