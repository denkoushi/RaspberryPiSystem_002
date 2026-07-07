import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyHomePage } from './KioskAssemblyHomePage';

import type { AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const mockListAssemblySeibanCandidates = vi.fn();
const mockListAssemblyWorkSessionSummaries = vi.fn();
const mockStartAssemblyWorkSession = vi.fn();
const mockListAssemblySeibanLotQuantities = vi.fn();
const mockResolveAssemblyOperatorNfc = vi.fn();

vi.mock('../../api/client', () => ({
  listAssemblySeibanCandidates: (...args: unknown[]) => mockListAssemblySeibanCandidates(...args),
  listAssemblyWorkSessionSummaries: (...args: unknown[]) => mockListAssemblyWorkSessionSummaries(...args),
  startAssemblyWorkSession: (...args: unknown[]) => mockStartAssemblyWorkSession(...args),
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
    mockListAssemblySeibanCandidates.mockReset();
    mockListAssemblyWorkSessionSummaries.mockReset();
    mockStartAssemblyWorkSession.mockReset();
    mockListAssemblySeibanLotQuantities.mockReset();
    mockResolveAssemblyOperatorNfc.mockReset();
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
    mockStartAssemblyWorkSession.mockResolvedValue({ id: 'session-1' });
    mockListAssemblySeibanLotQuantities.mockResolvedValue([]);
  });

  it('selects a seiban candidate and starts work with normalized serial input', async () => {
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
    fireEvent.change(screen.getByLabelText('シリアルNo.'), { target: { value: 's001' } });
    fireEvent.change(screen.getByLabelText('作業者'), { target: { value: '佐藤' } });

    await waitFor(() => expect(screen.getByLabelText('シリアルNo.')).toHaveValue('S001'));
    fireEvent.click(screen.getByRole('button', { name: '組立開始' }));

    await waitFor(() =>
      expect(mockStartAssemblyWorkSession).toHaveBeenCalledWith({
        templateId: 'template-1',
        productNo: 'ASMTEST-A1',
        serialNo: 'S001',
        operatorEmployeeId: null,
        operatorNameSnapshot: '佐藤',
        targetUnit: 'MH-AX',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      })
    );
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

  it('keeps independent seiban and serial keypads including BS and CLR', () => {
    renderPage();

    const fseibanInput = screen.getByLabelText('製番');
    const serialInput = screen.getByLabelText('シリアルNo.');
    const fseibanPad = within(screen.getByRole('group', { name: '製番入力パッド' }));
    const serialPad = within(screen.getByRole('group', { name: 'シリアル入力パッド' }));

    fireEvent.click(fseibanPad.getByRole('button', { name: 'A' }));
    fireEvent.click(fseibanPad.getByRole('button', { name: '1' }));
    fireEvent.click(serialPad.getByRole('button', { name: 'S' }));
    fireEvent.click(serialPad.getByRole('button', { name: '2' }));

    expect(fseibanInput).toHaveValue('A1');
    expect(serialInput).toHaveValue('S2');

    fireEvent.click(fseibanPad.getByRole('button', { name: 'BS' }));
    expect(fseibanInput).toHaveValue('A');
    expect(serialInput).toHaveValue('S2');

    fireEvent.click(serialPad.getByRole('button', { name: 'CLR' }));
    expect(fseibanInput).toHaveValue('A');
    expect(serialInput).toHaveValue('');

    fireEvent.click(fseibanPad.getByRole('button', { name: 'CLR' }));
    expect(fseibanInput).toHaveValue('');
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
    expect(screen.getByRole('button', { name: '組立開始' })).toBeDisabled();
    expect(mockStartAssemblyWorkSession).not.toHaveBeenCalled();
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
