import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIOSK_SELF_INSPECTION_LIST_PATH } from '../../features/part-measurement/selfInspectionRoutes';

import { KioskSelfInspectionRecordApprovalPage } from './KioskSelfInspectionRecordApprovalPage';

const mockUseSelfInspectionRegistrationPolicy = vi.fn();
const mockUpdateRegistrationPolicy = vi.fn();
const mockUseSelfInspectionRecordApprovals = vi.fn();
const mockUseSelfInspectionRecordApprovalSession = vi.fn();
const mockUseResolveApprover = vi.fn();
const mockUseApproveRecordApproval = vi.fn();
const mockUseSelfInspectionInvalidations = vi.fn();
const mockUseSelfInspectionInvalidation = vi.fn();
const mockGetResolvedClientKey = vi.fn();

const nfcState: {
  event: { uid: string; timestamp: string } | null;
  enabledCalls: boolean[];
} = { event: null, enabledCalls: [] };

vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => mockGetResolvedClientKey()
}));

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
  useSelfInspectionInvalidations: (...args: unknown[]) =>
    mockUseSelfInspectionInvalidations(...args),
  useSelfInspectionInvalidation: (...args: unknown[]) =>
    mockUseSelfInspectionInvalidation(...args),
  useResolveSelfInspectionRecordApprovalApprover: () => mockUseResolveApprover(),
  useApproveSelfInspectionRecordApproval: () => mockUseApproveRecordApproval()
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => {
    nfcState.enabledCalls.push(enabled);
    return enabled ? nfcState.event : null;
  }
}));

function makeSession(
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    id,
    sessionBusinessKey: `business-${id}`,
    templateId: 'template-1',
    templateName: '自主検査テンプレート',
    productNo: `ORDER-${id}`,
    fseiban: 'SEIBAN-1',
    fhincd: 'FH-1',
    fhinmei: '確認品',
    processGroup: 'cutting',
    resourceCd: '581',
    scheduleRowId: 'schedule-1',
    machineName: '設備A',
    plannedQuantity: 1,
    expectedEntryCount: 1,
    requiredEntryCount: 1,
    completedEntryCount: 1,
    pendingReviewCount: 0,
    participantEmployeeNames: ['作業者A'],
    participantEmployees: [],
    selfInspectionMode: 'all',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'review_pending',
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: null,
    recordApprovalRequiredAt: '2026-08-21T00:00:00.000Z',
    recordApprovalWorkflowStartedAt: '2026-08-21T00:00:00.000Z',
    decisionWorkflow: 'LEGACY_RECORD_APPROVAL',
    inspectorRemeasurementRequiredAt: null,
    inspectorMeasurementState: 'not_required',
    inspectorRequiredEntryCount: 0,
    inspectorCompletedRequiredEntryCount: 0,
    inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0,
    updatedAt: '2026-08-21T01:02:03.000Z',
    recordApprovalState: 'input_incomplete',
    recordApproval: null,
    completedRequiredEntryCount: 1,
    missingRequiredEntryCount: 0,
    incompleteValueEntryCount: 0,
    incompleteRegistrationEntryCount: 0,
    inspectorIncompleteRegistrationEntryCount: 0,
    ...overrides
  };
}

