import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selfInspectionQueryKeys } from '../../api/queryKeys/selfInspection';

import { KioskSelfInspectionSessionPage } from './KioskSelfInspectionSessionPage';

import type {
  PartMeasurementTemplateItemDto,
  SelfInspectionEntryValuePayload,
  SelfInspectionLotEntryDto,
  SelfInspectionSessionDetailDto
} from '../../features/part-measurement/types';
import type { NfcEvent } from '../../hooks/useNfcStream';

type Api = typeof import('../../api/client');
const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn<Api['getSelfInspectionSession']>(),
  getInspectorSession: vi.fn<Api['getSelfInspectionInspectorMeasurementSession']>(),
  resolveSession: vi.fn<Api['resolveOrCreateSelfInspectionSession']>(),
  resolveTag: vi.fn<Api['resolveSelfInspectionNfcTagUid']>(),
  authenticate: vi.fn<Api['authenticateSelfInspectionMeasurementActor']>(),
  getPolicy: vi.fn<Api['getSelfInspectionRegistrationPolicy']>(),
  createEntry: vi.fn<Api['createSelfInspectionEntry']>(),
  updateEntry: vi.fn<Api['updateSelfInspectionEntry']>(),
  upsertDraft: vi.fn<Api['upsertSelfInspectionDraftEntry']>(),
  createInspectorEntry: vi.fn<Api['createSelfInspectionInspectorEntry']>(),
  updateInspectorEntry: vi.fn<Api['updateSelfInspectionInspectorEntry']>(),
  saveJudgements: vi.fn<Api['saveSelfInspectionInspectorJudgements']>(),
  complete: vi.fn<Api['completeSelfInspectionSession']>(),
  reset: vi.fn<Api['resetSelfInspectionSession']>()
}));
const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<Api>('../../api/client');
  return {
    ...actual,
    getSelfInspectionSession: apiMocks.getSession,
    getSelfInspectionInspectorMeasurementSession: apiMocks.getInspectorSession,
    resolveOrCreateSelfInspectionSession: apiMocks.resolveSession,
    resolveSelfInspectionNfcTagUid: apiMocks.resolveTag,
    authenticateSelfInspectionMeasurementActor: apiMocks.authenticate,
    getSelfInspectionRegistrationPolicy: apiMocks.getPolicy,
    createSelfInspectionEntry: apiMocks.createEntry,
    updateSelfInspectionEntry: apiMocks.updateEntry,
    upsertSelfInspectionDraftEntry: apiMocks.upsertDraft,
    createSelfInspectionInspectorEntry: apiMocks.createInspectorEntry,
    updateSelfInspectionInspectorEntry: apiMocks.updateInspectorEntry,
    saveSelfInspectionInspectorJudgements: apiMocks.saveJudgements,
    completeSelfInspectionSession: apiMocks.complete,
    resetSelfInspectionSession: apiMocks.reset
  };
});

vi.mock('../../api/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks');
  return {
    ...actual,
    useSelfInspectionRegistrationPolicy: () =>
      actual.useSelfInspectionRegistrationPolicy({ refetchIntervalMs: false })
  };
});
vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => enabled ? nfc.event : null
}));
vi.mock('../../features/part-measurement/usePartMeasurementDrawingBlobUrl', async () => {
  const actual = await vi.importActual<
    typeof import('../../features/part-measurement/usePartMeasurementDrawingBlobUrl')
  >('../../features/part-measurement/usePartMeasurementDrawingBlobUrl');
  return { ...actual, usePartMeasurementDrawingBlobUrl: () => ({ blobUrl: null, error: null }) };
});

const timestamp = '2026-10-01T00:00:00.000Z';
const numericItem: PartMeasurementTemplateItemDto = {
  id: 'diameter', sortOrder: 0, datumSurface: 'A', measurementPoint: '外径',
  measurementLabel: '外径', displayMarker: '1', unit: 'mm', allowNegative: false,
  decimalPlaces: 2, markerXRatio: null, markerYRatio: null,
  nominalValue: '10', lowerLimit: '9.90', upperLimit: '10.10', valueKind: 'numeric'
};
const judgementItem: PartMeasurementTemplateItemDto = {
  ...numericItem, id: 'thread', sortOrder: 1, measurementPoint: '管用ネジ',
  measurementLabel: '管用ネジ', displayMarker: '2', valueKind: 'judgement',
  nominalValue: null, lowerLimit: null, upperLimit: null
};

