import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleDueManagementPage } from './ProductionScheduleDueManagementPage';

import type * as Api from '../../api/client';

const api = vi.hoisted(() => ({
  summary: vi.fn<typeof Api.getKioskProductionScheduleDueManagementSummary>(),
  triage: vi.fn<typeof Api.getKioskProductionScheduleDueManagementTriage>(),
  dailyPlan: vi.fn<typeof Api.getKioskProductionScheduleDueManagementDailyPlan>(),
  globalRank: vi.fn<typeof Api.getKioskProductionScheduleDueManagementGlobalRank>(),
  overview: vi.fn<typeof Api.getKioskProductionScheduleDueManagementManualOrderOverview>(),
  proposal: vi.fn<typeof Api.getKioskProductionScheduleDueManagementGlobalRankProposal>(),
  detail: vi.fn<typeof Api.getKioskProductionScheduleDueManagementSeibanDetail>(),
  resources: vi.fn<typeof Api.getKioskProductionScheduleResources>(),
  processingOptions: vi.fn<typeof Api.getKioskProductionScheduleProcessingTypeOptions>(),
  searchState: vi.fn<typeof Api.getKioskProductionScheduleSearchState>(),
  saveSearch: vi.fn<typeof Api.setKioskProductionScheduleSearchState>(),
  saveSelection: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementTriageSelection>(),
  saveDailyPlan: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementDailyPlan>(),
  autoGenerate: vi.fn<typeof Api.autoGenerateKioskProductionScheduleDueManagementGlobalRank>(),
  saveDueDate: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementSeibanDueDate>(),
  saveProcessingDueDate: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementSeibanProcessingDueDate>(),
  savePriorities: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementPartPriorities>(),
  saveProcessing: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementPartProcessingType>(),
  saveNote: vi.fn<typeof Api.updateKioskProductionScheduleDueManagementPartNote>()
}));

vi.mock('../../api/client', async () => ({
  ...await vi.importActual<typeof import('../../api/client')>('../../api/client'),
  getKioskProductionScheduleDueManagementSummary: api.summary,
  getKioskProductionScheduleDueManagementTriage: api.triage,
  getKioskProductionScheduleDueManagementDailyPlan: api.dailyPlan,
  getKioskProductionScheduleDueManagementGlobalRank: api.globalRank,
  getKioskProductionScheduleDueManagementManualOrderOverview: api.overview,
  getKioskProductionScheduleDueManagementGlobalRankProposal: api.proposal,
  getKioskProductionScheduleDueManagementSeibanDetail: api.detail,
  getKioskProductionScheduleResources: api.resources,
  getKioskProductionScheduleProcessingTypeOptions: api.processingOptions,
  getKioskProductionScheduleSearchState: api.searchState,
  setKioskProductionScheduleSearchState: api.saveSearch,
  updateKioskProductionScheduleDueManagementTriageSelection: api.saveSelection,
  updateKioskProductionScheduleDueManagementDailyPlan: api.saveDailyPlan,
  autoGenerateKioskProductionScheduleDueManagementGlobalRank: api.autoGenerate,
  updateKioskProductionScheduleDueManagementSeibanDueDate: api.saveDueDate,
  updateKioskProductionScheduleDueManagementSeibanProcessingDueDate: api.saveProcessingDueDate,
  updateKioskProductionScheduleDueManagementPartPriorities: api.savePriorities,
  updateKioskProductionScheduleDueManagementPartProcessingType: api.saveProcessing,
  updateKioskProductionScheduleDueManagementPartNote: api.saveNote
}));

vi.mock('../../api/hooks', async () => ({
  ...await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks'),
  useKioskSites: () => ({ data: undefined })
}));

// Pin the standard V2 kiosk view independently of the developer's Vite environment.
vi.mock('../../config/productionBuildConfig', async () => {
  const actual = await vi.importActual<typeof import('../../config/productionBuildConfig')>(
    '../../config/productionBuildConfig'
  );
  return {
    ...actual,
    readProductionBuildConfig: () => ({
      ...actual.readProductionBuildConfig(),
      dueManagementLayoutV2Enabled: true,
      manualOrderDeviceScopeV2Enabled: true,
      targetLocationSelectorEnabled: false
    })
  };
});

