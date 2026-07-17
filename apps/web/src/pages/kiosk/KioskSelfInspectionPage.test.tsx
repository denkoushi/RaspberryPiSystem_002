import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSelfInspectionPage } from './KioskSelfInspectionPage';

import type { ProductionScheduleRow } from '../../api/client';
import type { SelfInspectionSessionSummaryDto } from '../../features/part-measurement/types';
import type { NfcEvent } from '../../hooks/useNfcStream';

const mockUseKioskProductionSchedule = vi.fn();
const mockUseSelfInspectionSessions = vi.fn();
const mockIssueSelfInspectionPaperReport = vi.fn();
const mockResolveSelfInspectionNfcTagUid = vi.fn();
const nfcStreamState = vi.hoisted(() => ({ event: null as NfcEvent | null, enabled: false }));

let scheduleRows: ProductionScheduleRow[] = [];
let wipSessions: SelfInspectionSessionSummaryDto[] = [];
let reviewPendingSessions: SelfInspectionSessionSummaryDto[] = [];

vi.mock('../../api/hooks', () => ({
  useKioskProductionSchedule: (...args: unknown[]) => mockUseKioskProductionSchedule(...args),
  useSelfInspectionSessions: (...args: unknown[]) => mockUseSelfInspectionSessions(...args)
}));

vi.mock('../../api/client', () => ({
  issueSelfInspectionPaperReport: (...args: unknown[]) => mockIssueSelfInspectionPaperReport(...args),
  resolveSelfInspectionNfcTagUid: (...args: unknown[]) => mockResolveSelfInspectionNfcTagUid(...args)
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => {
    nfcStreamState.enabled = enabled;
    return enabled ? nfcStreamState.event : null;
  }
}));

function buildScheduleRow(overrides: Partial<ProductionScheduleRow> = {}): ProductionScheduleRow {
  return {
    id: 'schedule-row-1',
    occurredAt: '2026-06-26T00:00:00.000Z',
    rowData: {
      ProductNo: '0002178005',
      FSEIBAN: 'BE1N9321',
      FSIGENCD: '581',
      FHINCD: 'MH001',
      FHINMEI: '部品A'
    },
    plannedQuantity: 10,
    resolvedMachineName: 'FJV50/80',
    selfInspectionTemplateId: 'template-1',
    selfInspectionStatus: null,
    selfInspectionEntryPath:
      '/kiosk/part-measurement/self-inspection/start?templateId=template-1&productNo=0002178005',
    ...overrides
  };
}

function pageTree() {
  return (
    <MemoryRouter initialEntries={['/kiosk/part-measurement/self-inspection']}>
      <Routes>
        <Route path="/kiosk/part-measurement/self-inspection" element={<KioskSelfInspectionPage />} />
        <Route path="/kiosk/part-measurement/self-inspection/start" element={<div>digital input opened</div>} />
        <Route
          path="/kiosk/part-measurement/inspection/paper-reports/:reportId/print"
          element={<div>paper print opened</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(pageTree());
}

function buildWipSession(
  overrides: Partial<SelfInspectionSessionSummaryDto> = {}
): SelfInspectionSessionSummaryDto {
  return {
    id: 'session-1',
    sessionBusinessKey: 'business-1',
    templateId: 'template-1',
    templateName: '自主検査A',
    productNo: '0002178005',
    fseiban: 'BE1N9321',
    fhincd: 'MH001',
    fhinmei: '部品A',
    processGroup: 'cutting',
    resourceCd: '581',
    scheduleRowId: 'schedule-row-1',
    machineName: 'FJV50/80',
    plannedQuantity: 10,
    expectedEntryCount: 10,
    requiredEntryCount: 10,
    completedEntryCount: 3,
    pendingReviewCount: 0,
    participantEmployeeNames: ['山田'],
    participantEmployees: [{ employeeId: 'employee-1', displayName: '山田' }],
    selfInspectionMode: 'all',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'in_progress',
    startedAt: '2026-06-26T00:00:00.000Z',
    completedAt: null,
    recordApprovalRequiredAt: null,
    recordApprovalWorkflowStartedAt: null,
    decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
    inspectorRemeasurementRequiredAt: null,
    inspectorMeasurementState: 'not_required',
    inspectorRequiredEntryCount: 0,
    inspectorCompletedRequiredEntryCount: 0,
    inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0,
    updatedAt: '2026-06-26T00:00:00.000Z',
    ...overrides
  };
}

function lastScheduleParams() {
  const call = mockUseKioskProductionSchedule.mock.calls.at(-1);
  return call?.[0] as { q?: string; productNos?: string; resourceCds?: string } | undefined;
}

async function scanHidText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: '移動票スキャン' }));
  await screen.findByText('移動票の製造order番号を読み取ってください。');
  for (const char of text) {
    fireEvent.keyDown(window, { key: char });
  }
  fireEvent.keyDown(window, { key: 'Enter' });
}

