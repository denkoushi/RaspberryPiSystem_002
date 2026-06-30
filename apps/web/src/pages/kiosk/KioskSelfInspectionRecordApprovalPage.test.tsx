import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSelfInspectionRecordApprovalPage } from './KioskSelfInspectionRecordApprovalPage';

const mockUseSelfInspectionRegistrationPolicy = vi.fn();
const mockUpdateRegistrationPolicy = vi.fn();
const mockUseSelfInspectionRecordApprovals = vi.fn();
const mockUseSelfInspectionRecordApprovalSession = vi.fn();
const mockUseResolveApprover = vi.fn();
const mockUseApproveRecordApproval = vi.fn();
const mockVerifyAccessPassword = vi.fn();

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
  useApproveSelfInspectionRecordApproval: () => mockUseApproveRecordApproval(),
  useVerifyKioskSelfInspectionRecordApprovalAccessPassword: () => ({
    isPending: false,
    mutateAsync: mockVerifyAccessPassword
  })
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
    mockVerifyAccessPassword.mockReset();
    vi.spyOn(window, 'prompt').mockReturnValue('2520');
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);

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
    mockVerifyAccessPassword.mockResolvedValue({ success: true });
    mockUpdateRegistrationPolicy.mockResolvedValue({
      key: 'shared',
      requireMeasuringInstrumentTag: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
      updatedBy: 'kiosk'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles measuring instrument tag requirement from the top menu', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '計測機器の使用前点検必須 OFF' }));

    await waitFor(() => {
      expect(mockUpdateRegistrationPolicy).toHaveBeenCalledWith({
        requireMeasuringInstrumentTag: true
      });
    });
    expect(await screen.findByText('計測機器の使用前点検必須をONにしました。')).toBeInTheDocument();
  });

  it('requires the access password when opened directly', async () => {
    renderPage();

    await waitFor(() => {
      expect(window.prompt).toHaveBeenCalledWith('検査記録確認パスワードを入力してください');
      expect(mockVerifyAccessPassword).toHaveBeenCalledWith({ password: '2520' });
    });
    expect(await screen.findByText('入力途中、点検不足、承認可能な自主検査を確認します。')).toBeInTheDocument();
  });

  it('asks for the access password again after the page is unmounted', async () => {
    const first = renderPage();
    await screen.findByText('入力途中、点検不足、承認可能な自主検査を確認します。');
    first.unmount();

    renderPage();
    await screen.findByText('入力途中、点検不足、承認可能な自主検査を確認します。');

    expect(window.prompt).toHaveBeenCalledTimes(2);
  });

  it('shows updated date, inputter, and saved date for selected records', async () => {
    const session = {
      id: 'session-1',
      productNo: '0003886408',
      fhincd: 'FH-1',
      fhinmei: '確認品',
      resourceCd: '589',
      fseiban: 'FS-1',
      updatedAt: '2026-06-30T01:02:03.000Z',
      participantEmployeeNames: ['山田 太郎'],
      recordApprovalState: 'input_incomplete',
      recordApproval: null,
      completedRequiredEntryCount: 1,
      requiredEntryCount: 2,
      incompleteRegistrationEntryCount: 0,
      pendingReviewCount: 0
    };
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [session], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: {
        ...session,
        missingRequiredEntryCount: 1,
        incompleteValueEntryCount: 0,
        requiredEntries: [
          {
            entryIndex: 0,
            entrySlotKind: 'first',
            entrySlotLabel: '初品',
            state: 'ready',
            entry: {
              id: 'entry-1',
              createdByEmployeeId: 'employee-1',
              createdByEmployeeNameSnapshot: '山田 太郎',
              measuringInstrumentId: null,
              measuringInstrumentManagementNumberSnapshot: null,
              measuringInstrumentNameSnapshot: null,
              measuringInstrumentTagUidSnapshot: null,
              instrumentUsages: [],
              createdAt: '2026-06-30T01:00:00.000Z',
              updatedAt: '2026-06-30T01:02:03.000Z'
            },
            values: [
              {
                id: 'value-1',
                templateItemId: 'item-1',
                displayMarker: '1',
                datumSurface: 'A',
                measurementPoint: '外径',
                measurementLabel: '寸法',
                unit: 'mm',
                value: '10.01',
                lowerLimit: '9.8',
                upperLimit: '10.2',
                isWithinTolerance: true,
                reviewStatus: 'NOT_REQUIRED',
                outOfToleranceAcknowledgedAt: null,
                approvedAt: null,
                updatedAt: '2026-06-30T01:02:03.000Z'
              }
            ]
          }
        ]
      },
      isLoading: false
    });

    renderPage();

    expect(await screen.findAllByText(/入力者 山田 太郎/)).not.toHaveLength(0);
    expect(screen.getAllByText(/更新 2026\/6\/30/).length).toBeGreaterThan(0);
    expect(screen.getByText(/保存 2026\/6\/30/)).toBeInTheDocument();
  });
});
