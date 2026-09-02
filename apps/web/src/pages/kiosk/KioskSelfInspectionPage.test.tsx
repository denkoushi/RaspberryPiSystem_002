import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskSelfInspectionPage } from './KioskSelfInspectionPage';

import type { ProductionScheduleRow } from '../../api/client';
import type { SelfInspectionSessionSummaryDto } from '../../features/part-measurement/types';
import type { NfcEvent } from '../../hooks/useNfcStream';

const mockUseKioskProductionSchedule = vi.fn();
const mockUseKioskProductionScheduleResources = vi.fn();
const mockUseSelfInspectionSessions = vi.fn();
const mockUseWorkInstructionGroups = vi.fn();
const mockUseWorkInstructionGroup = vi.fn();
const mockIssueSelfInspectionPaperReport = vi.fn();
const mockResolveSelfInspectionNfcTagUid = vi.fn();
const mockGetWorkInstructionPartCandidates = vi.fn();
const mockGetWorkInstructionPartAlias = vi.fn();
const mockPutWorkInstructionPartAlias = vi.fn();
const mockInvalidateSelfInspectionItem = vi.fn();
const nfcStreamState = vi.hoisted(() => ({ event: null as NfcEvent | null, enabled: false }));

let scheduleRows: ProductionScheduleRow[] = [];
let wipSessions: SelfInspectionSessionSummaryDto[] = [];
let reviewPendingSessions: SelfInspectionSessionSummaryDto[] = [];

vi.mock('../../api/hooks', () => ({
  useKioskProductionSchedule: (...args: unknown[]) => mockUseKioskProductionSchedule(...args),
  useKioskProductionScheduleResources: (...args: unknown[]) => mockUseKioskProductionScheduleResources(...args),
  useSelfInspectionSessions: (...args: unknown[]) => mockUseSelfInspectionSessions(...args),
  useWorkInstructionGroups: (...args: unknown[]) => mockUseWorkInstructionGroups(...args),
  useWorkInstructionGroup: (...args: unknown[]) => mockUseWorkInstructionGroup(...args),
  useInvalidateSelfInspectionItem: () => ({
    mutateAsync: mockInvalidateSelfInspectionItem,
    isPending: false
  })
}));