describe('KioskSelfInspectionPage HID scan workflow', () => {
  beforeEach(() => {
    scheduleRows = [];
    wipSessions = [];
    reviewPendingSessions = [];
    mockUseKioskProductionSchedule.mockReset();
    mockUseSelfInspectionSessions.mockReset();
    mockIssueSelfInspectionPaperReport.mockReset();
    mockResolveSelfInspectionNfcTagUid.mockReset();
    nfcStreamState.event = null;
    nfcStreamState.enabled = false;

    mockUseKioskProductionSchedule.mockImplementation(() => ({
      data: { rows: scheduleRows, hasMore: false },
      isLoading: false,
      isFetching: false
    }));
    mockUseSelfInspectionSessions.mockImplementation((params: { status?: string }) => ({
      data: {
        sessions:
          params.status === 'in_progress'
            ? wipSessions
            : params.status === 'review_pending'
              ? reviewPendingSessions
              : [],
        truncated: false,
        listLimit: 200
      },
      isLoading: false
    }));
    mockIssueSelfInspectionPaperReport.mockResolvedValue({
      report: { id: 'paper-report-1' }
    });
  });

  it('uses exact productNos search for HID scans and auto-opens the workflow when resource narrows to one row', async () => {
    scheduleRows = [buildScheduleRow()];
    renderPage();

    fireEvent.change(screen.getByLabelText('資源CD'), { target: { value: '581' } });
    await waitFor(() => expect(lastScheduleParams()?.resourceCds).toBe('581'));

    await scanHidText('0002178005');

    await waitFor(() => {
      expect(lastScheduleParams()).toEqual(
        expect.objectContaining({
          productNos: '0002178005',
          q: undefined,
          resourceCds: '581'
        })
      );
    });
    expect(await screen.findByRole('dialog', { name: '検査方法を選択' })).toBeInTheDocument();
  });

  it('keeps manual text input on q search instead of productNos search', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('製造order / 製番 / 品番'), { target: { value: 'MH001' } });

    await waitFor(() => {
      expect(lastScheduleParams()).toEqual(
        expect.objectContaining({
          q: 'MH001',
          productNos: undefined
        })
      );
    });
  });

  it('shows candidate selection first when scanned product has no resource filter, then opens digital input from the modal', async () => {
    scheduleRows = [buildScheduleRow()];
    renderPage();

    await scanHidText('0002178005');

    await waitFor(() => expect(lastScheduleParams()?.productNos).toBe('0002178005'));
    expect(screen.queryByRole('dialog', { name: '検査方法を選択' })).not.toBeInTheDocument();
    expect(screen.getByTestId('self-inspection-table-panes')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '検査方法を選択' }));
    fireEvent.click(screen.getByRole('button', { name: 'デジタル入力' }));

    expect(await screen.findByText('digital input opened')).toBeInTheDocument();
  });

  it('issues a paper report from the shared workflow modal', async () => {
    scheduleRows = [buildScheduleRow()];
    renderPage();

    await scanHidText('0002178005');
    await waitFor(() => expect(lastScheduleParams()?.productNos).toBe('0002178005'));

    fireEvent.click(screen.getByRole('button', { name: '検査方法を選択' }));
    fireEvent.click(screen.getByRole('button', { name: '帳票紙印刷' }));

    await waitFor(() => {
      expect(mockIssueSelfInspectionPaperReport).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'template-1',
          productNo: '0002178005',
          scheduleRowId: 'schedule-row-1',
          fseiban: 'BE1N9321',
          fhincd: 'MH001',
          fhinmei: '部品A',
          resourceCd: '581',
          machineName: 'FJV50/80'
        })
      );
    });
    expect(await screen.findByText('paper print opened')).toBeInTheDocument();
  });

  it('renders the one-line header and builds dropdown options only from rendered WIP rows', async () => {
    wipSessions = [
      buildWipSession(),
      buildWipSession({
        id: 'session-2',
        productNo: '0002178006',
        resourceCd: '582',
        fseiban: 'BE1N9322',
        fhincd: 'MH002',
        fhinmei: '部品B'
      })
    ];
    renderPage();

    expect(screen.queryByText(/仕掛中（全端末共通）を表示します/)).not.toBeInTheDocument();
    expect(screen.queryByText(/仕掛中（.*全端末共通/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '記録承認' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '製造order / 製番 / 品番' })).toHaveAttribute(
      'placeholder',
      '製造order・製番・品番'
    );
    fireEvent.click(screen.getByRole('button', { name: '製造order / 製番 / 品番の候補を表示' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.click(screen.getByRole('option', { name: /0002178006/ }));

    await waitFor(() => expect(lastScheduleParams()?.q).toBe('0002178006'));
    expect(lastScheduleParams()?.productNos).toBeUndefined();
  });

  it('caps the merged in-progress and review-pending list at the newest 200 sessions', () => {
    const makeIndexedSession = (index: number, status: 'in_progress' | 'review_pending') =>
      buildWipSession({
        id: `session-${index}`,
        productNo: `ORDER-${String(index).padStart(3, '0')}`,
        status,
        updatedAt: new Date(Date.UTC(2026, 6, 14) - index * 1_000).toISOString()
      });
    wipSessions = Array.from({ length: 150 }, (_, index) => makeIndexedSession(index, 'in_progress'));
    reviewPendingSessions = Array.from({ length: 100 }, (_, index) =>
      makeIndexedSession(index + 150, 'review_pending')
    );

    renderPage();

    expect(
      document.querySelectorAll('[data-testid="self-inspection-table-panes"] tbody tr:nth-child(odd)')
    ).toHaveLength(200);
    expect(screen.getByText('ORDER-000')).toBeInTheDocument();
    expect(screen.queryByText('ORDER-249')).not.toBeInTheDocument();
    expect(screen.getByText(/仕掛中は最新 200 件まで表示しています/)).toBeInTheDocument();
  });

  it('filters loaded WIP sessions by exact employee ID after a one-shot name NFC scan', async () => {
    wipSessions = [
      buildWipSession({
        id: 'session-e1',
        productNo: 'ORDER-E1',
        participantEmployeeNames: ['山田'],
        participantEmployees: [{ employeeId: 'employee-1', displayName: '山田' }]
      }),
      buildWipSession({
        id: 'session-e2',
        productNo: 'ORDER-E2',
        participantEmployeeNames: ['山田'],
        participantEmployees: [{ employeeId: 'employee-2', displayName: '山田' }],
        updatedAt: '2026-06-27T00:00:00.000Z'
      })
    ];
    mockResolveSelfInspectionNfcTagUid.mockResolvedValue({
      kind: 'employee',
      employee: { id: 'employee-2', displayName: '山田', nfcTagUid: 'uid-e2' }
    });
    const view = renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: '製造order / 製番 / 品番' }), {
      target: { value: 'MH' }
    });
    fireEvent.click(screen.getByRole('button', { name: '氏名スキャン' }));
    expect(screen.getByRole('combobox', { name: '製造order / 製番 / 品番' })).toHaveValue('');
    expect(nfcStreamState.enabled).toBe(true);

    nfcStreamState.event = {
      uid: 'uid-e2',
      timestamp: '2026-07-14T01:00:00.000Z',
      eventId: 10
    };
    view.rerender(pageTree());

    await waitFor(() => expect(mockResolveSelfInspectionNfcTagUid).toHaveBeenCalledWith('uid-e2'));
    expect(await screen.findByRole('status')).toHaveTextContent('氏名: 山田');
    expect(screen.getByText('ORDER-E2')).toBeInTheDocument();
    expect(screen.queryByText('ORDER-E1')).not.toBeInTheDocument();
    expect(nfcStreamState.enabled).toBe(false);
  });

  it('does not apply a filter when the scanned NFC tag is not an employee', async () => {
    wipSessions = [buildWipSession({ productNo: 'ORDER-KEEP' })];
    mockResolveSelfInspectionNfcTagUid.mockResolvedValue({ kind: 'instrument', instrument: {} });
    const view = renderPage();

    fireEvent.click(screen.getByRole('button', { name: '氏名スキャン' }));
    nfcStreamState.event = {
      uid: 'instrument-uid',
      timestamp: '2026-07-14T01:00:00.000Z',
      eventId: 11
    };
    view.rerender(pageTree());

    expect(await screen.findByText('氏名タグではありません。計測機器タグが読み取られました。')).toBeInTheDocument();
    expect(screen.getByText('ORDER-KEEP')).toBeInTheDocument();
  });
});