function buildEntry(value = '10.00', judgement: 'PASS' | 'FAIL' = 'PASS'): SelfInspectionLotEntryDto {
  return {
    id: 'entry-1', entryIndex: 0, entrySlotKind: 'single', entrySlotLabel: '1',
    persistenceStatus: 'confirmed', createdByEmployeeId: 'employee-1',
    createdByEmployeeNameSnapshot: '検査 太郎', measuringInstrumentId: null,
    measuringInstrumentManagementNumberSnapshot: null, measuringInstrumentNameSnapshot: null,
    measuringInstrumentTagUidSnapshot: null, instrumentUsages: [],
    createdAt: timestamp, updatedAt: timestamp,
    values: [
      { templateItemId: 'diameter', value },
      { templateItemId: 'thread', value: null, judgementResult: judgement }
    ].map((row, index) => ({
      ...row, id: `value-${index}`, reviewStatus: 'NOT_REQUIRED',
      outOfToleranceAcknowledgedAt: null, approvedAt: null,
      approvedByUserId: null, approvedByUsername: null, approvalComment: null
    }))
  };
}

function buildSession(entry?: SelfInspectionLotEntryDto): SelfInspectionSessionDetailDto {
  return {
    id: 'session-1', sessionBusinessKey: 'business-1', templateId: 'template-1',
    templateName: '軸検査', productNo: 'ORDER-100', fseiban: 'SERIAL-100',
    fhincd: 'PART-100', fhinmei: '主軸', processGroup: 'cutting', resourceCd: 'R001',
    scheduleRowId: 'schedule-1', machineName: '旋盤', plannedQuantity: 1,
    expectedEntryCount: 1, requiredEntryCount: 1, completedEntryCount: entry ? 1 : 0,
    pendingReviewCount: 0, participantEmployeeNames: entry ? ['検査 太郎'] : [],
    selfInspectionMode: 'single', selfInspectionFixedCount: null, selfInspectionSampleSize: null,
    status: entry ? 'in_progress' : 'not_started', startedAt: timestamp, completedAt: null,
    recordApprovalRequiredAt: null, recordApprovalWorkflowStartedAt: null,
    decisionWorkflow: 'LEGACY_RECORD_APPROVAL', inspectorRemeasurementRequiredAt: null,
    inspectorMeasurementState: 'not_required', inspectorRequiredEntryCount: 0,
    inspectorCompletedRequiredEntryCount: 0, inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0, updatedAt: timestamp, recordApproval: null,
    template: {
      id: 'template-1', fhincd: 'PART-100', resourceCd: 'R001', processGroup: 'cutting',
      templateScope: 'three_key', candidateFhinmei: null, name: '軸検査', version: 1,
      isActive: true, selfInspectionMode: 'single', selfInspectionFixedCount: null,
      selfInspectionSampleSize: null, visualTemplateId: null, visualTemplate: null,
      siblingGroupId: null, siblingGroup: null, items: [numericItem, judgementItem]
    },
    entries: entry ? [{ ...entry, values: [] }] : [], focusedEntry: entry ?? null
  };
}

function measurementValues(value: string, judgement: 'PASS' | 'FAIL' = 'PASS'): SelfInspectionEntryValuePayload[] {
  return [
    { templateItemId: 'diameter', value, outOfToleranceAcknowledged: undefined },
    { templateItemId: 'thread', judgementResult: judgement }
  ];
}

const basePath = '/kiosk/part-measurement/self-inspection';
let serverSession: SelfInspectionSessionDetailDto;
let queryClient: QueryClient;

function renderPage(path = `${basePath}/sessions/session-1`) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={basePath} element={<h1>自主検査一覧</h1>} />
          <Route path={`${basePath}/start`} element={<KioskSelfInspectionSessionPage />} />
          <Route path={`${basePath}/sessions/:sessionId`} element={<KioskSelfInspectionSessionPage />} />
          <Route path={`${basePath}/sessions/:sessionId/inspector`} element={<KioskSelfInspectionSessionPage mode="inspector" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(tree);
}

// Flush query/mutation notifications and their React effects, without reaching the 400 ms autosave.
async function settle() {
  for (let step = 0; step < 4; step += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  }
}

