import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyHomePage } from './KioskAssemblyHomePage';

import type { AssemblyLotSummaryDto, AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const mockCreateAssemblyLot = vi.fn();
const mockListAssemblyLotSummaries = vi.fn();
const mockListAssemblySeibanCandidates = vi.fn();
const mockListAssemblyWorkSessionSummaries = vi.fn();
const mockStartAssemblyLotSerial = vi.fn();
const mockListAssemblySeibanLotQuantities = vi.fn();
const mockResolveAssemblyOperatorNfc = vi.fn();

vi.mock('../../api/client', () => ({
  createAssemblyLot: (...args: unknown[]) => mockCreateAssemblyLot(...args),
  listAssemblyLotSummaries: (...args: unknown[]) => mockListAssemblyLotSummaries(...args),
  listAssemblySeibanCandidates: (...args: unknown[]) => mockListAssemblySeibanCandidates(...args),
  listAssemblyWorkSessionSummaries: (...args: unknown[]) => mockListAssemblyWorkSessionSummaries(...args),
  startAssemblyLotSerial: (...args: unknown[]) => mockStartAssemblyLotSerial(...args),
  listAssemblySeibanLotQuantities: (...args: unknown[]) => mockListAssemblySeibanLotQuantities(...args),
  resolveAssemblyOperatorNfc: (...args: unknown[]) => mockResolveAssemblyOperatorNfc(...args)
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: () => null
}));

const candidate: AssemblySeibanCandidateDto = {
  fseiban: 'ASMTEST-A1',
  machineName: 'MH-AX',
  machineNameSource: 'production_schedule',
  activeTemplate: {
    id: 'template-1',
    modelCode: 'MH-AX',
    procedurePattern: '標準',
    name: 'MH-AX 標準',
    version: 1
  }
};

const candidateWithoutTemplate: AssemblySeibanCandidateDto = {
  fseiban: 'ASMTEST-B1',
  machineName: 'MH-NO-TEMPLATE',
  machineNameSource: 'production_schedule',
  activeTemplate: null
};

const inProgressSession: AssemblyWorkSessionSummaryDto = {
  id: 'session-2',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'in_progress',
  productNo: 'ASM-START-001',
  serialNo: 'S002',
  nameplateNo: 'S002',
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  updatedAt: '2026-07-06T00:01:00.000Z',
  templateModelCode: 'MACHINE-X',
  templateProcedurePattern: '標準',
  templateName: 'MACHINE-X 標準',
  templateVersion: 1,
  currentAreaId: 'area-1',
  currentAreaName: 'ストッパー取付',
  currentBoltId: 'bolt-1',
  currentBoltMarkerNo: 1,
  acceptedBoltCount: 0,
  totalBoltCount: 1,
  approval: null
};

const completedSession: AssemblyWorkSessionSummaryDto = {
  ...inProgressSession,
  id: 'session-completed-1',
  status: 'completed',
  productNo: 'ASM-DONE-001',
  completedAt: '2026-07-06T02:00:00.000Z',
  currentAreaId: null,
  currentAreaName: null,
  currentBoltId: null,
  currentBoltMarkerNo: null,
  acceptedBoltCount: 1,
  totalBoltCount: 1,
  approval: null
};

const registeredLot: AssemblyLotSummaryDto = {
  id: 'lot-1',
  templateId: 'template-1',
  productNo: 'ASMTEST-A1',
  expectedQuantity: 2,
  registeredSerialCount: 2,
  notStartedCount: 1,
  inProgressCount: 1,
  completedCount: 0,
  cancelledCount: 0,
  approvedCount: 0,
  isWorkComplete: false,
  isFullyApproved: false,
  operatorEmployeeId: null,
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MH-AX',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:01:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MH-AX',
    procedurePattern: '標準',
    name: 'MH-AX 標準',
    version: 1
  },
  serials: [
    {
      id: 'lot-serial-1',
      lotId: 'lot-1',
      sortOrder: 0,
      serialNo: 'S001',
      status: 'not_started',
      workSessionId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:01:00.000Z',
      approval: null
    },
    {
      id: 'lot-serial-2',
      lotId: 'lot-1',
      sortOrder: 1,
      serialNo: 'S002',
      status: 'in_progress',
      workSessionId: 'session-2',
      startedAt: '2026-07-06T00:02:00.000Z',
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:02:00.000Z',
      approval: null
    }
  ]
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly']}>
      <Routes>
        <Route path="/kiosk/assembly" element={<KioskAssemblyHomePage />} />
        <Route path="/kiosk/assembly/work-sessions/:sessionId" element={<div>session opened</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyHomePage', () => {
  beforeEach(() => {
    mockCreateAssemblyLot.mockReset();
    mockListAssemblyLotSummaries.mockReset();
    mockListAssemblySeibanCandidates.mockReset();
    mockListAssemblyWorkSessionSummaries.mockReset();
    mockStartAssemblyLotSerial.mockReset();
    mockListAssemblySeibanLotQuantities.mockReset();
    mockResolveAssemblyOperatorNfc.mockReset();
    mockListAssemblyLotSummaries.mockResolvedValue([]);
    mockListAssemblySeibanCandidates.mockResolvedValue([candidate]);
    mockListAssemblyWorkSessionSummaries.mockImplementation((params: { status?: string } = {}) =>
      Promise.resolve(
        params.status === 'in_progress'
          ? [inProgressSession]
          : params.status === 'completed'
            ? [completedSession]
            : []
      )
    );
    mockCreateAssemblyLot.mockResolvedValue(registeredLot);
    mockStartAssemblyLotSerial.mockResolvedValue({ id: 'session-1' });
    mockListAssemblySeibanLotQuantities.mockImplementation((productNos: string[]) =>
      Promise.resolve(productNos.map((productNo) => ({ productNo, lotQty: productNo === 'ASMTEST-A1' ? 2 : 1 })))
    );
  });

  it('selects a seiban candidate and registers a lot with exact serial count', async () => {
    renderPage();

    expect(screen.getByRole('link', { name: '手順書ライブラリ' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/library?focus=procedures'
    );
    expect(screen.getByRole('link', { name: '組立テンプレート' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/library?focus=templates'
    );
    expect(screen.getByRole('link', { name: '閲覧順設定' })).toHaveAttribute('href', '/kiosk/assembly/procedure-order-settings');
    expect(screen.getByRole('link', { name: '記録確認' })).toHaveAttribute('href', '/kiosk/assembly/record-approvals');
    fireEvent.change(screen.getByLabelText('製番'), { target: { value: 'asmtest-a' } });

    await waitFor(() =>
      expect(mockListAssemblySeibanCandidates).toHaveBeenCalledWith({ prefix: 'ASMTEST-A', limit: 20 })
    );
    fireEvent.click(await screen.findByText('ASMTEST-A1'));
    expect(screen.getByRole('link', { name: '閲覧順設定' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/procedure-order-settings?machineName=MH-AX'
    );
    await waitFor(() => expect(screen.getByText('入力済み 0/2')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('シリアルNo.追加'), { target: { value: 's001' } });
    await waitFor(() => expect(screen.getByLabelText('シリアルNo.追加')).toHaveValue('S001'));
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.change(screen.getByLabelText('シリアルNo.追加'), { target: { value: 's002' } });
    await waitFor(() => expect(screen.getByLabelText('シリアルNo.追加')).toHaveValue('S002'));
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.change(screen.getByLabelText('作業者'), { target: { value: '佐藤' } });

    fireEvent.click(screen.getByRole('button', { name: 'ロット登録' }));

    await waitFor(() =>
      expect(mockCreateAssemblyLot).toHaveBeenCalledWith({
        templateId: 'template-1',
        productNo: 'ASMTEST-A1',
        expectedQuantity: 2,
        serialNos: ['S001', 'S002'],
        operatorEmployeeId: null,
        operatorNameSnapshot: '佐藤',
        targetUnit: 'MH-AX',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      })
    );
    expect(await screen.findByText('ロットを登録しました。登録済みロットからシリアルごとに開始してください。')).toBeInTheDocument();
  });

  it('starts a not-started serial from a registered lot', async () => {
    mockListAssemblyLotSummaries.mockResolvedValue([registeredLot]);
    renderPage();

    expect(await screen.findByText('登録済みロット')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '開始' }));

    await waitFor(() => expect(mockStartAssemblyLotSerial).toHaveBeenCalledWith('lot-1', 'lot-serial-1'));
    expect(await screen.findByText('session opened')).toBeInTheDocument();
  });

  it('renders in-progress sessions with links back to the work session', async () => {
    renderPage();

    expect(await screen.findByText('ASM-START-001')).toBeInTheDocument();
    expect(screen.getByText('S002 / 佐藤')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ASM-START-001/ })).toHaveAttribute(
      'href',
      '/kiosk/assembly/work-sessions/session-2'
    );
  });

  it('keeps independent seiban and serial keypads including BS and CLR', async () => {
    renderPage();

    const fseibanInput = screen.getByLabelText('製番');
    const serialInput = screen.getByLabelText('シリアルNo.追加');
    const fseibanPad = within(screen.getByRole('group', { name: '製番入力パッド' }));
    const serialPad = within(screen.getByRole('group', { name: 'シリアル入力パッド' }));

    fireEvent.click(fseibanPad.getByRole('button', { name: 'A' }));
    fireEvent.click(fseibanPad.getByRole('button', { name: '1' }));
    expect(fseibanInput).toHaveValue('A1');

    fireEvent.click(fseibanPad.getByRole('button', { name: 'BS' }));
    expect(fseibanInput).toHaveValue('A');

    fireEvent.click(fseibanPad.getByRole('button', { name: 'CLR' }));
    expect(fseibanInput).toHaveValue('');

    fireEvent.change(fseibanInput, { target: { value: 'asmtest-a' } });
    fireEvent.click(await screen.findByText('ASMTEST-A1'));
    await waitFor(() => expect(screen.getByText('入力済み 0/2')).toBeInTheDocument());
    fireEvent.click(serialPad.getByRole('button', { name: 'S' }));
    fireEvent.click(serialPad.getByRole('button', { name: '2' }));
    expect(fseibanInput).toHaveValue('ASMTEST-A1');
    expect(serialInput).toHaveValue('S2');

    fireEvent.click(serialPad.getByRole('button', { name: 'CLR' }));
    expect(fseibanInput).toHaveValue('ASMTEST-A1');
    expect(serialInput).toHaveValue('');
  });

  it('keeps the template registration path when the selected seiban has no active template', async () => {
    mockListAssemblySeibanCandidates.mockResolvedValue([candidateWithoutTemplate]);
    renderPage();

    fireEvent.change(screen.getByLabelText('製番'), { target: { value: 'asmtest-b' } });
    await waitFor(() =>
      expect(mockListAssemblySeibanCandidates).toHaveBeenCalledWith({ prefix: 'ASMTEST-B', limit: 20 })
    );
    fireEvent.click(await screen.findByText('ASMTEST-B1'));

    expect(screen.getByText('テンプレート未登録')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'テンプレート登録' })).toHaveAttribute('href', '/kiosk/assembly/library');
    expect(screen.getByRole('button', { name: 'ロット登録' })).toBeDisabled();
    expect(mockCreateAssemblyLot).not.toHaveBeenCalled();
  });

  it('disables the seiban keypad while candidate search is in progress', async () => {
    mockListAssemblySeibanCandidates.mockImplementation(
      () => new Promise<AssemblySeibanCandidateDto[]>(() => undefined)
    );

    vi.useFakeTimers();
    try {
      renderPage();
      await vi.runOnlyPendingTimersAsync();

      fireEvent.change(screen.getByLabelText('製番'), { target: { value: 'ASM' } });
      await vi.advanceTimersByTimeAsync(180);

      const fseibanPad = within(screen.getByRole('group', { name: '製番入力パッド' }));
      expect(fseibanPad.getByRole('button', { name: 'A' })).toBeDisabled();
      expect(fseibanPad.getByRole('button', { name: 'BS' })).toBeDisabled();
      expect(fseibanPad.getByRole('button', { name: 'CLR' })).toBeDisabled();
      expect(screen.getByLabelText('製番')).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds title attribute to machine name in candidate list', async () => {
    const longMachineName = 'VERY-LONG-MACHINE-NAME-THAT-GETS-TRUNCATED';
    mockListAssemblySeibanCandidates.mockResolvedValue([{ ...candidate, machineName: longMachineName }]);
    renderPage();

    fireEvent.change(screen.getByLabelText('製番'), { target: { value: 'asmtest' } });
    await waitFor(() =>
      expect(mockListAssemblySeibanCandidates).toHaveBeenCalledWith({ prefix: 'ASMTEST', limit: 20 })
    );

    const candidateButton = (await screen.findByText('ASMTEST-A1')).closest('button');
    expect(candidateButton).not.toBeNull();
    const machineNameSpan = within(candidateButton!).getByText(longMachineName);
    expect(machineNameSpan).toHaveAttribute('title', longMachineName);
  });
});
