import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyWorkSessionPage } from './KioskAssemblyWorkSessionPage';

import type { AssemblyProcedureSequenceDto, AssemblyWorkSessionDto } from '../../features/assembly/types';

const mockGetAssemblyWorkSession = vi.fn();
const mockGetHermesGuide = vi.fn();
const mockGetProcedureSequence = vi.fn();
const mockRecordAssemblyTorque = vi.fn();
const mockAdvanceAssemblyArea = vi.fn();
const mockRestartAssemblyArea = vi.fn();
const mockCompleteAssemblyWorkSession = vi.fn();
const mockListCompatibleTorqueWrenches = vi.fn();
const mockListCurrentTorqueWrenchConfirmations = vi.fn();
const mockConfirmAssemblyTorqueWrench = vi.fn();
const mockRecordAssemblyOperatorAccess = vi.fn();
let mockNfcEvent: { uid: string; timestamp: string } | null = null;

vi.mock('../../api/client', () => ({
  getAssemblyWorkSession: (...args: unknown[]) => mockGetAssemblyWorkSession(...args),
  getBusinessHermesAssemblyGuide: (...args: unknown[]) => mockGetHermesGuide(...args),
  getAssemblyWorkSessionProcedureSequence: (...args: unknown[]) => mockGetProcedureSequence(...args),
  recordAssemblyTorque: (...args: unknown[]) => mockRecordAssemblyTorque(...args),
  recordAssemblyCheck: vi.fn(),
  advanceAssemblyArea: (...args: unknown[]) => mockAdvanceAssemblyArea(...args),
  restartAssemblyArea: (...args: unknown[]) => mockRestartAssemblyArea(...args),
  completeAssemblyWorkSession: (...args: unknown[]) => mockCompleteAssemblyWorkSession(...args),
  listCompatibleTorqueWrenchesForSession: (...args: unknown[]) => mockListCompatibleTorqueWrenches(...args),
  listCurrentTorqueWrenchConfirmations: (...args: unknown[]) => mockListCurrentTorqueWrenchConfirmations(...args),
  confirmAssemblyTorqueWrench: (...args: unknown[]) => mockConfirmAssemblyTorqueWrench(...args),
  recordAssemblyOperatorAccess: (...args: unknown[]) => mockRecordAssemblyOperatorAccess(...args),
  resolveKioskDocumentPageImageUrl: (path: string) => path
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: () => mockNfcEvent
}));

vi.mock('../../features/assembly', async () => {
  const actual = await vi.importActual<typeof import('../../features/assembly')>('../../features/assembly');
  return {
    ...actual,
    AssemblyProcedureCanvas: () => <div data-testid="legacy-assembly-procedure-canvas" />
  };
});

const session: AssemblyWorkSessionDto = {
  id: 'session-1',
  workUnitId: 'work-unit-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'in_progress',
  productNo: 'ASM-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorEmployeeId: null,
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MH-AX',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  currentAreaId: 'area-1',
  currentBoltId: 'bolt-1',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MH-AX',
    procedurePattern: '標準',
    name: 'MH-AX 標準',
    traceabilityMode: 'LEGACY',
    version: 1,
    isActive: true,
    procedureDocumentId: 'procedure-1',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    procedureDocument: {
      id: 'procedure-1',
      name: '単一画像手順書',
      imageRelativePath: '/api/storage/assembly-procedure-images/procedure.png',
      isActive: true,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    },
    areas: [
      {
        id: 'area-1',
        templateId: 'template-1',
        sortOrder: 0,
        processNo: '7',
        areaCode: 'A',
        areaName: 'ストッパー取付',
        unitCode: 'U1',
        requireManualAdvance: true,
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        bolts: [
          {
            id: 'bolt-1',
            areaId: 'area-1',
            sortOrder: 0,
            tighteningId: 'BOLT-1',
            markerNo: 1,
            xRatio: '0.25',
            yRatio: '0.25',
            boltSpec: 'M8',
            nominalTorque: '10',
            lowerLimit: '9',
            upperLimit: '11',
            unit: 'N-m',
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:00:00.000Z'
          }
        ]
      }
    ]
  },
  torqueRecords: [],
  restartLogs: []
};