async function openAuthenticated(mode: 'operator' | 'inspector' = 'operator') {
  nfc.event = { uid: 'employee-tag', timestamp };
  renderPage(`${basePath}/sessions/session-1${mode === 'inspector' ? '/inspector' : ''}`);
  await settle();
  expect(screen.getByText(`現在の${mode === 'inspector' ? '検査員' : '測定者'}: 検査 太郎`)).toBeInTheDocument();
  expect(apiMocks.authenticate).toHaveBeenCalledWith('session-1', {
    employeeTagUid: 'employee-tag', measurementMode: mode
  });
}

function enterMeasurements(value = '10.05', judgement: 'OK' | 'NG' = 'OK') {
  fireEvent.change(screen.getByRole('textbox', { name: /測定値/ }), { target: { value } });
  fireEvent.click(within(screen.getByRole('list', { name: '測定点一覧' })).getByRole('button', { name: /管用ネジ/ }));
  fireEvent.click(within(screen.getByRole('group', { name: '管用ネジの判定' })).getByRole('button', { name: judgement }));
}

describe('KioskSelfInspectionSessionPage characterization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    nfc.event = null;
    serverSession = buildSession();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
        mutations: { retry: false, gcTime: Infinity }
      }
    });
    apiMocks.getSession.mockImplementation(async () => serverSession);
    apiMocks.getInspectorSession.mockImplementation(async () => serverSession);
    apiMocks.getPolicy.mockResolvedValue({
      key: 'default', requireMeasuringInstrumentTag: false, updatedAt: null, updatedBy: null
    });
    apiMocks.resolveTag.mockResolvedValue({
      kind: 'employee', employee: { id: 'employee-1', displayName: '検査 太郎', nfcTagUid: 'employee-tag' }
    });
    apiMocks.authenticate.mockImplementation(async (_id, body) => ({
      id: 'auth-1', measurementMode: body.measurementMode,
      employee: { id: 'employee-1', employeeCode: 'E001', displayName: '検査 太郎' },
      authenticatedAt: timestamp
    }));
    apiMocks.createEntry.mockResolvedValue(buildEntry('10.05'));
    apiMocks.updateEntry.mockResolvedValue(buildEntry('10.05'));
    apiMocks.upsertDraft.mockResolvedValue({ ...buildEntry(), persistenceStatus: 'draft' });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
  });

  it('loads the default operator route and shows the item list and NFC-gated actions', async () => {
    serverSession = {
      ...serverSession, selfInspectionMode: 'full', plannedQuantity: 3,
      expectedEntryCount: 3, requiredEntryCount: 3,
      template: { ...serverSession.template, selfInspectionMode: 'full' }
    };
    let resolveSession!: (session: SelfInspectionSessionDetailDto) => void;
    apiMocks.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    renderPage(`${basePath}/sessions/session-1?entryIndex=2`);
    expect(screen.getByText('読込中…')).toBeInTheDocument();
    await act(async () => { resolveSession(serverSession); });
    await settle();

    expect(apiMocks.getSession).toHaveBeenCalledWith('session-1', { entryIndex: 2 });
    expect(apiMocks.getInspectorSession).not.toHaveBeenCalled();
    expect(screen.getByText('製造order: ORDER-100')).toBeInTheDocument();
    expect(screen.getByText('FHINCD: PART-100')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '測定者NFCタグをスキャン' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '測定点一覧' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(within(list).getByRole('button', { name: /外径/ })).toBeDisabled();
    expect(within(list).getByRole('button', { name: /管用ネジ/ })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /測定値/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自主検査を完了' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '初期化' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '一覧へ' })).toBeEnabled();
    expect(screen.getByText('図面がありません。')).toBeInTheDocument();
  });

  it('continues displaying loading when the initial session request fails', async () => {
    apiMocks.getSession.mockRejectedValue({ response: { data: { message: 'セッション取得失敗' } } });
    renderPage();
    await settle();
    expect(queryClient.getQueryState(selfInspectionQueryKeys.session('session-1', 0))?.status).toBe('error');
    expect(apiMocks.getSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('読込中…')).toBeInTheDocument();
    expect(screen.queryByText('セッション取得失敗')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '入力を保存' })).not.toBeInTheDocument();
  });

  it('shows a start API error after resolving the URL start parameters', async () => {
    apiMocks.resolveSession.mockRejectedValue({ response: { data: { message: '開始できません' } } });
    const params = new URLSearchParams({
      templateId: 'template-1', productNo: 'ORDER-100', resourceCd: 'R001',
      fhincd: 'PART-100', fhinmei: '主軸', scheduleRowId: 'schedule-1',
      fseiban: 'SERIAL-100', processGroup: 'grinding', machineName: '研削盤'
    });
    renderPage(`${basePath}/start?${params}`);
    await settle();
    expect(apiMocks.resolveSession).toHaveBeenCalledWith(Object.fromEntries(params));
    expect(screen.getByText('開始できません')).toBeInTheDocument();
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it('creates an entry with numeric text and a PASS judgement, then disables save', async () => {
    await openAuthenticated();
    enterMeasurements();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '入力を保存' }));
    await settle();
    expect(apiMocks.createEntry).toHaveBeenCalledExactlyOnceWith('session-1', {
      entryIndex: 0, measurementActorAuthenticationId: 'auth-1',
      measuringInstrumentTagUid: null, values: measurementValues('10.05')
    });
    expect(apiMocks.updateEntry).not.toHaveBeenCalled();
    expect(apiMocks.upsertDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自主検査を完了' })).toBeEnabled();
    expect(within(screen.getByRole('list', { name: '測定点一覧' })).getByRole('button', { name: /外径/ })).toHaveTextContent('10.05');
  });

  it('updates a saved entry using its timestamp and a FAIL judgement', async () => {
    serverSession = buildSession(buildEntry());
    apiMocks.updateEntry.mockResolvedValue(buildEntry('10.05', 'FAIL'));
    await openAuthenticated();
    expect(screen.getByRole('textbox', { name: /測定値/ })).toHaveValue('10.00');
    enterMeasurements('10.05', 'NG');
    fireEvent.click(screen.getByRole('button', { name: '入力を保存' }));
    await settle();
    expect(apiMocks.updateEntry).toHaveBeenCalledExactlyOnceWith('session-1', 'entry-1', {
      measurementActorAuthenticationId: 'auth-1', measuringInstrumentTagUid: null,
      ifUnmodifiedSince: timestamp, values: measurementValues('10.05', 'FAIL')
    });
    expect(apiMocks.createEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeDisabled();
  });

  it('requires confirmation before saving an out-of-tolerance value with acknowledgement', async () => {
    serverSession = buildSession(buildEntry());
    const saved = buildEntry('10.20');
    saved.values[0] = { ...saved.values[0], reviewStatus: 'PENDING', outOfToleranceAcknowledgedAt: timestamp };
    apiMocks.updateEntry.mockResolvedValue(saved);
    await openAuthenticated();
    fireEvent.change(screen.getByRole('textbox', { name: /測定値/ }), { target: { value: '10.20' } });
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '公差外のまま進む' }));
    const dialog = screen.getByRole('dialog', { name: '公差外の測定値です' });
    fireEvent.click(within(dialog).getByRole('button', { name: '公差外のまま進む' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('公差外で確認済み')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '入力を保存' }));
    await settle();
    expect(apiMocks.updateEntry).toHaveBeenCalledExactlyOnceWith('session-1', 'entry-1', {
      measurementActorAuthenticationId: 'auth-1', measuringInstrumentTagUid: null,
      ifUnmodifiedSince: timestamp,
      values: [
        { templateItemId: 'diameter', value: '10.20', outOfToleranceAcknowledged: true },
        { templateItemId: 'thread', judgementResult: 'PASS' }
      ]
    });
  });

  it.each([
    { label: 'server response message', error: { response: { data: { message: '別の端末で更新されています' } } }, message: '別の端末で更新されています' },
    { label: 'fallback without a response message', error: {}, message: '入力の保存に失敗しました。' }
  ])('shows the $label on save failure and preserves the editable draft', async ({ error, message }) => {
    apiMocks.createEntry.mockRejectedValue(error);
    await openAuthenticated();
    enterMeasurements();
    fireEvent.click(screen.getByRole('button', { name: '入力を保存' }));
    await settle();
    expect(apiMocks.createEntry).toHaveBeenCalledExactlyOnceWith('session-1', {
      entryIndex: 0, measurementActorAuthenticationId: 'auth-1',
      measuringInstrumentTagUid: null, values: measurementValues('10.05')
    });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeEnabled();
    expect(within(screen.getByRole('list', { name: '測定点一覧' })).getByRole('button', { name: /外径/ })).toHaveTextContent('10.05');
  });

  it('completes an operator session and leaves the refreshed page read-only', async () => {
    serverSession = buildSession(buildEntry());
    apiMocks.complete.mockImplementation(async () => {
      serverSession = { ...serverSession, completedAt: timestamp, status: 'completed' };
      return serverSession;
    });
    await openAuthenticated();
    fireEvent.click(screen.getByRole('button', { name: '自主検査を完了' }));
    await settle();
    expect(apiMocks.complete).toHaveBeenCalledExactlyOnceWith('session-1');
    expect(screen.getByText('製造order: ORDER-100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自主検査を完了' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /測定値/ })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: '自主検査一覧' })).not.toBeInTheDocument();
  });

  it('ends operator measurement by returning to the list without completing an approval-required session', async () => {
    serverSession = {
      ...buildSession(buildEntry()), decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      recordApprovalRequiredAt: timestamp
    };
    await openAuthenticated();
    fireEvent.click(screen.getByRole('button', { name: '測定を終了' }));
    expect(screen.getByRole('heading', { name: '自主検査一覧' })).toBeInTheDocument();
    expect(apiMocks.complete).not.toHaveBeenCalled();
  });

  it('loads inspector mode and updates a remeasurement through the inspector API', async () => {
    serverSession = {
      ...buildSession(buildEntry()), decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      inspectorMeasurementState: 'in_progress',
      inspectorSlotStates: [{ entryIndex: 0, operatorState: 'confirmed', inspectorState: 'in_progress' }]
    };
    apiMocks.updateInspectorEntry.mockImplementation(async () => {
      const entry = buildEntry('10.05');
      serverSession = { ...serverSession, entries: [{ ...entry, values: [] }], focusedEntry: entry };
      return entry;
    });
    await openAuthenticated('inspector');
    expect(apiMocks.getInspectorSession).toHaveBeenCalledWith('session-1', { entryIndex: 0 });
    expect(apiMocks.getSession).not.toHaveBeenCalled();
    expect(screen.getByText(/検査員再測定/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '初期化' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最終判定を確定して完了' })).toBeDisabled();
    enterMeasurements();
    fireEvent.click(screen.getByRole('button', { name: '入力を保存' }));
    await settle();
    expect(apiMocks.updateInspectorEntry).toHaveBeenCalledExactlyOnceWith('session-1', 'entry-1', {
      entryIndex: 0, measurementActorAuthenticationId: 'auth-1', measuringInstrumentTagUid: null,
      ifUnmodifiedSince: timestamp, values: measurementValues('10.05')
    });
    expect(apiMocks.updateEntry).not.toHaveBeenCalled();
    expect(apiMocks.createInspectorEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '入力を保存' })).toBeDisabled();
  });

  it('saves the inspector final judgement and completes by navigating to the list', async () => {
    const entry = buildEntry();
    entry.values[0] = {
      ...entry.values[0], operatorReviewStatus: 'PENDING',
      operatorValueSnapshot: '10.20', judgementStatus: 'NOT_EVALUATED'
    };
    serverSession = {
      ...buildSession(entry), decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
      inspectorMeasurementState: 'complete', pendingReviewCount: 1,
      inspectorSlotStates: [{ entryIndex: 0, operatorState: 'confirmed', inspectorState: 'complete' }]
    };
    apiMocks.saveJudgements.mockImplementation(async () => {
      const judged = { ...entry, values: entry.values.map((value) => ({
        ...value, judgementStatus: 'FINAL_OK' as const
      })) };
      serverSession = { ...serverSession, pendingReviewCount: 0, focusedEntry: judged };
      return judged;
    });
    apiMocks.complete.mockImplementation(async () => ({
      ...serverSession, completedAt: timestamp, status: 'completed'
    }));
    await openAuthenticated('inspector');
    expect(screen.getByText('測定者NGの最終判定')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('最終判定 0/1');
    expect(screen.getByRole('button', { name: '最終判定を保存' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '最終判定を確定して完了' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '最終OK' }));
    expect(screen.getByRole('status')).toHaveTextContent('最終判定 1/1');
    fireEvent.click(screen.getByRole('button', { name: '最終判定を保存' }));
    await settle();
    expect(apiMocks.saveJudgements).toHaveBeenCalledExactlyOnceWith('session-1', 'entry-1', {
      judgements: [{ templateItemId: 'diameter', judgementStatus: 'FINAL_OK' }]
    });
    expect(screen.getByRole('button', { name: '最終判定を確定して完了' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '最終判定を確定して完了' }));
    await settle();
    expect(apiMocks.complete).toHaveBeenCalledExactlyOnceWith('session-1');
    expect(screen.getByRole('heading', { name: '自主検査一覧' })).toBeInTheDocument();
  });
});
