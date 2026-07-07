import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyProcedureOrderSettingsPage } from './KioskAssemblyProcedureOrderSettingsPage';

import type { AssemblyProcedureDocumentSummaryDto, AssemblyProcedureOrderDto } from '../../features/assembly/types';

const mockVerifyAccessPassword = vi.fn();
const mockGetAssemblyProcedureOrder = vi.fn();
const mockSaveAssemblyProcedureOrder = vi.fn();
const mockListAssemblyProcedureDocumentSummaries = vi.fn();

vi.mock('../../api/client', () => ({
  verifyAssemblyProcedureOrderAccessPassword: (...args: unknown[]) => mockVerifyAccessPassword(...args),
  getAssemblyProcedureOrder: (...args: unknown[]) => mockGetAssemblyProcedureOrder(...args),
  saveAssemblyProcedureOrder: (...args: unknown[]) => mockSaveAssemblyProcedureOrder(...args),
  listAssemblyProcedureDocumentSummaries: (...args: unknown[]) => mockListAssemblyProcedureDocumentSummaries(...args),
  getKioskDocumentDetail: vi.fn()
}));

const procedureDocumentA: AssemblyProcedureDocumentSummaryDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'MH-AX 締付手順',
  imageRelativePath: '/api/storage/assembly-procedure-images/mh-ax.png',
  isActive: true,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  activeTemplateCount: 1,
  totalTemplateCount: 1
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
    mockListAssemblyProcedureDocumentSummaries.mockReset();
    mockVerifyAccessPassword.mockResolvedValue({ success: true });
    mockGetAssemblyProcedureOrder.mockResolvedValue(emptyOrder);
    mockListAssemblyProcedureDocumentSummaries.mockResolvedValue([procedureDocumentA]);
    mockSaveAssemblyProcedureOrder.mockImplementation(async (payload) => ({
      ...emptyOrder,
      configured: payload.items.length > 0,
      items: payload.items.map(
        (
          item: { assemblyProcedureDocumentId?: string | null; kioskDocumentId?: string | null; label?: string | null },
          index: number
        ) => ({
          id: `item-${index}`,
          sortOrder: index,
          label: item.label ?? null,
          documentType: item.assemblyProcedureDocumentId ? 'assembly_procedure_document' : 'kiosk_document',
          kioskDocumentId: item.kioskDocumentId ?? null,
          assemblyProcedureDocumentId: item.assemblyProcedureDocumentId ?? null,
          document: {
            id: item.assemblyProcedureDocumentId ?? item.kioskDocumentId ?? `doc-${index}`,
            documentType: item.assemblyProcedureDocumentId ? 'assembly_procedure_document' : 'kiosk_document',
            title: procedureDocumentA.name,
            displayTitle: null,
            filename: procedureDocumentA.name,
            confirmedDocumentNumber: null,
            confirmedSummaryText: null,
            pageCount: 1,
            enabled: true,
            updatedAt: procedureDocumentA.updatedAt,
            imageRelativePath: item.assemblyProcedureDocumentId ? procedureDocumentA.imageRelativePath : null
          }
        })
      )
    }));
  });

  it('authenticates, adds an assembly procedure document, and saves order items', async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('パスワード'), { target: { value: '2520' } });
    fireEvent.click(screen.getByRole('button', { name: '認証' }));

    await waitFor(() => expect(mockVerifyAccessPassword).toHaveBeenCalledWith({ password: '2520' }));
    await waitFor(() => expect(mockGetAssemblyProcedureOrder).toHaveBeenCalledWith('MH-AX'));
    await waitFor(() => expect(mockListAssemblyProcedureDocumentSummaries).toHaveBeenCalledWith({ limit: 200 }));
    expect(await screen.findByText('MH-AX 締付手順')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.change(screen.getByPlaceholderText('例: X軸'), { target: { value: 'X軸' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockSaveAssemblyProcedureOrder).toHaveBeenCalledWith({
        machineName: 'MH-AX',
        accessPassword: '2520',
        items: [{ assemblyProcedureDocumentId: procedureDocumentA.id, kioskDocumentId: null, label: 'X軸' }]
      })
    );
    expect(await screen.findByText('閲覧順設定を保存しました。')).toBeInTheDocument();
  });
});