const requiredSession: AssemblyWorkSessionDto = {
  ...session,
  template: {
    ...session.template,
    traceabilityMode: 'REQUIRED',
    areas: session.template.areas.map((area) => ({
      ...area,
      bolts: area.bolts.map((bolt) => ({
        ...bolt,
        nominalDiameter: 'M8',
        boltLengthMm: '35',
        material: 'SCM435',
        strengthClass: '10.9',
        capabilityGroupId: 'group-1'
      }))
    }))
  }
};

const compatibleTorqueWrenches = [{
  profile: {
    id: 'profile-1',
    serialNumber: 'TW-A103',
    model: { modelNumber: 'CEM20N3X10D-BTLA', settingVerificationMode: 'REGISTERED_SETTING' },
    settingHistories: [{ nominalTorque: '10', unit: 'N·m' }]
  },
  conditionFingerprint: 'condition-1'
}];

const boltConditionTorqueWrenches = [{
  profile: {
    id: 'profile-bolt-1',
    serialNumber: 'TW-BOLT-01',
    model: { modelNumber: 'CEM20N3X10D-BTLA', settingVerificationMode: 'BOLT_CONDITION_ONLY' },
    settingHistories: []
  },
  conditionFingerprint: 'condition-bolt-1'
}];

const reusableTorqueConfirmation = [{
  id: 'confirmation-1',
  torqueWrenchProfileId: 'profile-1',
  settingHistoryId: 'setting-1',
  settingVerificationMode: 'REGISTERED_SETTING',
  target: { lowerLimit: '9', nominalTorque: '10', upperLimit: '11', unit: 'N-m' }
}];

function agentStatus(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    ready: false,
    state: 'available',
    owner: null,
    bound: false,
    leaseOwned: false,
    bluetoothPowered: false,
    hidExclusive: false,
    lastError: null,
    ...overrides
  };
}

function jsonResponse(payload: object) {
  return { ok: true, status: 200, json: async () => payload };
}

const configuredSequence: AssemblyProcedureSequenceDto = {
  mode: 'configured',
  source: 'template_version',
  reason: null,
  machineName: 'MH-AX',
  machineNameKey: 'MH-AX',
  fallbackProcedureDocument: {
    id: 'procedure-1',
    name: '単一画像手順書',
    imageRelativePath: '/api/storage/assembly-procedure-images/procedure.png'
  },
  documents: [
    {
      orderItemId: 'item-1',
      sortOrder: 0,
      label: 'X軸',
      documentType: 'kiosk_document',
      kioskDocumentId: 'doc-1',
      assemblyProcedureDocumentId: null,
      title: 'MH-AX X軸要領書',
      displayTitle: 'X軸要領書',
      filename: 'x.pdf',
      confirmedDocumentNumber: '産1-G025AAK',
      confirmedSummaryText: 'X軸',
      pageCount: 2,
      updatedAt: '2026-07-06T00:00:00.000Z',
      pageUrls: ['/api/storage/pdf-pages/doc-1/page-1.jpg', '/api/storage/pdf-pages/doc-1/page-2.jpg']
    }
  ]
};

const expandedFallbackSequence: AssemblyProcedureSequenceDto = {
  mode: 'fallback',
  source: 'primary_fallback',
  reason: 'not_configured',
  machineName: 'MH-AX',
  machineNameKey: 'MH-AX',
  fallbackProcedureDocument: {
    id: 'procedure-1',
    name: '単一画像手順書',
    imageRelativePath: '/api/storage/assembly-procedure-images/procedure.png'
  },
  documents: [
    {
      orderItemId: '',
      sortOrder: 0,
      label: null,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: 'procedure-1',
      title: '単一画像手順書',
      displayTitle: null,
      filename: '単一画像手順書',
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: 1,
      updatedAt: '2026-07-06T00:00:00.000Z',
      pageUrls: ['/api/storage/assembly-procedure-images/procedure.png'],
      pages: [
        {
          source: 'assembly_procedure_document',
          documentId: 'procedure-1',
          pageIndex: 0,
          pageUrl: '/api/storage/assembly-procedure-images/procedure.png'
        }
      ]
    }
  ],
  stepSource: 'document_expansion',
  steps: [
    {
      id: 'document-expansion:assembly_procedure_document:procedure-1:0',
      sortOrder: 0,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: 'procedure-1',
      pageIndex: 0,
      viewMode: 'full_page',
      cropXRatio: null,
      cropYRatio: null,
      cropWidthRatio: null,
      cropHeightRatio: null,
      title: null,
      instructionText: null,
      emphasis: 'normal',
      documentType: 'assembly_procedure_document',
      documentTitle: '単一画像手順書',
      pageUrl: '/api/storage/assembly-procedure-images/procedure.png'
    }
  ]
};