const timestamp = '2026-10-20T03:00:00Z';
const noFilter = { resourceCd: undefined, resourceCategory: undefined };
let client: QueryClient;
let detail: Api.ProductionScheduleDueManagementSeibanDetail;
let triage: Api.ProductionScheduleDueManagementTriageResult;
let dailyPlan: Api.ProductionScheduleDueManagementDailyPlanResult;

function part(fhincd: string, resourceCd: string, rank: number): Api.ProductionScheduleDueManagementPartItem {
  return {
    fhincd, productNo: `ORDER-${fhincd}`, fhinmei: `部品${fhincd}`, note: null,
    processCount: 1, totalRequiredMinutes: 12.6, processingType: null, processingPriority: 0,
    completedProcessCount: 0, totalProcessCount: 1,
    actualPerPieceMinutes: 2.5, actualEstimatedMinutes: 10, actualCoverageRatio: 1,
    processes: [{ rowId: `row-${fhincd}`, resourceCd, resourceNames: ['研削機'], processOrder: 10, isCompleted: false }],
    currentPriorityRank: rank, suggestedPriorityRank: 3 - rank,
    plannedQuantity: 4, plannedStartDate: '2026-10-20',
    effectiveDueDate: '2026-10-23', effectiveDueDateSource: 'manual'
  };
}

function candidate(fseiban: string, zone: 'danger' | 'safe'): Api.ProductionScheduleDueManagementTriageItem {
  return {
    fseiban, zone, machineName: 'ＮＶＤ－５０００', dueDate: '2026-10-23',
    partsCount: 2, processCount: 2, totalRequiredMinutes: 25.2,
    actualEstimatedMinutes: 20, actualCoverageRatio: 1, daysUntilDue: 3,
    reasons: [], isSelected: zone === 'danger', topProcessingType: null
  };
}

function renderPage() {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/kiosk/production-schedule/due-management']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/kiosk/production-schedule/due-management" element={<ProductionScheduleDueManagementPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function ready() {
  await screen.findByRole('cell', { name: 'PART-A' });
}

function partRow(code: string) {
  return screen.getByRole('row', { name: new RegExp(`ORDER-${code}`) });
}

function openDailyPlan() {
  fireEvent.click(screen.getByRole('button', { name: '当日計画への反映（補助）を展開する' }));
  return within(screen.getByRole('heading', { name: '当日計画への反映（補助）' }).closest('section')!);
}

describe('ProductionScheduleDueManagementPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(timestamp));
    window.localStorage.clear();
    detail = {
      fseiban: 'S-100', machineName: 'ＮＶＤ－５０００', dueDate: '2026-10-23',
      processingTypeDueDates: [{ processingType: '塗装', dueDate: '2026-10-22' }],
      // Deliberately reverse the API order and suggested ranks.
      parts: [part('PART-B', '033', 2), part('PART-A', '305', 1)]
    };
    triage = {
      zones: { danger: [candidate('S-100', 'danger')], caution: [], safe: [candidate('S-200', 'safe')] },
      selectedFseibans: ['S-100']
    };
    dailyPlan = {
      planDate: '2026-10-20', status: 'draft', confirmedAt: null, updatedAt: timestamp,
      items: [
        { fseiban: 'S-100', isInTodayTriage: true, isCarryover: false },
        { fseiban: 'S-200', isInTodayTriage: false, isCarryover: true }
      ],
      orderedFseibans: ['S-100', 'S-200']
    };
    api.summary.mockResolvedValue([...triage.zones.danger, ...triage.zones.safe]);
    api.triage.mockImplementation(async () => triage);
    api.dailyPlan.mockImplementation(async () => dailyPlan);
    api.globalRank.mockResolvedValue({ orderedFseibans: ['S-100', 'S-200'] });
    api.overview.mockResolvedValue({
      actorLocation: '第2工場', siteKey: '第2工場', deviceScopeKey: null, registeredDeviceScopeKeys: [], devices: []
    });
    api.proposal.mockResolvedValue({
      generatedAt: timestamp, locationKey: '第2工場', candidateCount: 2, orderedFseibans: ['S-100', 'S-200'], items: []
    });
    api.detail.mockImplementation(async (fseiban) => ({ ...detail, fseiban }));
    api.resources.mockResolvedValue({
      resources: ['305', '033'], resourceItems: [], resourceNameMap: { '305': ['研削機'] }
    });
    api.processingOptions.mockResolvedValue([
      { code: '塗装', label: '塗装', enabled: true, priority: 1 },
      { code: '廃止', label: '廃止済み処理', enabled: false, priority: 2 }
    ]);
    api.searchState.mockResolvedValue({
      state: { history: [] }, updatedAt: timestamp, etag: 'etag-1',
      locationScope: { deviceScopeKey: 'kiosk-1', siteKey: '第2工場' }
    });
    api.saveSearch.mockImplementation(async ({ state }) => ({ state, updatedAt: timestamp, etag: 'etag-2' }));
    api.saveSelection.mockImplementation(async ({ selectedFseibans }) => {
      triage = { ...triage, selectedFseibans };
      return { success: true, selectedFseibans };
    });
    api.saveDailyPlan.mockImplementation(async ({ orderedFseibans }) => {
      dailyPlan = { ...dailyPlan, orderedFseibans };
      return { success: true, ...dailyPlan };
    });
    api.savePriorities.mockImplementation(async (_fseiban, { orderedFhincds }) => {
      const priorities = orderedFhincds.map((fhincd, index) => ({ fhincd, priorityRank: index + 1 }));
      detail = {
        ...detail,
        parts: detail.parts.map((item) => ({
          ...item, currentPriorityRank: priorities.find((entry) => entry.fhincd === item.fhincd)!.priorityRank
        }))
      };
      return { success: true, priorities };
    });
    api.saveProcessing.mockImplementation(async (_fseiban, fhincd, { processingType }) => {
      detail = { ...detail, parts: detail.parts.map((item) => item.fhincd === fhincd ? { ...item, processingType } : item) };
      return { success: true, fhincd, processingType };
    });
    api.saveDueDate.mockImplementation(async (_fseiban, { dueDate }) => {
      detail = { ...detail, dueDate };
      return { success: true, dueDate, affectedRows: 2 };
    });
    api.saveNote.mockImplementation(async (fseiban, fhincd, { note }) => {
      detail = { ...detail, parts: detail.parts.map((item) => item.fhincd === fhincd ? { ...item, note } : item) };
      return { success: true, fseiban, fhincd, note };
    });
  });

  afterEach(() => {
    cleanup();
    client?.clear();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders headings, chooses the first planned seiban and orders parts by saved priority', async () => {
    renderPage();
    await ready();
    expect(screen.getByRole('heading', { name: '製番一覧（納期管理）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '部品優先順位（製番単位）' })).toBeInTheDocument();
    expect(screen.getByText('操作中:', { exact: false })).toHaveTextContent('S-100');
    expect(screen.getByText('機種: NVD-5000')).toBeInTheDocument();
    expect(screen.getByText('対象候補: 2')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['PART-A', 'PART-B']);
    expect(within(rows[0]).getByText('部品PART-A')).toBeInTheDocument();
    expect(within(rows[0]).getByText('0/1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('2.50')).toBeInTheDocument();
    expect(within(rows[0]).getByText('10/23(金)')).toBeInTheDocument();
    expect(api.detail).toHaveBeenCalledWith('S-100', noFilter);
    expect(api.globalRank).toHaveBeenCalledWith({ ...noFilter, targetLocation: undefined, rankingScope: 'globalShared' });
    expect(screen.getByRole('button', { name: '順序を保存' })).toBeDisabled();
  });

  it('shows loading messages while list, plan and detail requests are unresolved', async () => {
    api.triage.mockImplementation(() => new Promise(() => {}));
    api.dailyPlan.mockImplementation(() => new Promise(() => {}));
    api.globalRank.mockImplementation(() => new Promise(() => {}));
    api.detail.mockImplementation(() => new Promise(() => {}));
    api.searchState.mockResolvedValue({ state: { history: ['S-100'] }, updatedAt: timestamp, etag: 'etag-1' });
    renderPage();
    openDailyPlan();
    fireEvent.click(screen.getByRole('button', { name: '全体ランキング（主作業）を展開する' }));
    expect(await screen.findByText('読み込み中...')).toBeInTheDocument();
    expect(screen.getByText('候補を読み込み中...')).toBeInTheDocument();
    expect(screen.getByText('計画順を読み込み中...')).toBeInTheDocument();
    expect(screen.getByText('全体ランキングを読み込み中...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '納期日:' })).toBeDisabled();
  });

  it('displays triage, detail, global rank and manual overview API errors', async () => {
    api.triage.mockRejectedValue(new Error('triage unavailable'));
    api.detail.mockRejectedValue(new Error('detail unavailable'));
    api.globalRank.mockRejectedValue(new Error('rank unavailable'));
    api.overview.mockRejectedValue(new Error('overview unavailable'));
    renderPage();
    openDailyPlan();
    fireEvent.click(screen.getByRole('button', { name: '全体ランキング（主作業）を展開する' }));
    expect(await screen.findByText('候補取得に失敗しました')).toBeInTheDocument();
    expect(await screen.findByText('詳細取得に失敗しました。')).toBeInTheDocument();
    expect(await screen.findByText('全体ランキングの取得に失敗しました')).toBeInTheDocument();
    expect(await screen.findByText('手動順番状況の取得に失敗しました')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ignores blank searches and registers a trimmed seiban with the current ETag on Enter', async () => {
    renderPage();
    await ready();
    const input = screen.getByPlaceholderText('製番を検索');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    expect(api.saveSearch).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  S-200  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.saveSearch).toHaveBeenCalledWith({ state: { history: ['S-200'] }, ifMatch: 'etag-1' }));
    await waitFor(() => expect(screen.getByText('操作中:', { exact: false })).toHaveTextContent('S-200'));
    expect(input).toHaveValue('');
    expect(api.detail).toHaveBeenCalledWith('S-200', noFilter);
  });

  it('selects a candidate, saves target membership and filters to selected candidates', async () => {
    renderPage();
    await ready();
    const plan = openDailyPlan();
    fireEvent.click(plan.getByRole('button', { name: /余裕 \/ S-200/ }));
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('S-200', noFilter));
    expect(screen.getByText('操作中:', { exact: false })).toHaveTextContent('S-200');
    fireEvent.click(plan.getByRole('button', { name: '対象中のみ' }));
    expect(plan.queryByRole('button', { name: /余裕 \/ S-200/ })).not.toBeInTheDocument();
    expect(plan.getByRole('button', { name: /危険 \/ S-100/ })).toBeInTheDocument();
    fireEvent.click(plan.getByRole('button', { name: '全件表示' }));
    fireEvent.click(plan.getByRole('button', { name: '対象化' }));
    await waitFor(() => expect(api.saveSelection).toHaveBeenCalledWith({ selectedFseibans: ['S-100', 'S-200'] }));
    await waitFor(() => expect(plan.getAllByRole('button', { name: '対象中' })).toHaveLength(2));
    fireEvent.click(plan.getByRole('button', { name: '対象中のみ' }));
    expect(plan.getByRole('button', { name: /余裕 \/ S-200/ })).toBeInTheDocument();
  });

  it('filters parts by resource and blocks priority moves and saves until the filter is cleared', async () => {
    renderPage();
    await ready();
    const filter = screen.getByRole('combobox', { name: '資源CDフィルタ' });
    fireEvent.change(filter, { target: { value: '305' } });
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('S-100', { resourceCd: '305', resourceCategory: undefined }));
    await screen.findByRole('cell', { name: 'PART-A' });
    expect(screen.queryByRole('cell', { name: 'PART-B' })).not.toBeInTheDocument();
    expect(api.triage).toHaveBeenCalledWith({ resourceCd: '305', resourceCategory: undefined });
    const save = screen.getByRole('button', { name: '優先順位を保存' });
    expect(save).toBeDisabled();
    expect(within(partRow('PART-A')).getByRole('button', { name: '↓' })).toBeDisabled();
    fireEvent.click(save);
    expect(api.savePriorities).not.toHaveBeenCalled();
    fireEvent.change(filter, { target: { value: '' } });
    await screen.findByRole('cell', { name: 'PART-B' });
    expect(save).toBeEnabled();
    expect(within(partRow('PART-A')).getByRole('button', { name: '↓' })).toBeEnabled();
  });

  it('moves a part down and saves the complete priority order for the selected seiban', async () => {
    renderPage();
    await ready();
    expect(within(partRow('PART-A')).getByRole('button', { name: '↑' })).toBeDisabled();
    fireEvent.click(within(partRow('PART-A')).getByRole('button', { name: '↓' }));
    expect(within(partRow('PART-B')).getAllByRole('cell')[0]).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '優先順位を保存' }));
    await waitFor(() => expect(api.savePriorities).toHaveBeenCalledWith('S-100', { orderedFhincds: ['PART-B', 'PART-A'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: '優先順位を保存' })).toBeEnabled());
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('PART-B');
    expect(within(partRow('PART-A')).getByRole('button', { name: '↓' })).toBeDisabled();
  });

  it('marks a reordered daily plan dirty and clears the dirty state after saving', async () => {
    renderPage();
    await ready();
    const plan = openDailyPlan();
    expect(plan.getByRole('button', { name: '順序を保存' })).toBeDisabled();
    fireEvent.click(plan.getByRole('button', { name: '↓' }));
    expect(plan.getByRole('button', { name: /^1\. S-200/ })).toBeInTheDocument();
    expect(screen.getByText('未保存の変更あり')).toBeInTheDocument();
    fireEvent.click(plan.getByRole('button', { name: '順序を保存' }));
    await waitFor(() => expect(api.saveDailyPlan).toHaveBeenCalledWith({ orderedFseibans: ['S-200', 'S-100'] }));
    await waitFor(() => expect(plan.getByRole('button', { name: '順序を保存' })).toBeDisabled());
    expect(screen.getByText('保存済み')).toBeInTheDocument();
    expect(plan.getByRole('button', { name: /^1\. S-200/ })).toBeInTheDocument();
  });

  it('offers enabled processing types and saves a selection immediately for that part', async () => {
    renderPage();
    await ready();
    const select = within(partRow('PART-A')).getByRole('combobox');
    expect(within(select).getByRole('option', { name: '塗装' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: '廃止済み処理' })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: '塗装' } });
    await waitFor(() => expect(api.saveProcessing).toHaveBeenCalledWith('S-100', 'PART-A', { processingType: '塗装' }));
    await waitFor(() => expect(select).toHaveValue('塗装'));
    expect(api.savePriorities).not.toHaveBeenCalled();
  });

  it('cancels a due date dialog without saving and commits a calendar date immediately', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '納期日: 10/23(金)' }));
    let dialog = screen.getByRole('dialog', { name: '納期日' });
    expect(within(dialog).getByText('2026年10月')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(api.saveDueDate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '納期日: 10/23(金)' }));
    dialog = screen.getByRole('dialog', { name: '納期日' });
    fireEvent.click(within(dialog).getByRole('button', { name: '10月25日' }));
    await waitFor(() => expect(api.saveDueDate).toHaveBeenCalledWith('S-100', { dueDate: '2026-10-25' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '納期日: 10/25(日)' })).toBeInTheDocument();
    expect(api.saveProcessingDueDate).not.toHaveBeenCalled();
  });

  it('cancels a note draft and limits a saved note to 100 characters', async () => {
    renderPage();
    await ready();
    fireEvent.click(within(partRow('PART-A')).getByRole('button', { name: '編集' }));
    fireEvent.change(screen.getByRole('textbox', { name: '備考を入力' }), { target: { value: '破棄する下書き' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(api.saveNote).not.toHaveBeenCalled();
    fireEvent.click(within(partRow('PART-A')).getByRole('button', { name: '編集' }));
    const input = screen.getByRole('textbox', { name: '備考を入力' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('maxlength', '100');
    // fireEvent bypasses the browser limit; the modal also truncates at commit.
    fireEvent.change(input, { target: { value: 'あ'.repeat(101) } });
    fireEvent.click(within(screen.getByRole('dialog', { name: '備考' })).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.saveNote).toHaveBeenCalledWith('S-100', 'PART-A', { note: 'あ'.repeat(100) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await within(partRow('PART-A')).findByRole('button', { name: 'あ'.repeat(100) })).toBeInTheDocument();
  });

  it('keeps a failed note save open without displaying the API error and permits retry', async () => {
    api.saveNote.mockRejectedValueOnce(new Error('備考保存に失敗しました'));
    renderPage();
    await ready();
    fireEvent.click(within(partRow('PART-A')).getByRole('button', { name: '編集' }));
    fireEvent.change(screen.getByRole('textbox', { name: '備考を入力' }), { target: { value: '再試行する備考' } });
    const dialog = screen.getByRole('dialog', { name: '備考' });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    // The page exposes no mutation error UI, so wait for the real hook to settle.
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error'));
    expect(api.saveNote).toHaveBeenCalledWith('S-100', 'PART-A', { note: '再試行する備考' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox')).toHaveValue('再試行する備考');
    expect(screen.queryByText('備考保存に失敗しました')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.saveNote).toHaveBeenCalledTimes(2);
    expect(await within(partRow('PART-A')).findByRole('button', { name: '再試行する備考' })).toBeInTheDocument();
  });
});
