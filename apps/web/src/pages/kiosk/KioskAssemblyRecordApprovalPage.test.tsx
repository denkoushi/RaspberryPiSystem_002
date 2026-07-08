import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyRecordApprovalPage } from './KioskAssemblyRecordApprovalPage';

import type { AssemblyWorkSessionDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const mockVerifyPassword = vi.fn();
const mockListSummaries = vi.fn();
const mockGetSession = vi.fn();
const mockResolveOperatorNfc = vi.fn();
const mockApprove = vi.fn();

vi.mock('../../api/client', () => ({
  verifyKioskAssemblyRecordApprovalAccessPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  listAssemblyWorkSessionSummaries: (...args: unknown[]) => mockListSummaries(...args),
  getAssemblyWorkSession: (...args: unknown[]) => mockGetSession(...args),
  resolveAssemblyOperatorNfc: (...args: unknown[]) => mockResolveOperatorNfc(...args),
  approveAssemblyWorkSessionRecordApproval: (...args: unknown[]) => mockApprove(...args)
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: () => null
}));

const summary: AssemblyWorkSessionSummaryDto = {
  id: 'session-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'completed',
  productNo: 'ASM-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: '2026-07-06T01:00:00.000Z',
  cancelledAt: null,
  updatedAt: '2026-07-06T01:00:00.000Z',
  templateModelCode: 'MACHINE-X',
  templateProcedurePattern: '標準',
  templateName: 'MACHINE-X 標準',
  templateVersion: 1,
  currentAreaId: null,
  currentAreaName: null,
  currentBoltId: null,
  currentBoltMarkerNo: null,
  acceptedBoltCount: 1,
  totalBoltCount: 1,
  approval: null
};

const detail: AssemblyWorkSessionDto = {
  id: 'session-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'completed',
  productNo: 'ASM-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorEmployeeId: null,
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  currentAreaId: null,
  currentBoltId: null,
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: '2026-07-06T01:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T01:00:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MACHINE-X',
    procedurePattern: '標準',
    name: 'MACHINE-X 標準',
    version: 1,
    isActive: true,
    procedureDocumentId: 'doc-1',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    procedureDocument: {
      id: 'doc-1',
      name: '手順書',
      imageRelativePath: '/assembly/procedures/doc-1.png',
      isActive: true,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    },
    areas: []
  },
  torqueRecords: [],
  restartLogs: [],
  approval: null,
  areaTorqueSummaries: [
    {
      areaId: 'area-1',
      areaCode: '13',
      areaName: 'ストッパー取付',
      processNo: '7',
      totalBoltCount: 1,
      acceptedOkCount: 1,
      ngCount: 0,
      ignoredCount: 0
    }
  ]
};

function renderPage(initialEntry = '/kiosk/assembly/record-approvals') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/kiosk/assembly/record-approvals" element={<KioskAssemblyRecordApprovalPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyRecordApprovalPage', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
    mockListSummaries.mockReset();
    mockGetSession.mockReset();
    mockResolveOperatorNfc.mockReset();
    mockApprove.mockReset();
    mockVerifyPassword.mockResolvedValue({ success: true });
    mockListSummaries.mockResolvedValue([summary]);
    mockGetSession.mockResolvedValue(detail);
    vi.spyOn(window, 'prompt').mockReturnValue('2520');
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('renders completed session detail after password authentication', async () => {
    renderPage();

    await waitFor(() => expect(mockVerifyPassword).toHaveBeenCalledWith({ password: '2520' }));
    expect(await screen.findByRole('heading', { name: '組立記録確認' })).toBeInTheDocument();
    expect(await screen.findByText('ASM-001')).toBeInTheDocument();
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith('session-1'));
    expect(await screen.findByText('ストッパー取付')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '承認して完了' })).toBeDisabled();
  });

  it('selects initial session from query parameter', async () => {
    renderPage('/kiosk/assembly/record-approvals?sessionId=session-1');

    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith('session-1'));
  });

  it('shows password gate when authentication fails', async () => {
    mockVerifyPassword.mockResolvedValue({ success: false });
    renderPage();

    expect(await screen.findByText('パスワードが違います。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '認証する' }));
    await waitFor(() => expect(mockVerifyPassword).toHaveBeenCalledTimes(2));
  });
});