function makeDetail(session: ReturnType<typeof makeSession>) {
  return { ...session, requiredEntries: [] };
}

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
        <Route
          path={KIOSK_SELF_INSPECTION_LIST_PATH}
          element={<div>自主検査一覧</div>}
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
    mockUseSelfInspectionInvalidations.mockReset();
    mockUseSelfInspectionInvalidation.mockReset();
    mockGetResolvedClientKey.mockReset();
    nfcState.event = null;
    nfcState.enabledCalls = [];
    vi.spyOn(window, 'prompt').mockReturnValue(null);

    mockGetResolvedClientKey.mockReturnValue('client-key-test');
    mockUseSelfInspectionRegistrationPolicy.mockReturnValue({
      data: {
        key: 'shared',
        requireMeasuringInstrumentTag: false,
        updatedAt: null,
        updatedBy: null
      },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovals.mockImplementation((params: { scope?: string }) => ({
      data: {
        sessions: params.scope === 'completed_records' ? [] : [],
        listLimit: 200,
        truncated: false
      },
      isLoading: false
    }));
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: null,
      isLoading: false
    });
    mockUseSelfInspectionInvalidations.mockReturnValue({
      data: { invalidations: [], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionInvalidation.mockReturnValue({ data: null, isLoading: false });
    mockUseResolveApprover.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false
    });
    mockUseApproveRecordApproval.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false
    });
    mockUpdateRegistrationPolicy.mockResolvedValue({
      key: 'shared',
      requireMeasuringInstrumentTag: true,
      updatedAt: '2026-08-21T00:00:00.000Z',
      updatedBy: 'kiosk'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads readable queries immediately with the resolved client key and never calls the old gate', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockUseSelfInspectionRegistrationPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, clientKey: 'client-key-test' })
      );
      expect(mockUseSelfInspectionRecordApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'active' }),
        expect.objectContaining({ enabled: true, clientKey: 'client-key-test' })
      );
      expect(mockUseSelfInspectionInvalidations).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ enabled: true, clientKey: 'client-key-test' })
      );
    });
    expect(mockUseSelfInspectionRecordApprovalSession).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ enabled: false, clientKey: 'client-key-test' })
    );
    expect(screen.getByText('作業者・検査員の入力値と、承認・最終判定の進捗を確認します。')).toBeInTheDocument();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '未完了' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '完了記録' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '削除履歴' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('provides a canonical return link to the self-inspection list in the header', async () => {
    renderPage();

    const returnLink = screen.getByRole('link', { name: '自主検査画面へ戻る' });
    expect(returnLink).toHaveAttribute('href', KIOSK_SELF_INSPECTION_LIST_PATH);

    fireEvent.click(returnLink);
    expect(await screen.findByText('自主検査一覧')).toBeInTheDocument();
  });

  it('maps completed_records to scope and resets selection/operation state on category changes', async () => {
    const session = makeSession('active-1', { recordApprovalState: 'approvable' });
    mockUseSelfInspectionRecordApprovals.mockImplementation((params: { scope?: string }) => ({
      data: {
        sessions: params.scope === 'completed_records' ? [] : [session],
        listLimit: 200,
        truncated: false
      },
      isLoading: false
    }));
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: makeDetail(session),
      isLoading: false
    });

    renderPage();
    await screen.findAllByText('ORDER-active-1');
    fireEvent.click(screen.getByRole('button', { name: '承認を開始' }));
    expect(nfcState.enabledCalls.at(-1)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '完了記録' }));
    await waitFor(() => {
      expect(mockUseSelfInspectionRecordApprovals).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'completed_records' }),
        expect.objectContaining({ enabled: true })
      );
    });
    expect(screen.getByRole('button', { name: '完了記録' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument();
    expect(nfcState.enabledCalls.at(-1)).toBe(false);
  });

  it('shows truncation only when the API reports more than 200 records', async () => {
    const session = makeSession('truncated');
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [session], listLimit: 200, truncated: true },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: makeDetail(session),
      isLoading: false
    });

    renderPage();
    expect(await screen.findByText(/200件超のため/)).toBeInTheDocument();
  });

  it('uses an operation-time password dialog for one policy PUT and never mutates on cancel or blank input', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '計測機器の使用前点検必須 OFF' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(mockUpdateRegistrationPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '計測機器の使用前点検必須 OFF' }));
    fireEvent.click(screen.getByRole('button', { name: '変更する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作時パスワードを入力してください');
    expect(mockUpdateRegistrationPolicy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('操作時パスワード'), {
      target: { value: 'operation-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: '変更する' }));
    await waitFor(() => {
      expect(mockUpdateRegistrationPolicy).toHaveBeenCalledTimes(1);
      expect(mockUpdateRegistrationPolicy).toHaveBeenCalledWith({
        requireMeasuringInstrumentTag: true,
        accessPassword: 'operation-secret'
      });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('計測機器の使用前点検必須をONにしました。')).toBeInTheDocument();
  });

  it('keeps NFC off until approval is explicitly started and disables it while resolving a tag', async () => {
    const session = makeSession('approvable-1', { recordApprovalState: 'approvable' });
    const detail = makeDetail(session);
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [session], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({ data: detail, isLoading: false });
    let resolveApprover: ((value: unknown) => void) | undefined;
    const resolvePromise = new Promise((resolve) => {
      resolveApprover = resolve;
    });
    const mutateApprover = vi.fn(() => resolvePromise);
    mockUseResolveApprover.mockReturnValue({ mutateAsync: mutateApprover, isPending: true });

    const view = renderPage();
    await screen.findAllByText('ORDER-approvable-1');
    expect(nfcState.enabledCalls.at(-1)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '承認を開始' }));
    expect(nfcState.enabledCalls.at(-1)).toBe(true);

    nfcState.event = { uid: 'employee-tag', timestamp: '2026-08-21T01:00:00.000Z' };
    await act(async () => {
      view.rerender(
        <MemoryRouter initialEntries={['/kiosk/part-measurement/self-inspection/record-approvals']}>
          <Routes>
            <Route
              path="/kiosk/part-measurement/self-inspection/record-approvals"
              element={<KioskSelfInspectionRecordApprovalPage />}
            />
          </Routes>
        </MemoryRouter>
      );
    });
    await waitFor(() => expect(mutateApprover).toHaveBeenCalledWith({ uid: 'employee-tag' }));
    expect(nfcState.enabledCalls.at(-1)).toBe(false);

    await act(async () => {
      resolveApprover?.({
        kind: 'employee',
        employee: {
          id: 'employee-1',
          employeeCode: 'E001',
          displayName: '承認者A',
          nfcTagUid: 'employee-tag'
        }
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('承認者A を承認者として読み取りました。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByText('承認者A')).not.toBeInTheDocument();
    expect(nfcState.enabledCalls.at(-1)).toBe(false);
  });

  it('keeps inspector-final records read-only and renders deletion history without approval controls', async () => {
    const inspectorSession = makeSession('inspector-final', {
      decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      recordApprovalState: 'inspector_measurement_pending'
    });
    mockUseSelfInspectionRecordApprovals.mockReturnValue({
      data: { sessions: [inspectorSession], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionRecordApprovalSession.mockReturnValue({
      data: makeDetail(inspectorSession),
      isLoading: false
    });

    const invalidation = {
      id: 'invalidation-1',
      itemBusinessKey: 'item-1',
      requestId: 'request-1',
      sessionId: null,
      scheduleRowId: 'schedule-1',
      sourceState: 'NOT_STARTED',
      templateIdSnapshot: 'template-1',
      productNoSnapshot: 'ORDER-DELETED',
      processGroupSnapshot: 'CUTTING',
      resourceCdSnapshot: '581',
      fseibanSnapshot: null,
      fhincdSnapshot: 'FH-1',
      fhinmeiSnapshot: '削除品',
      machineNameSnapshot: null,
      plannedQuantitySnapshot: 1,
      expectedEntryCountSnapshot: 1,
      reason: '日程から除外されたため',
      invalidatedByUsernameSnapshot: 'leader',
      invalidatedByClientDeviceId: 'device-1',
      invalidatedByClientDeviceNameSnapshot: 'Kiosk A',
      invalidatedAt: '2026-08-21T01:02:03.000Z',
      createdAt: '2026-08-21T01:02:03.000Z'
    };
    mockUseSelfInspectionInvalidations.mockReturnValue({
      data: { invalidations: [invalidation], listLimit: 200, truncated: false },
      isLoading: false
    });
    mockUseSelfInspectionInvalidation.mockReturnValue({
      data: { ...invalidation, session: null },
      isLoading: false
    });

    renderPage();
    expect(await screen.findByText('検査員最終判定フロー（閲覧専用）')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '承認を開始' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '削除履歴' }));
    expect(await screen.findByText('削除済み・閲覧専用')).toBeInTheDocument();
    expect(screen.getByText('未開始で削除されたため、測定履歴はありません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /計測機器の使用前点検必須/ })).not.toBeInTheDocument();
  });
});