function renderPage(withAccessGrant = true) {
  return render(
    <MemoryRouter
      initialEntries={[{
        pathname: '/kiosk/assembly/work-sessions/session-1',
        state: withAccessGrant
          ? { assemblyOperatorAccessGrant: { sessionId: 'session-1', requestId: 'request-1' } }
          : null
      }]}
    >
      <Routes>
        <Route path="/kiosk/assembly/work-sessions/:sessionId" element={<KioskAssemblyWorkSessionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyWorkSessionPage procedure sequence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockGetAssemblyWorkSession.mockReset();
    mockGetHermesGuide.mockReset();
    mockGetProcedureSequence.mockReset();
    mockRecordAssemblyTorque.mockReset();
    mockAdvanceAssemblyArea.mockReset();
    mockRestartAssemblyArea.mockReset();
    mockCompleteAssemblyWorkSession.mockReset();
    mockListCompatibleTorqueWrenches.mockReset();
    mockListCurrentTorqueWrenchConfirmations.mockReset();
    mockConfirmAssemblyTorqueWrench.mockReset();
    mockRecordAssemblyOperatorAccess.mockReset();
    mockNfcEvent = null;
    mockGetAssemblyWorkSession.mockResolvedValue(session);
    mockGetProcedureSequence.mockResolvedValue(configuredSequence);
    mockRecordAssemblyOperatorAccess.mockResolvedValue(session);
  });

  it('requires NFC on a direct resume and starts no procedure or wrench side effects before access', async () => {
    renderPage(false);

    expect(await screen.findByRole('dialog', { name: '作業者確認' })).toBeInTheDocument();
    expect(mockGetProcedureSequence).not.toHaveBeenCalled();
    expect(mockListCompatibleTorqueWrenches).not.toHaveBeenCalled();
    expect(screen.queryByText('要領書を準備しています')).not.toBeInTheDocument();
  });

  it('records RESUME access from the NFC gate before starting procedure side effects', async () => {
    mockNfcEvent = { uid: 'NFC-RESUME', timestamp: '2099-01-01T00:00:00.000Z' };
    renderPage(false);

    await waitFor(() =>
      expect(mockRecordAssemblyOperatorAccess).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          operatorNfcTagUid: 'NFC-RESUME',
          requestId: expect.any(String)
        })
      )
    );
    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-1'));
  });

  it('renders operator header without template or excel actions', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '組立作業' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '組立トップ' })).toHaveAttribute('href', '/kiosk/assembly');
    expect(screen.queryByRole('link', { name: 'テンプレ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excel' })).not.toBeInTheDocument();
    expect(screen.queryByText('要領書 / ページ送り')).not.toBeInTheDocument();
    // sequence 解決後にモード文言が「要領書」へ切り替わる（「要領書を確認中」との部分一致を避ける）
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '要領書')).toBeInTheDocument();
    });
    expect(screen.queryByText('BOLT-1')).not.toBeInTheDocument();
    expect(screen.getAllByText('丸数字 1').length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the process position when the current area name is blank', async () => {
    mockGetAssemblyWorkSession.mockResolvedValueOnce({
      ...session,
      template: {
        ...session.template,
        areas: session.template.areas.map((area) => ({
          ...area,
          sortOrder: 1,
          areaName: ''
        }))
      }
    });

    renderPage();

    expect(await screen.findByText('工程2')).toBeInTheDocument();
  });

  it('renders configured PDF procedure sequence with flat step navigation', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '組立作業' })).toBeInTheDocument();
    // session 取得直後は sequence 未解決で fallback になり得るため、configured UI を待つ
    expect(
      await screen.findByText(/手順 1\/2/, undefined, { timeout: 5000 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次手順' }));
    // CIランナーが遅い場合に1秒のデフォルトwaitForで拾えずフレークするため延長
    await waitFor(() => expect(screen.getByText(/手順 2\/2/)).toBeInTheDocument(), {
      timeout: 5000
    });
  });

  it('renders document-expanded fallback procedures in the new step viewer', async () => {
    mockGetProcedureSequence.mockResolvedValue(expandedFallbackSequence);
    renderPage();

    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-1'));
    expect(await screen.findByText(/手順 1\/1/)).toBeInTheDocument();
    expect(screen.getByText((_, element) =>
      element?.tagName === 'SPAN' && element.textContent === '要領書'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BOLT-1' })).toHaveAttribute(
      'data-marker-id',
      'bolt-1'
    );
    expect(screen.getByRole('button', { name: '全手順' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現在の丸数字へ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前手順' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '次手順' })).toBeDisabled();
  });

  it('shows only the new procedure loading state before the sequence resolves', async () => {
    let resolveSequence!: (sequence: AssemblyProcedureSequenceDto) => void;
    mockGetProcedureSequence.mockReturnValue(new Promise((resolve) => {
      resolveSequence = resolve;
    }));
    renderPage();

    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-1'));
    expect(screen.getByText('要領書を準備しています')).toBeInTheDocument();
    expect(screen.queryByTestId('assembly-procedure-image-with-markers')).not.toBeInTheDocument();

    resolveSequence(expandedFallbackSequence);
    expect(await screen.findByText(/手順 1\/1/)).toBeInTheDocument();
  });

  it('keeps torque recording available when Hermes is unavailable', async () => {
    mockGetHermesGuide.mockImplementation((_sessionId: string, payload: { uiRevision: string }) => Promise.resolve({ status: 'unavailable', uiRevision: payload.uiRevision, message: null, targetKey: null, evidence: [] }));
    mockRecordAssemblyTorque.mockResolvedValue({
      session,
      outcome: { kind: 'accepted_ok' }
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Hermesに確認' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hermesに確認' }));
    await screen.findByText('案内は現在利用できません。作業画面はそのまま使用できます。');
    fireEvent.change(screen.getByPlaceholderText('トルク値'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'トルク記録' }));
    await waitFor(() => expect(mockRecordAssemblyTorque).toHaveBeenCalledWith('session-1', expect.objectContaining({ value: 10 })));
  });

  it('does not render an Hermes response after the work target changes', async () => {
    let resolveGuide: ((value: unknown) => void) | null = null;
    mockGetHermesGuide.mockReturnValue(new Promise((resolve) => { resolveGuide = resolve; }));
    const updatedSession = {
      ...session,
      currentBoltId: null,
      updatedAt: '2026-07-06T00:00:01.000Z'
    };
    mockRecordAssemblyTorque.mockResolvedValue({ session: updatedSession, outcome: { kind: 'accepted_ok' } });
    renderPage();

    await screen.findByRole('button', { name: 'Hermesに確認' });
    fireEvent.click(screen.getByRole('button', { name: 'Hermesに確認' }));
    fireEvent.change(screen.getByPlaceholderText('トルク値'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'トルク記録' }));
    await waitFor(() => expect(mockRecordAssemblyTorque).toHaveBeenCalled());
    resolveGuide?.({
      status: 'ready',
      uiRevision: 'old-revision',
      message: '古い対象への案内',
      targetKey: 'current-bolt',
      evidence: []
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('古い対象への案内')).not.toBeInTheDocument();
  });

  it('retries a failed sequence request without showing the legacy procedure canvas', async () => {
    mockGetProcedureSequence
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(expandedFallbackSequence);
    renderPage();

    expect(await screen.findByText('要領書の取得に失敗しました。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(screen.getByText('要領書を準備しています')).toBeInTheDocument();
    expect(await screen.findByText(/手順 1\/1/)).toBeInTheDocument();
    expect(mockGetProcedureSequence).toHaveBeenCalledTimes(2);
  });

  it('uses the new viewer empty state when no procedure page is available', async () => {
    mockGetProcedureSequence.mockResolvedValue({
      ...expandedFallbackSequence,
      documents: [],
      steps: []
    });
    renderPage();

    expect(await screen.findByText('表示できる要領書ページがありません')).toBeInTheDocument();
    expect(screen.getByText((_, element) =>
      element?.tagName === 'SPAN' && element.textContent === '要領書'
    )).toBeInTheDocument();
  });

  it('checks loopback health before confirmation without reporting false availability or acquiring a lease', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue([]);
    const agentFetch = vi.fn().mockResolvedValue(jsonResponse(agentStatus()));
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    expect(await screen.findByText('現物確認待ち')).toBeInTheDocument();
    expect(screen.queryByText('通信断')).not.toBeInTheDocument();
    expect(screen.queryByText('使用可能')).not.toBeInTheDocument();
    expect(agentFetch.mock.calls.some(([url, init]) =>
      String(url).endsWith('/health') && (init as RequestInit | undefined)?.method === undefined
    )).toBe(true);
    expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/heartbeat'))).toBe(false);
    expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/acquire'))).toBe(false);
  });

  it('reports an observed loopback failure and recovers to physical-confirmation wait', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue([]);
    let healthAttempts = 0;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/health')) {
        healthAttempts += 1;
        if (healthAttempts === 1) return Promise.reject(new TypeError('connection refused'));
      }
      return Promise.resolve(jsonResponse(agentStatus()));
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    expect(await screen.findByText('通信断')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('現物確認待ち')).toBeInTheDocument(), { timeout: 3500 });
    expect(screen.queryByText('torque-agentとの通信が切れました。接続状態を確認してください。')).not.toBeInTheDocument();
    expect(healthAttempts).toBeGreaterThanOrEqual(2);
  });

  it('reuses physical confirmation but requires an explicit connection-lease start action', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    const agentFetch = vi.fn().mockResolvedValue(jsonResponse(agentStatus()));
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    expect(await screen.findByText('同じ締付条件の現物確認を引継ぎ済み・使用開始が必要です')).toBeInTheDocument();
    const tighteningPane = screen.getByRole('heading', { name: '締付' }).closest('section');
    expect(tighteningPane).not.toBeNull();
    expect(tighteningPane).toHaveClass('overflow-x-hidden', 'overflow-y-auto');
    expect(screen.getByLabelText('使用する物理トルクレンチ')).toHaveClass('w-full', 'min-w-0', 'max-w-full');
    expect(screen.getByText('使用開始待ち')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現物確認済み' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'このレンチを使用開始' })).toBeEnabled();
    expect(mockListCurrentTorqueWrenchConfirmations).toHaveBeenCalledWith('session-1');
    expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/acquire'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'このレンチを使用開始' }));
    await waitFor(() => {
      expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/acquire'))).toBe(true);
    });
  });

  it('refreshes the right-pane history immediately after a committed torque notification', async () => {
    class MockWebSocket {
      static instance: MockWebSocket | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(public readonly url: string) {
        MockWebSocket.instance = this;
      }

      close() {
        return undefined;
      }
    }

    const committedSession: AssemblyWorkSessionDto = {
      ...requiredSession,
      torqueRecords: [{
        id: 'record-1',
        sessionId: 'session-1',
        templateBoltId: 'bolt-1',
        attempt: 1,
        inputSource: 'agent',
        value: '4.24',
        judgement: 'ok',
        accepted: true,
        ignoredReason: null,
        serialNumberSnapshot: 'TW-A103',
        sourceEventKey: 'event-1',
        recordedAt: '2026-07-24T00:00:00.000Z',
        createdAt: '2026-07-24T00:00:00.000Z',
        tighteningId: 'BOLT-1',
        markerNo: 1,
        areaId: 'area-1',
        areaName: 'ストッパー取付'
      }]
    };
    mockGetAssemblyWorkSession
      .mockResolvedValueOnce(requiredSession)
      .mockResolvedValue(committedSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(agentStatus())));

    renderPage();

    await screen.findByText('同じ締付条件の現物確認を引継ぎ済み・使用開始が必要です');
    await waitFor(() => expect(MockWebSocket.instance).not.toBeNull());
    act(() => {
      MockWebSocket.instance?.onmessage?.({
        data: JSON.stringify({
          type: 'torqueRecordCommitted',
          sessionId: 'session-1',
          sourceEventKey: 'event-1',
          capturedAt: '2026-07-24T00:00:00.000Z',
          acknowledgedAt: '2026-07-24T00:00:00.050Z'
        })
      } as MessageEvent);
    });

    expect(await screen.findByText('4.24')).toBeInTheDocument();
    expect(screen.getByText('4.24')).toHaveClass('text-2xl', 'font-bold', 'tabular-nums');
    expect(screen.getByText('OK')).toHaveClass('text-2xl', 'font-bold', 'tabular-nums');
    expect(screen.getByText('丸数字 1 / TW-A103')).toBeInTheDocument();
    expect(mockGetAssemblyWorkSession).toHaveBeenCalledTimes(2);
  });

  it('enables and highlights manual torque recording only for a valid numeric value', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '組立作業' });

    const recordButton = screen.getByRole('button', { name: 'トルク記録' });
    expect(recordButton).toBeDisabled();
    expect(recordButton).not.toHaveClass('bg-emerald-500');

    fireEvent.change(screen.getByPlaceholderText('トルク値'), { target: { value: 'invalid' } });
    expect(recordButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('トルク値'), { target: { value: '10.5' } });
    expect(recordButton).toBeEnabled();
    expect(recordButton).toHaveClass('bg-emerald-500');
  });

  it('reports a failed explicit acquire request as loopback communication loss', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/lease/acquire')) {
        return Promise.reject(new TypeError('connection refused'));
      }
      return Promise.resolve(jsonResponse(agentStatus()));
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'このレンチを使用開始' }));
    expect(await screen.findByText('通信断')).toBeInTheDocument();
    expect(screen.getByText('torque-agentとの通信が切れました。接続状態を確認してください。')).toBeInTheDocument();
  });

  it('blocks rapid click-through and requires a delayed physical-presence checkbox before takeover', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    const remoteOwner = agentStatus({
      state: 'owned_by_other',
      owner: { clientDeviceName: 'StoneBase', clientDeviceLocation: '1F' },
      lastError: 'TORQUE_WRENCH_LEASE_HELD'
    });
    let acquireAttempted = false;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/lease/takeover')) {
        return Promise.resolve(jsonResponse(agentStatus({ state: 'handoff_wait', leaseOwned: true })));
      }
      if (String(url).endsWith('/lease/acquire')) acquireAttempted = true;
      return Promise.resolve(jsonResponse(acquireAttempted ? remoteOwner : agentStatus()));
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'このレンチを使用開始' }));
    expect(await screen.findByText((_, element) => element?.textContent === 'StoneBase（1F） が使用中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '現物が手元にあるため引き継ぐ' }));
    expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/takeover'))).toBe(false);
    expect(screen.getByText('レンチ本体がこの端末の前にあることを、もう一度確認してください。')).toBeInTheDocument();
    const presenceCheckbox = screen.getByRole('checkbox', { name: 'レンチ本体がこの端末の前にあることを確認しました' });
    const takeoverButton = screen.getByRole('button', { name: '確認して接続権を引き継ぐ' });
    expect(presenceCheckbox).toBeDisabled();
    expect(takeoverButton).toBeDisabled();

    presenceCheckbox.click();
    takeoverButton.click();
    expect(presenceCheckbox).not.toBeChecked();
    expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/takeover'))).toBe(false);

    await waitFor(() => expect(presenceCheckbox).toBeEnabled(), { timeout: 3000 });
    expect(takeoverButton).toBeDisabled();
    fireEvent.click(presenceCheckbox);
    expect(takeoverButton).toBeEnabled();
    fireEvent.click(takeoverButton);
    await waitFor(() => {
      expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/takeover'))).toBe(true);
      expect(screen.getByText('引継ぎ待機中')).toBeInTheDocument();
    });
  });

  it('renders Bluetooth waiting and ready states and explicitly releases ownership', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    let heartbeatCount = 0;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/lease/release')) return Promise.resolve(jsonResponse(agentStatus()));
      if (String(url).endsWith('/health')) return Promise.resolve(jsonResponse(agentStatus()));
      heartbeatCount += 1;
      return Promise.resolve(jsonResponse(agentStatus({
        state: 'owned_by_self',
        leaseOwned: true,
        selfOwnedToken: {
          targetKind: 'assembly',
          sessionId: 'session-1',
          torqueWrenchProfileId: 'profile-1',
          leaseId: 'lease-1',
          generation: 1
        },
        ready: heartbeatCount > 1,
        bluetoothPowered: heartbeatCount > 1,
        hidExclusive: heartbeatCount > 1
      })));
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    expect(await screen.findByText('Bluetooth接続待ち')).toBeInTheDocument();
    const statusRegion = screen.getByTestId('assembly-work-session-status');
    expect(statusRegion).not.toHaveClass('h-14', 'overflow-y-auto');
    expect(statusRegion.closest('header')).not.toBeNull();
    expect(screen.getByText('接続権を取得しました。Bluetooth接続を待っています。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('入力待機中').length).toBeGreaterThanOrEqual(1), { timeout: 3500 });
    expect(screen.queryByText('接続権を取得しました。Bluetooth接続を待っています。')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-work-session-status')).toBe(statusRegion);
    expect(statusRegion.closest('header')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '使用終了' }));
    await waitFor(() => {
      expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/release'))).toBe(true);
      expect(screen.getByText('使用開始待ち')).toBeInTheDocument();
    });
  });

  it('does not render browser disarming after the last bolt as a connection failure', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue({
      ...requiredSession,
      currentBoltId: null
    });
    const agentFetch = vi.fn().mockResolvedValue(jsonResponse(agentStatus({
      lastError: 'BROWSER_DISARMED'
    })));
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    await waitFor(() => {
      expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/heartbeat'))).toBe(true);
      expect(screen.getByText('待機中')).toBeInTheDocument();
    });
    expect(screen.queryByText(/トルクレンチ接続を開始できませんでした/)).not.toBeInTheDocument();
  });

  it('replaces an acquired message when a later heartbeat reports communication loss', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    let acquired = false;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/health')) {
        return Promise.resolve(jsonResponse(agentStatus()));
      }
      if (String(url).endsWith('/lease/acquire')) {
        acquired = true;
        return Promise.resolve(jsonResponse(agentStatus({ state: 'owned_by_self', leaseOwned: true })));
      }
      if (String(url).endsWith('/heartbeat') && acquired) {
        return Promise.resolve(jsonResponse(agentStatus({
          state: 'communication_lost',
          lastError: 'LEASE_RENEW_FAILED'
        })));
      }
      return Promise.resolve(jsonResponse(agentStatus()));
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'このレンチを使用開始' }));
    expect(await screen.findByText('接続権を取得しました。Bluetooth接続を待っています。')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Pi 5との通信が切れたため接続を停止しました。もう一度「このレンチを使用開始」を押してください。')).toBeInTheDocument();
    }, { timeout: 3500 });
    expect(screen.queryByText('接続権を取得しました。Bluetooth接続を待っています。')).not.toBeInTheDocument();
  });

  it('shows communication loss when the loopback agent cannot be reached', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(compatibleTorqueWrenches);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue(reusableTorqueConfirmation);
    const agentFetch = vi.fn().mockRejectedValue(new TypeError('connection refused'));
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    await waitFor(() => expect(agentFetch).toHaveBeenCalled());
    expect(screen.getByText('通信断')).toBeInTheDocument();
  });

  it('shows the BOLT target before connection and performs one idempotent confirm/acquire action', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(boltConditionTorqueWrenches);
    const agentFetch = vi.fn().mockImplementation((url: string) => String(url).endsWith('/lease/acquire')
      ? jsonResponse(agentStatus({
          state: 'owned_by_self',
          leaseOwned: true,
          selfOwnedToken: {
            targetKind: 'assembly',
            sessionId: 'session-1',
            torqueWrenchProfileId: 'profile-bolt-1',
            leaseId: 'lease-bolt-1',
            generation: 1
          }
        }))
      : jsonResponse(agentStatus()));
    mockConfirmAssemblyTorqueWrench.mockResolvedValue({
      id: 'confirmation-bolt-1',
      torqueWrenchProfileId: 'profile-bolt-1',
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();

    const target = await screen.findByTestId('assembly-bolt-condition-target');
    expect(target).toHaveTextContent('設定照合対象外');
    expect(target).toHaveTextContent('TW-BOLT-01');
    expect(target).toHaveTextContent('MH-AX / 標準');
    expect(target).toHaveTextContent('9 N-m');
    expect(target).toHaveTextContent('10 N-m');
    expect(target).toHaveTextContent('11 N-m');
    expect(mockListCurrentTorqueWrenchConfirmations).not.toHaveBeenCalled();

    const connect = screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    fireEvent.click(connect);

    await waitFor(() => {
      expect(mockConfirmAssemblyTorqueWrench).toHaveBeenCalledTimes(1);
      expect(agentFetch.mock.calls.filter(([url]) => String(url).endsWith('/lease/acquire'))).toHaveLength(1);
    });
  });

  it('keeps the BOLT confirmation/requestId for an ordinary connection retry', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(boltConditionTorqueWrenches);
    let acquireAttempts = 0;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/lease/acquire')) {
        acquireAttempts += 1;
        if (acquireAttempts === 1) return Promise.reject(new TypeError('connection refused'));
        return Promise.resolve(jsonResponse(agentStatus({
          state: 'owned_by_self',
          leaseOwned: true,
          selfOwnedToken: {
            targetKind: 'assembly',
            sessionId: 'session-1',
            torqueWrenchProfileId: 'profile-bolt-1',
            leaseId: 'lease-bolt-1',
            generation: 1
          }
        })));
      }
      return Promise.resolve(jsonResponse(agentStatus()));
    });
    mockConfirmAssemblyTorqueWrench.mockResolvedValue({
      id: 'confirmation-bolt-1',
      torqueWrenchProfileId: 'profile-bolt-1',
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    });
    vi.stubGlobal('fetch', agentFetch);

    renderPage();
    const connect = await screen.findByRole('button', { name: 'レンチ本体を表示値に設定して接続' });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    expect(await screen.findAllByText('確認済み・接続を再試行')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' }));
    await waitFor(() => {
      expect(mockConfirmAssemblyTorqueWrench).toHaveBeenCalledTimes(1);
      expect(agentFetch.mock.calls.filter(([url]) => String(url).endsWith('/lease/acquire'))).toHaveLength(2);
    });
    const acquireBodies = agentFetch.mock.calls
      .filter(([url]) => String(url).endsWith('/lease/acquire'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { requestId: string });
    expect(acquireBodies[0]?.requestId).toBe(acquireBodies[1]?.requestId);
  });

  it('clears the BOLT confirmation after release so the next connection confirms afresh', async () => {
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue(boltConditionTorqueWrenches);
    let acquired = false;
    const agentFetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/lease/release')) {
        acquired = false;
        return Promise.resolve(jsonResponse(agentStatus()));
      }
      if (String(url).endsWith('/lease/acquire')) {
        acquired = true;
        return Promise.resolve(jsonResponse(agentStatus({
          state: 'owned_by_self',
          leaseOwned: true,
          selfOwnedToken: {
            targetKind: 'assembly',
            sessionId: 'session-1',
            torqueWrenchProfileId: 'profile-bolt-1',
            leaseId: 'lease-bolt-1',
            generation: 1
          }
        })));
      }
      return Promise.resolve(jsonResponse(agentStatus(acquired ? {
        state: 'owned_by_self',
        leaseOwned: true,
        selfOwnedToken: {
          targetKind: 'assembly',
          sessionId: 'session-1',
          torqueWrenchProfileId: 'profile-bolt-1',
          leaseId: 'lease-bolt-1',
          generation: 1
        }
      } : {})));
    });
    mockConfirmAssemblyTorqueWrench.mockImplementation(async () => ({
      id: `confirmation-bolt-${mockConfirmAssemblyTorqueWrench.mock.calls.length + 1}`,
      torqueWrenchProfileId: 'profile-bolt-1',
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    }));
    vi.stubGlobal('fetch', agentFetch);

    renderPage();
    const connect = await screen.findByRole('button', { name: 'レンチ本体を表示値に設定して接続' });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(mockConfirmAssemblyTorqueWrench).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: '使用終了' }));
    await waitFor(() => {
      expect(agentFetch.mock.calls.some(([url]) => String(url).endsWith('/lease/release'))).toBe(true);
      expect(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' }));
    await waitFor(() => expect(mockConfirmAssemblyTorqueWrench).toHaveBeenCalledTimes(2));
  });
});
