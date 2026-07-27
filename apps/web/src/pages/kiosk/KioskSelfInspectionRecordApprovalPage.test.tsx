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

function renderPage(
  initialEntry = '/kiosk/part-measurement/self-inspection/record-approvals'
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    expect(
      await screen.findByText(
        '作業者・検査員の入力値と、承認・最終判定の進捗を確認します。'
      )
    ).toBeInTheDocument();
  });

  it('asks for the access password again after the page is unmounted', async () => {
    const first = renderPage();
    await screen.findByText(
      '作業者・検査員の入力値と、承認・最終判定の進捗を確認します。'
    );
    first.unmount();

    renderPage();
    await screen.findByText(
      '作業者・検査員の入力値と、承認・最終判定の進捗を確認します。'
    );

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
      inspectorCompletedRequiredEntryCount: 0,
      inspectorMissingRequiredEntryCount: 2,
      inspectorIncompleteValueEntryCount: 0,
      inspectorIncompleteRegistrationEntryCount: 0,
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
            inspectorEntry: null,
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
                updatedAt: '2026-06-30T01:02:03.000Z',
                inspectorValueId: null,
                inspectorValue: null,
                operatorValueSnapshot: null,
                differenceValue: null,
                inspectorJudgementStatus: null,
                inspectorJudgedAt: null,
                inspectorJudgementComment: null,
                inspectorUpdatedAt: null
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

  it('opens an inspector-final session from sessionId and shows operator results read-only', async () => {
    const session = {
      id: 'session-final',
      productNo: '0003958354',
      fhincd: 'MD005194700',
      fhinmei: 'テーブル',
      resourceCd: '021',
      fseiban: 'BA1S7319',
      updatedAt: '2026-07-27T01:02:03.000Z',
      participantEmployeeNames: ['作業者A'],
      decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      recordApprovalState: 'inspector_measurement_pending',
      recordApproval: null,
      completedRequiredEntryCount: 1,
      requiredEntryCount: 1,
      incompleteRegistrationEntryCount: 0,
      inspectorCompletedRequiredEntryCount: 0,
      inspectorMissingRequiredEntryCount: 1,
      inspectorIncompleteValueEntryCount: 0,
      inspectorIncompleteRegistrationEntryCount: 0,
      pendingReviewCount: 1
    };
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [session], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: {
        ...session,
        missingRequiredEntryCount: 0,
        incompleteValueEntryCount: 0,
        requiredEntries: [
          {
            entryIndex: 0,
            entrySlotKind: 'single',
            entrySlotLabel: '全数',
            state: 'ready',
            entry: {
              id: 'entry-final',
              createdByEmployeeId: 'employee-operator',
              createdByEmployeeNameSnapshot: '作業者A',
              measuringInstrumentId: null,
              measuringInstrumentManagementNumberSnapshot: null,
              measuringInstrumentNameSnapshot: null,
              measuringInstrumentTagUidSnapshot: null,
              instrumentUsages: [],
              createdAt: '2026-07-27T01:00:00.000Z',
              updatedAt: '2026-07-27T01:02:03.000Z'
            },
            inspectorEntry: null,
            values: [
              {
                id: 'value-final',
                templateItemId: 'item-final',
                displayMarker: '1',
                datumSurface: 'A',
                measurementPoint: '外径',
                measurementLabel: '寸法',
                unit: 'mm',
                valueKind: 'numeric',
                value: '10.50',
                judgementResult: null,
                lowerLimit: '9.80',
                upperLimit: '10.20',
                isWithinTolerance: false,
                reviewStatus: 'PENDING',
                outOfToleranceAcknowledgedAt: '2026-07-27T01:02:03.000Z',
                approvedAt: null,
                updatedAt: '2026-07-27T01:02:03.000Z',
                inspectorValueId: null,
                inspectorValue: null,
                inspectorJudgementResult: null,
                operatorValueSnapshot: null,
                operatorJudgementResultSnapshot: null,
                differenceValue: null,
                inspectorJudgementStatus: null,
                inspectorJudgedAt: null,
                inspectorJudgementComment: null,
                inspectorUpdatedAt: null
              }
            ]
          }
        ]
      },
      isLoading: false
    });

    renderPage(
      '/kiosk/part-measurement/self-inspection/record-approvals?sessionId=session-final'
    );

    expect(await screen.findAllByText('0003958354')).toHaveLength(2);
    expect(screen.getByText('10.50 mm')).toBeInTheDocument();
    expect(screen.getByText('検査員最終判定フロー（閲覧専用）')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '検査員測定へ' })).toHaveAttribute(
      'href',
      '/kiosk/part-measurement/self-inspection/sessions/session-final/inspector'
    );
    expect(screen.queryByText('承認者NFC')).not.toBeInTheDocument();
    expect(mockUseSelfInspectionRecordApprovalSession).toHaveBeenCalledWith(
      'session-final',
      expect.any(Object)
    );
  });
});
