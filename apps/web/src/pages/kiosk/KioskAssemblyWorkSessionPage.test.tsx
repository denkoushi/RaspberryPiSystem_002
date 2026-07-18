import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyWorkSessionPage } from './KioskAssemblyWorkSessionPage';

import type { AssemblyProcedureSequenceDto, AssemblyWorkSessionDto } from '../../features/assembly/types';

const mockGetAssemblyWorkSession = vi.fn();
const mockGetProcedureSequence = vi.fn();
const mockRecordAssemblyTorque = vi.fn();
const mockAdvanceAssemblyArea = vi.fn();
const mockRestartAssemblyArea = vi.fn();
const mockCompleteAssemblyWorkSession = vi.fn();
const mockListCompatibleTorqueWrenches = vi.fn();
const mockListCurrentTorqueWrenchConfirmations = vi.fn();
const mockConfirmAssemblyTorqueWrench = vi.fn();

vi.mock('../../api/client', () => ({
  getAssemblyWorkSession: (...args: unknown[]) => mockGetAssemblyWorkSession(...args),
  getAssemblyWorkSessionProcedureSequence: (...args: unknown[]) => mockGetProcedureSequence(...args),
  recordAssemblyTorque: (...args: unknown[]) => mockRecordAssemblyTorque(...args),
  recordAssemblyCheck: vi.fn(),
  advanceAssemblyArea: (...args: unknown[]) => mockAdvanceAssemblyArea(...args),
  restartAssemblyArea: (...args: unknown[]) => mockRestartAssemblyArea(...args),
  completeAssemblyWorkSession: (...args: unknown[]) => mockCompleteAssemblyWorkSession(...args),
  listCompatibleTorqueWrenchesForSession: (...args: unknown[]) => mockListCompatibleTorqueWrenches(...args),
  listCurrentTorqueWrenchConfirmations: (...args: unknown[]) => mockListCurrentTorqueWrenchConfirmations(...args),
  confirmAssemblyTorqueWrench: (...args: unknown[]) => mockConfirmAssemblyTorqueWrench(...args),
  resolveKioskDocumentPageImageUrl: (path: string) => path
}));

vi.mock('../../features/assembly', async () => {
  const actual = await vi.importActual<typeof import('../../features/assembly')>('../../features/assembly');
  return {
    ...actual,
    AssemblyProcedureCanvas: () => <div>fallback procedure canvas</div>
  };
});

const session: AssemblyWorkSessionDto = {
  id: 'session-1',
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

const configuredSequence: AssemblyProcedureSequenceDto = {
  mode: 'configured',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly/work-sessions/session-1']}>
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
    mockGetProcedureSequence.mockReset();
    mockRecordAssemblyTorque.mockReset();
    mockAdvanceAssemblyArea.mockReset();
    mockRestartAssemblyArea.mockReset();
    mockCompleteAssemblyWorkSession.mockReset();
    mockListCompatibleTorqueWrenches.mockReset();
    mockListCurrentTorqueWrenchConfirmations.mockReset();
    mockConfirmAssemblyTorqueWrench.mockReset();
    mockGetAssemblyWorkSession.mockResolvedValue(session);
    mockGetProcedureSequence.mockResolvedValue(configuredSequence);
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

  it('renders configured PDF procedure sequence with page navigation', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '組立作業' })).toBeInTheDocument();
    // session 取得直後は sequence 未解決で fallback になり得るため、configured UI を待つ
    expect(await screen.findByText('X軸', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText(/1\/2ページ/, undefined, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次頁' }));
    // CIランナーが遅い場合に1秒のデフォルトwaitForで拾えずフレークするため延長
    await waitFor(() => expect(screen.getByText(/2\/2ページ/)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('falls back to existing procedure canvas when sequence is not configured', async () => {
    mockGetProcedureSequence.mockResolvedValue({
      ...configuredSequence,
      mode: 'fallback',
      reason: 'not_configured',
      documents: []
    });
    renderPage();

    await waitFor(() => expect(mockGetProcedureSequence).toHaveBeenCalledWith('session-1'));
    expect(await screen.findByText('fallback procedure canvas')).toBeInTheDocument();
    expect(await screen.findByText('手順書')).toBeInTheDocument();
  });

  it('automatically reuses a current physical-wrench confirmation for the same tightening condition', async () => {
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
    mockGetAssemblyWorkSession.mockResolvedValue(requiredSession);
    mockListCompatibleTorqueWrenches.mockResolvedValue([
      {
        profile: {
          id: 'profile-1',
          serialNumber: 'TW-A103',
          model: { modelNumber: 'CEM20N3X10D-BTLA' },
          settingHistories: [{ nominalTorque: '10', unit: 'N·m' }]
        },
        conditionFingerprint: 'condition-1'
      }
    ]);
    mockListCurrentTorqueWrenchConfirmations.mockResolvedValue([
      {
        id: 'confirmation-1',
        torqueWrenchProfileId: 'profile-1',
        settingHistoryId: 'setting-1'
      }
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    renderPage();

    expect(await screen.findByText('同じ締付条件の確認を引継ぎ・入力待機中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '現物確認済み' })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'トルク値' })).not.toBeInTheDocument();
    expect(mockListCurrentTorqueWrenchConfirmations).toHaveBeenCalledWith('session-1');
  });
});
