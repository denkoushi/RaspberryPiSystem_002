import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSelfInspectionPage } from './KioskSelfInspectionPage';

import type { ProductionScheduleRow } from '../../api/client';

const mockUseKioskProductionSchedule = vi.fn();
const mockUseSelfInspectionSessions = vi.fn();
const mockUseVerifyRecordApprovalAccessPassword = vi.fn();
const mockIssueSelfInspectionPaperReport = vi.fn();

let scheduleRows: ProductionScheduleRow[] = [];

vi.mock('../../api/hooks', () => ({
  useKioskProductionSchedule: (...args: unknown[]) => mockUseKioskProductionSchedule(...args),
  useSelfInspectionSessions: (...args: unknown[]) => mockUseSelfInspectionSessions(...args),
  useVerifyKioskSelfInspectionRecordApprovalAccessPassword: (...args: unknown[]) =>
    mockUseVerifyRecordApprovalAccessPassword(...args)
}));

vi.mock('../../api/client', () => ({
  issueSelfInspectionPaperReport: (...args: unknown[]) => mockIssueSelfInspectionPaperReport(...args)
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

function renderPage() {
  return render(
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

function lastScheduleParams() {
  const call = mockUseKioskProductionSchedule.mock.calls.at(-1);
  return call?.[0] as { q?: string; productNos?: string; resourceCds?: string } | undefined;
}

async function scanHidText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: '移動票スキャン' }));
  await screen.findByText('スキャン待ちです。移動票の製造order番号を読み取ってください。');
  for (const char of text) {
    fireEvent.keyDown(window, { key: char });
  }
  fireEvent.keyDown(window, { key: 'Enter' });
}

describe('KioskSelfInspectionPage HID scan workflow', () => {
  beforeEach(() => {
    scheduleRows = [];
    mockUseKioskProductionSchedule.mockReset();
    mockUseSelfInspectionSessions.mockReset();
    mockUseVerifyRecordApprovalAccessPassword.mockReset();
    mockIssueSelfInspectionPaperReport.mockReset();

    mockUseKioskProductionSchedule.mockImplementation(() => ({
      data: { rows: scheduleRows, hasMore: false },
      isLoading: false,
      isFetching: false
    }));
    mockUseSelfInspectionSessions.mockReturnValue({
      data: { sessions: [], truncated: false, listLimit: 200 },
      isLoading: false
    });
    mockUseVerifyRecordApprovalAccessPassword.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
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
});
