import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyWorkSessionPage } from './KioskAssemblyWorkSessionPage';

import type { AssemblyProcedureSequenceDto, AssemblyWorkSessionDto } from '../../features/assembly/types';

const mockGetAssemblyWorkSession = vi.fn();
const mockGetProcedureSequence = vi.fn();
const mockRecordAssemblyTorque = vi.fn();
const mockAdvanceAssemblyArea = vi.fn();
const mockRestartAssemblyArea = vi.fn();
const mockCompleteAssemblyWorkSession = vi.fn();

vi.mock('../../api/client', () => ({
  getAssemblyWorkSession: (...args: unknown[]) => mockGetAssemblyWorkSession(...args),
  getAssemblyWorkSessionProcedureSequence: (...args: unknown[]) => mockGetProcedureSequence(...args),
  recordAssemblyTorque: (...args: unknown[]) => mockRecordAssemblyTorque(...args),
  recordAssemblyCheck: vi.fn(),
  advanceAssemblyArea: (...args: unknown[]) => mockAdvanceAssemblyArea(...args),
  restartAssemblyArea: (...args: unknown[]) => mockRestartAssemblyArea(...args),
  completeAssemblyWorkSession: (...args: unknown[]) => mockCompleteAssemblyWorkSession(...args),
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
  beforeEach(() => {
    mockGetAssemblyWorkSession.mockReset();
    mockGetProcedureSequence.mockReset();
    mockRecordAssemblyTorque.mockReset();
    mockAdvanceAssemblyArea.mockReset();
    mockRestartAssemblyArea.mockReset();
    mockCompleteAssemblyWorkSession.mockReset();
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
    expect(screen.getAllByText('BOLT-1').length).toBeGreaterThanOrEqual(1);
  });

  it('renders configured PDF procedure sequence with page navigation', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '組立作業' })).toBeInTheDocument();
    expect(screen.getByText('X軸')).toBeInTheDocument();
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
});