vi.mock('../../api/client', () => ({
  issueSelfInspectionPaperReport: (...args: unknown[]) => mockIssueSelfInspectionPaperReport(...args),
  resolveSelfInspectionNfcTagUid: (...args: unknown[]) => mockResolveSelfInspectionNfcTagUid(...args),
  getWorkInstructionPartCandidates: (...args: unknown[]) => mockGetWorkInstructionPartCandidates(...args),
  getWorkInstructionPartAlias: (...args: unknown[]) => mockGetWorkInstructionPartAlias(...args),
  putWorkInstructionPartAlias: (...args: unknown[]) => mockPutWorkInstructionPartAlias(...args)
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
    updatedAt: '2026-06-26T00:00:00.000Z',
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

function pageTree(initialEntry = '/kiosk/part-measurement/self-inspection') {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
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

function renderPage(initialEntry?: string) {
  return render(pageTree(initialEntry));
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

function metadataForProduct(productNo: string): HTMLElement | undefined {
  return screen
    .getAllByTestId('self-inspection-item-metadata')
    .find((element) => element.textContent?.includes(productNo));
}

async function scanHidText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: '移動票スキャン' }));
  await screen.findByText('移動票の製造order番号を読み取ってください。');
  for (const char of text) {
    fireEvent.keyDown(window, { key: char });
  }
  fireEvent.keyDown(window, { key: 'Enter' });
}

async function scanPartHidText(text: string) {
  fireEvent.click(screen.getByRole('button', { name: '部品番号スキャン' }));
  await screen.findByText('移動票の部品番号（FHINCD）を読み取ってください。');
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
    mockUseKioskProductionScheduleResources.mockReset();
    mockUseSelfInspectionSessions.mockReset();
    mockUseWorkInstructionGroups.mockReset();
    mockUseWorkInstructionGroup.mockReset();
    mockIssueSelfInspectionPaperReport.mockReset();
    mockResolveSelfInspectionNfcTagUid.mockReset();
    mockGetWorkInstructionPartCandidates.mockReset();
    mockGetWorkInstructionPartAlias.mockReset();
    mockPutWorkInstructionPartAlias.mockReset();
    mockInvalidateSelfInspectionItem.mockReset();
    nfcStreamState.event = null;
    nfcStreamState.enabled = false;

    mockUseKioskProductionSchedule.mockImplementation(() => ({
      data: { rows: scheduleRows, hasMore: false },
      isLoading: false,
      isFetching: false
    }));
    mockUseKioskProductionScheduleResources.mockImplementation(() => ({
      data: { resourceNameMap: {} },
      isLoading: false
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
    mockUseWorkInstructionGroups.mockImplementation((partNumber: string) => ({
      data:
        partNumber === 'MH002'
          ? [
              {
                partNumber: 'MH002',
                shootingTarget: '切削',
                rowCount: 1,
                stepCount: 1,
                latestModified: '2026-08-31T00:00:00.000Z'
              }
            ]
          : partNumber === 'MH001'
          ? [
              {
                partNumber: 'MH001',
                shootingTarget: '581',
                rowCount: 1,
                stepCount: 1,
                latestModified: '2026-08-31T00:00:00.000Z'
              },
              {
                partNumber: 'MH001',
                shootingTarget: '研削',
                rowCount: 1,
                stepCount: 1,
                latestModified: '2026-08-31T00:00:00.000Z'
              }
            ]
          : [],
      isLoading: false,
      isFetching: false,
      isSuccess: Boolean(partNumber),
      isError: false
    }));
    mockUseWorkInstructionGroup.mockImplementation((partNumber: string, shootingTarget: string) => ({
      data:
        partNumber === 'MH001' && shootingTarget
          ? {
              partNumber,
              shootingTarget,
              rows: [],
              steps: [
                {
                  id: 'step-1',
                  step: 7,
                  text: '加工面を確認します。',
                  imageName: null,
                  imageAssetId: null,
                  imageUrl: null,
                  imageMimeType: null,
                  imageSha256: null,
                  rowId: 'row-1',
                  source: { system: 'sharepoint', list: '研削', itemId: 1 }
                }
              ]
            }
          : undefined,
      isLoading: false,
      isFetching: false,
      isSuccess: Boolean(partNumber && shootingTarget),
      isError: false
    }));
    mockIssueSelfInspectionPaperReport.mockResolvedValue({
      report: { id: 'paper-report-1' }
    });
    mockInvalidateSelfInspectionItem.mockResolvedValue({
      id: 'invalidation-1',
      scheduleRowId: 'schedule-row-1',
      sessionId: null,
      productNoSnapshot: '0002178005'
    });
    mockGetWorkInstructionPartCandidates.mockResolvedValue({
      matchedPrefix: null,
      candidates: [],
      limit: 20,
      offset: 0,
      hasMore: false
    });
    mockGetWorkInstructionPartAlias.mockResolvedValue(null);
    mockPutWorkInstructionPartAlias.mockResolvedValue(undefined);
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

  it('scans FHINCD independently, shows titleless target chips, and opens instructions only after chip selection', async () => {
    renderPage();

    await scanPartHidText('mh001');

    await waitFor(() => expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('MH001'));
    expect(screen.queryByRole('dialog', { name: '作業要領書' })).not.toBeInTheDocument();
    expect(screen.queryByText('撮影対象')).not.toBeInTheDocument();
    expect(screen.queryByText(/資源581/)).not.toBeInTheDocument();
    const grindingChip = screen.getByRole('button', { name: '研削' });
    const resourceChip = screen.getByRole('button', { name: '581' });
    expect(grindingChip.compareDocumentPosition(resourceChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(grindingChip);
    expect(await screen.findByRole('dialog', { name: '作業要領書' })).toBeInTheDocument();
    expect(screen.getByText('加工面を確認します。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自主検査画面に戻る' }));

    expect(screen.queryByRole('dialog', { name: '作業要領書' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '研削' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '581' })).toBeInTheDocument();
    expect(mockGetWorkInstructionPartAlias).not.toHaveBeenCalled();
  });

  it('uses a learned alias after an exact miss and shows all targets as similar chips', async () => {
    mockGetWorkInstructionPartAlias.mockResolvedValueOnce({
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001',
      partName: '部品A',
      shootingTargets: ['581', '研削'],
      selectionCount: 2,
      createdAt: '2026-09-01T00:00:00.000Z',
      lastSelectedAt: '2026-09-02T00:00:00.000Z'
    });
    renderPage();

    await scanPartHidText('MH009X');

    const similarGrinding = await screen.findByRole('button', {
      name: '類似・研削（読取品番 MH009X から正式品番 MH001）'
    });
    expect(screen.getByRole('button', {
      name: '類似・581（読取品番 MH009X から正式品番 MH001）'
    })).toBeInTheDocument();
    expect(mockGetWorkInstructionPartCandidates).not.toHaveBeenCalled();
    fireEvent.click(similarGrinding);
    expect(await screen.findByRole('dialog', { name: '作業要領書' })).toBeInTheDocument();
    expect(mockUseWorkInstructionGroup).toHaveBeenLastCalledWith('MH001', '研削');
  });

  it('opens the longest-prefix candidate dialog and uses the selected exact part', async () => {
    mockGetWorkInstructionPartCandidates.mockResolvedValueOnce({
      matchedPrefix: 'MH00',
      candidates: [
        { partNumber: 'MH001', partName: '部品A', shootingTargets: ['581', '研削'] }
      ],
      limit: 20,
      offset: 0,
      hasMore: false
    });
    renderPage();

    await scanPartHidText('MH009X');

    expect(await screen.findByRole('dialog', { name: '部品番号候補を選択' })).toBeInTheDocument();
    expect(mockGetWorkInstructionPartCandidates).toHaveBeenCalledWith(
      { prefix: 'MH009', fallback: true, limit: 20, offset: 0 },
      expect.any(AbortSignal)
    );
    expect(screen.getByText('部品A')).toBeInTheDocument();
    expect(screen.getByText('581')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'MH001 部品Aを選択' }));

    await waitFor(() => expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('MH001'));
    expect(screen.queryByRole('dialog', { name: '部品番号候補を選択' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /類似・研削/ })).toBeInTheDocument();
    expect(mockPutWorkInstructionPartAlias).toHaveBeenCalledWith({
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001'
    });
  });

  it('keeps the selected candidate usable when learning the alias fails', async () => {
    mockGetWorkInstructionPartCandidates.mockResolvedValueOnce({
      matchedPrefix: 'MH00',
      candidates: [
        { partNumber: 'MH001', partName: '部品A', shootingTargets: ['581', '研削'] }
      ],
      limit: 20,
      offset: 0,
      hasMore: false
    });
    mockPutWorkInstructionPartAlias.mockRejectedValueOnce(new Error('alias save failed'));
    renderPage();

    await scanPartHidText('MH009X');
    await screen.findByRole('dialog', { name: '部品番号候補を選択' });
    fireEvent.click(screen.getByRole('button', { name: 'MH001 部品Aを選択' }));

    const similarGrinding = await screen.findByRole('button', {
      name: '類似・研削（読取品番 MH009X から正式品番 MH001）'
    });
    await waitFor(() => expect(mockPutWorkInstructionPartAlias).toHaveBeenCalledWith({
      scannedPartNumber: 'MH009X',
      canonicalPartNumber: 'MH001'
    }));
    expect(screen.getByRole('status')).toHaveTextContent(
      '類似品番の保存に失敗しました。今回選択した作業要領書は閲覧できます。'
    );

    fireEvent.click(similarGrinding);
    expect(await screen.findByRole('dialog', { name: '作業要領書' })).toBeInTheDocument();
    expect(mockUseWorkInstructionGroup).toHaveBeenLastCalledWith('MH001', '研削');
  });

  it('shortens and restores the scanned part one character at a time', async () => {
    renderPage();
    await scanPartHidText('MH001');
    expect(await screen.findByRole('button', { name: '研削' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '部品番号を1文字削除' }));
    await waitFor(() => expect(mockGetWorkInstructionPartCandidates).toHaveBeenLastCalledWith(
      { prefix: 'MH00', fallback: false, limit: 20, offset: 0 },
      expect.any(AbortSignal)
    ));
    expect(screen.getByRole('button', { name: '部品番号を1文字復活' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: '研削' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '581' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '部品番号を1文字復活' }));
    await waitFor(() => expect(mockGetWorkInstructionPartCandidates).toHaveBeenLastCalledWith(
      { prefix: 'MH001', fallback: false, limit: 20, offset: 0 },
      expect.any(AbortSignal)
    ));
    expect(screen.getByRole('button', { name: '部品番号を1文字復活' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    await scanPartHidText('ABCD');
    expect(await screen.findByRole('dialog', { name: '部品番号候補を選択' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '部品番号を1文字削除' }));
    fireEvent.click(screen.getByRole('button', { name: '部品番号を1文字削除' }));
    expect(screen.getByRole('button', { name: '部品番号を1文字削除' })).toBeDisabled();
  });

  it('pages candidate results by the matched prefix', async () => {
    mockGetWorkInstructionPartCandidates
      .mockResolvedValueOnce({
        matchedPrefix: 'MH00',
        candidates: [{ partNumber: 'MH001', partName: null, shootingTargets: ['581'] }],
        limit: 20,
        offset: 0,
        hasMore: true
      })
      .mockResolvedValueOnce({
        matchedPrefix: 'MH00',
        candidates: [{ partNumber: 'MH002', partName: '部品B', shootingTargets: ['切削'] }],
        limit: 20,
        offset: 20,
        hasMore: false
      });
    renderPage();
    await scanPartHidText('MH009X');

    expect(await screen.findByText('部品名未登録')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));

    await waitFor(() => expect(mockGetWorkInstructionPartCandidates).toHaveBeenLastCalledWith(
      { prefix: 'MH00', fallback: false, limit: 20, offset: 20 },
      expect.any(AbortSignal)
    ));
    expect(await screen.findByText('部品B')).toBeInTheDocument();
  });

  it('ignores a delayed candidate response after clear', async () => {
    let resolveCandidates!: (value: {
      matchedPrefix: string;
      candidates: Array<{ partNumber: string; partName: string; shootingTargets: string[] }>;
      limit: number;
      offset: number;
      hasMore: boolean;
    }) => void;
    mockGetWorkInstructionPartCandidates.mockReturnValueOnce(new Promise((resolve) => {
      resolveCandidates = resolve;
    }));
    renderPage();
    await scanPartHidText('MH009X');
    expect(await screen.findByRole('dialog', { name: '部品番号候補を選択' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    await act(async () => {
      resolveCandidates({
        matchedPrefix: 'MH00',
        candidates: [{ partNumber: 'MH001', partName: '遅延部品', shootingTargets: ['研削'] }],
        limit: 20,
        offset: 0,
        hasMore: false
      });
    });

    expect(screen.queryByRole('dialog', { name: '部品番号候補を選択' })).not.toBeInTheDocument();
    expect(screen.queryByText('遅延部品')).not.toBeInTheDocument();
  });

  it('ignores a delayed candidate response after a new scan', async () => {
    let resolveCandidates!: (value: {
      matchedPrefix: string;
      candidates: Array<{ partNumber: string; partName: string; shootingTargets: string[] }>;
      limit: number;
      offset: number;
      hasMore: boolean;
    }) => void;
    mockGetWorkInstructionPartCandidates.mockReturnValueOnce(new Promise((resolve) => {
      resolveCandidates = resolve;
    }));
    renderPage();
    await scanPartHidText('MH009X');
    expect(await screen.findByRole('dialog', { name: '部品番号候補を選択' })).toBeInTheDocument();

    await scanPartHidText('MH001');
    expect(await screen.findByRole('button', { name: '研削' })).toBeInTheDocument();
    await act(async () => {
      resolveCandidates({
        matchedPrefix: 'MH00',
        candidates: [{ partNumber: 'MH009', partName: '遅延部品', shootingTargets: ['切削'] }],
        limit: 20,
        offset: 0,
        hasMore: false
      });
    });

    expect(screen.queryByRole('dialog', { name: '部品番号候補を選択' })).not.toBeInTheDocument();
    expect(screen.queryByText('遅延部品')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '研削' })).toBeInTheDocument();
  });

  it('ignores a delayed alias response after clear', async () => {
    let resolveAlias!: (value: {
      scannedPartNumber: string;
      canonicalPartNumber: string;
      partName: string | null;
      shootingTargets: string[];
      selectionCount: number;
      createdAt: string;
      lastSelectedAt: string;
    }) => void;
    mockGetWorkInstructionPartAlias.mockReturnValueOnce(new Promise((resolve) => {
      resolveAlias = resolve;
    }));
    renderPage();

    await scanPartHidText('MH009X');
    await waitFor(() => expect(mockGetWorkInstructionPartAlias).toHaveBeenCalledWith(
      'MH009X',
      expect.any(AbortSignal)
    ));

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    await act(async () => {
      resolveAlias({
        scannedPartNumber: 'MH009X',
        canonicalPartNumber: 'MH001',
        partName: '遅延部品',
        shootingTargets: ['研削'],
        selectionCount: 1,
        createdAt: '2026-09-02T00:00:00.000Z',
        lastSelectedAt: '2026-09-02T00:00:00.000Z'
      });
    });

    expect(screen.queryByRole('button', { name: /類似・研削/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '部品番号候補を選択' })).not.toBeInTheDocument();
    expect(screen.queryByText('遅延部品')).not.toBeInTheDocument();
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('');
  });

  it('shows candidate API failures inside the dialog', async () => {
    mockGetWorkInstructionPartCandidates.mockRejectedValueOnce(new Error('candidate API failed'));
    renderPage();

    await scanPartHidText('MH009X');

    expect(await screen.findByRole('dialog', { name: '部品番号候補を選択' })).toHaveTextContent(
      '部品番号候補の検索に失敗しました。'
    );
  });

  it('restores the instruction viewer when returning from the editor with source query parameters', async () => {
    renderPage('/kiosk/part-measurement/self-inspection?partNumber=mh001&shootingTarget=%E7%A0%94%E5%89%8A');

    expect(await screen.findByRole('dialog', { name: '作業要領書' })).toBeInTheDocument();
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('MH001');
    expect(mockUseWorkInstructionGroup).toHaveBeenLastCalledWith('MH001', '研削');
    expect(screen.getByText('加工面を確認します。')).toBeInTheDocument();
    expect(mockGetWorkInstructionPartAlias).not.toHaveBeenCalled();
  });

  it('keeps existing order scanning independent from part scanning', async () => {
    scheduleRows = [buildScheduleRow()];
    renderPage();

    await scanHidText('0002178005');

    await waitFor(() => expect(lastScheduleParams()?.productNos).toBe('0002178005'));
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('button', { name: '研削' })).not.toBeInTheDocument();
  });

  it('keeps HID part scanning and name NFC scanning mutually exclusive', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '部品番号スキャン' }));
    fireEvent.click(screen.getByRole('button', { name: '氏名スキャン' }));
    expect(nfcStreamState.enabled).toBe(true);
    for (const char of 'MH001') fireEvent.keyDown(window, { key: char });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('');

    await scanPartHidText('MH001');
    expect(nfcStreamState.enabled).toBe(false);
    await waitFor(() => expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('MH001'));
  });

  it('clears scanned instruction chips with the existing clear action', async () => {
    renderPage();
    await scanPartHidText('MH001');
    expect(await screen.findByRole('button', { name: '研削' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '研削' })).not.toBeInTheDocument());
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('');
  });

  it('removes old target chips as soon as a new part scan starts and replaces them with the new result', async () => {
    renderPage();
    await scanPartHidText('MH001');
    expect(await screen.findByRole('button', { name: '研削' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '部品番号スキャン' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '研削' })).not.toBeInTheDocument());
    expect(mockUseWorkInstructionGroups).toHaveBeenLastCalledWith('');

    for (const char of 'MH002') fireEvent.keyDown(window, { key: char });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: '切削' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '研削' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '記録確認・承認' })).toBeInTheDocument();
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
    expect(metadataForProduct('ORDER-000')).toBeInTheDocument();
    expect(metadataForProduct('ORDER-249')).toBeUndefined();
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
    expect(metadataForProduct('ORDER-E2')).toBeInTheDocument();
    expect(metadataForProduct('ORDER-E1')).toBeUndefined();
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
    expect(metadataForProduct('ORDER-KEEP')).toBeInTheDocument();
  });

  it('ignores a delayed NFC lookup after part scanning takes control', async () => {
    let resolveNfc!: (value: {
      kind: 'employee';
      employee: { id: string; displayName: string; nfcTagUid: string };
    }) => void;
    mockResolveSelfInspectionNfcTagUid.mockReturnValue(
      new Promise((resolve) => {
        resolveNfc = resolve;
      })
    );
    const view = renderPage();

    fireEvent.click(screen.getByRole('button', { name: '氏名スキャン' }));
    nfcStreamState.event = {
      uid: 'delayed-employee-uid',
      timestamp: '2026-07-14T01:00:00.000Z',
      eventId: 12
    };
    view.rerender(pageTree());
    await waitFor(() =>
      expect(mockResolveSelfInspectionNfcTagUid).toHaveBeenCalledWith('delayed-employee-uid')
    );

    await scanPartHidText('MH001');
    expect(await screen.findByRole('button', { name: '研削' })).toBeInTheDocument();
    await act(async () => {
      resolveNfc({
        kind: 'employee',
        employee: { id: 'employee-delayed', displayName: '遅延氏名', nfcTagUid: 'delayed-employee-uid' }
      });
    });

    expect(screen.queryByText('氏名: 遅延氏名')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '研削' })).toBeInTheDocument();
  });

  it('requires a password and reason before invalidating a started row', async () => {
    wipSessions = [buildWipSession()];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.getByRole('dialog', { name: '自主検査アイテムを削除' })).toBeInTheDocument();
    expect(screen.getByText(/この操作は取り消せません/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '削除する' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('管理パスワード'), {
      target: { value: '2520' }
    });
    fireEvent.change(screen.getByLabelText(/削除理由（必須）/), {
      target: { value: '誤った対象を開始したため' }
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockInvalidateSelfInspectionItem).toHaveBeenCalledWith({
        target: { kind: 'session', sessionId: 'session-1' },
        accessPassword: '2520',
        reason: '誤った対象を開始したため',
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
      });
    });
    expect(await screen.findByText(/自主検査アイテムを削除しました/)).toBeInTheDocument();
    expect(screen.queryByText('0002178005')).not.toBeInTheDocument();
  });
});
