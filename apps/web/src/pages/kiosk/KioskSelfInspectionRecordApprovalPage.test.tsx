import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSelfInspectionRecordApprovalPage } from './KioskSelfInspectionRecordApprovalPage';

const mockUseSelfInspectionRegistrationPolicy = vi.fn();
const mockUpdateRegistrationPolicy = vi.fn();
const mockUseSelfInspectionRecordApprovals = vi.fn();
const mockUseSelfInspectionRecordApprovalSession = vi.fn();
const mockUseResolveApprover = vi.fn();
const mockUseApproveRecordApproval = vi.fn();

vi.mock('../../api/hooks', () => ({
  useSelfInspectionRegistrationPolicy: (...args: unknown[]) =>
    mockUseSelfInspectionRegistrationPolicy(...args),
  useUpdateSelfInspectionRegistrationPolicy: () => ({
    isPending: false,
    mutateAsync: mockUpdateRegistrationPolicy
  }),
  useSelfInspectionRecordApprovals: (...args: unknown[]) =>
    mockUseSelfInspectionRecordApprovals(...args),
  useSelfInspectionRecordApprovalSession: (...args: unknown[]) =>
    mockUseSelfInspectionRecordApprovalSession(...args),
  useResolveSelfInspectionRecordApprovalApprover: () => mockUseResolveApprover(),
  useApproveSelfInspectionRecordApproval: () => mockUseApproveRecordApproval()
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: () => null
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/part-measurement/self-inspection/record-approvals']}>
      <Routes>
        <Route
          path="/kiosk/part-measurement/self-inspection/record-approvals"
          element={<KioskSelfInspectionRecordApprovalPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskSelfInspectionRecordApprovalPage', () => {
  beforeEach(() => {
    mockUseSelfInspectionRegistrationPolicy.mockReset();
    mockUpdateRegistrationPolicy.mockReset();
    mockUseSelfInspectionRecordApprovals.mockReset();
    mockUseSelfInspectionRecordApprovalSession.mockReset();
    mockUseResolveApprover.mockReset();
    mockUseApproveRecordApproval.mockReset();

    mockUseSelfInspectionRegistrationPolicy.mockReturnValue({
      data: {
        key: 'shared',
        requireMeasuringInstrumentTag: false,
        updatedAt: null,
        updatedBy: null
      },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: null,
      isLoading: false
    });
    mockUseResolveApprover.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseApproveRecordApproval.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUpdateRegistrationPolicy.mockResolvedValue({
      key: 'shared',
      requireMeasuringInstrumentTag: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
      updatedBy: 'kiosk'
    });
  });

  it('toggles measuring instrument tag requirement from the top menu', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '計測機器の使用前点検必須 OFF' }));

    await waitFor(() => {
      expect(mockUpdateRegistrationPolicy).toHaveBeenCalledWith({
        requireMeasuringInstrumentTag: true
      });
    });
    expect(await screen.findByText('計測機器の使用前点検必須をONにしました。')).toBeInTheDocument();
  });
});
