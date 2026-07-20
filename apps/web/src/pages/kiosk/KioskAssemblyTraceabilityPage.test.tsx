import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyTraceabilityPage } from './KioskAssemblyTraceabilityPage';

const mockVerify = vi.fn();
const mockList = vi.fn();
const mockResolve = vi.fn();
const mockLink = vi.fn();
const mockAssignFormal = vi.fn();

vi.mock('../../api/client', () => ({
  verifyKioskAssemblyTraceabilityAccessPassword: (...args: unknown[]) => mockVerify(...args),
  listAssemblyTraceabilityWorkUnits: (...args: unknown[]) => mockList(...args),
  resolveAssemblyTraceabilityWorkUnit: (...args: unknown[]) => mockResolve(...args),
  linkAssemblyWorkUnits: (...args: unknown[]) => mockLink(...args),
  assignAssemblyFormalIdentifier: (...args: unknown[]) => mockAssignFormal(...args),
  correctAssemblyFormalIdentifier: vi.fn(),
  reassignAssemblyWorkUnit: vi.fn(),
  unlinkAssemblyWorkUnits: vi.fn()
}));

vi.mock('../../features/barcode-scan', () => ({ useSerialBarcodeStream: vi.fn() }));

const detail = {
  workUnit: {
    id: 'final-id', workId: 'FINAL-001', status: 'completed' as const, productNo: 'P-001', targetUnit: '完成品', templateName: '標準 v1', completedAt: '2026-07-20T00:00:00.000Z'
  },
  activeParent: null,
  activeChildren: [],
  root: {
    workUnit: {
      id: 'final-id', workId: 'FINAL-001', status: 'completed' as const, productNo: 'P-001', targetUnit: '完成品', templateName: '標準 v1', completedAt: '2026-07-20T00:00:00.000Z'
    },
    formalIdentifier: null
  },
  formalIdentifierHistory: [],
  compositionHistory: [],
  genealogy: []
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly/traceability']}>
      <Routes>
        <Route path="/kiosk/assembly/traceability" element={<KioskAssemblyTraceabilityPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyTraceabilityPage', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockList.mockReset();
    mockResolve.mockReset();
    mockLink.mockReset();
    mockAssignFormal.mockReset();
    mockVerify.mockResolvedValue({ success: true });
    mockList.mockResolvedValue([]);
    mockResolve.mockResolvedValue(detail);
    mockLink.mockResolvedValue({ id: 'link-1' });
    mockAssignFormal.mockResolvedValue({ id: 'formal-1', formalId: 'FORMAL-001' });
    vi.spyOn(window, 'prompt').mockReturnValue('2520');
  });

  it('authenticates, resolves a parent work ID, and sends work-ID contracts', async () => {
    renderPage();

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith({ password: '2520' }));
    const parentInput = await screen.findByPlaceholderText('作業用IDをスキャンまたは入力');
    fireEvent.change(parentInput, { target: { value: 'final-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('FINAL-001'));
    expect(await screen.findByText('子アセンブリを追加')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('完了済み子の作業用ID'), { target: { value: 'sub-001' } });
    fireEvent.click(screen.getByRole('button', { name: '紐付け' }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith({
      parentWorkId: 'FINAL-001',
      childWorkId: 'sub-001',
      accessPassword: '2520'
    }));
  });

  it('uses the formal-ID field only for the completed root', async () => {
    renderPage();
    const parentInput = await screen.findByPlaceholderText('作業用IDをスキャンまたは入力');
    fireEvent.change(parentInput, { target: { value: 'FINAL-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('正式ID');

    fireEvent.change(screen.getByPlaceholderText('正式IDをスキャンまたは入力'), { target: { value: 'formal-001' } });
    fireEvent.click(screen.getByRole('button', { name: '付与' }));
    await waitFor(() => expect(mockAssignFormal).toHaveBeenCalledWith({
      workId: 'FINAL-001', formalId: 'formal-001', accessPassword: '2520'
    }));
  });
});
