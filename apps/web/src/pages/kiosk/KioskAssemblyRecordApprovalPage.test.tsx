import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyRecordApprovalPage } from './KioskAssemblyRecordApprovalPage';

import type { AssemblyWorkSessionDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const mockVerifyPassword = vi.fn();
const mockListSummaries = vi.fn();
const mockGetSession = vi.fn();
const mockResolveOperatorNfc = vi.fn();
const mockApprove = vi.fn();
const mockUseNfcStream = vi.fn();

vi.mock('../../api/client', () => ({
  verifyKioskAssemblyRecordApprovalAccessPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  listAssemblyWorkSessionSummaries: (...args: unknown[]) => mockListSummaries(...args),
  getAssemblyWorkSession: (...args: unknown[]) => mockGetSession(...args),
  resolveAssemblyOperatorNfc: (...args: unknown[]) => mockResolveOperatorNfc(...args),
  approveAssemblyWorkSessionRecordApproval: (...args: unknown[]) => mockApprove(...args)
}));

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: (enabled: boolean) => enabled ? mockUseNfcStream() : null
}));

const summary: AssemblyWorkSessionSummaryDto = {
  id: 'session-1',
  workUnitId: 'unit-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'completed',
  productNo: 'ASM-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: '2026-07-06T01:00:00.000Z',
  cancelledAt: null,
  updatedAt: '2026-07-06T01:00:00.000Z',
  templateModelCode: 'MACHINE-X',
  templateProcedurePattern: '標準',
  templateName: 'MACHINE-X 標準',
  templateVersion: 1,
  currentAreaId: null,
  currentAreaName: null,
  currentBoltId: null,
  currentBoltMarkerNo: null,
  acceptedBoltCount: 1,
  totalBoltCount: 1,
  approval: null
};

const detail: AssemblyWorkSessionDto = {
  id: 'session-1',
  workUnitId: 'unit-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'completed',
  productNo: 'ASM-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorEmployeeId: null,
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  currentAreaId: null,
  currentBoltId: null,
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: '2026-07-06T01:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T01:00:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MACHINE-X',
    procedurePattern: '標準',
    name: 'MACHINE-X 標準',
    version: 1,
    isActive: true,
    procedureDocumentId: 'doc-1',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    procedureDocument: {
      id: 'doc-1',
      name: '手順書',
      imageRelativePath: '/assembly/procedures/doc-1.png',
      isActive: true,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    },
    areas: []
  },
  checkSummary: { requiredTotal: 1, requiredCompleted: 1, allRequiredCompleted: true },
  checkItems: [{
    id: 'check-1', markerNo: 1, label: 'ガタ無し', required: true,
    xRatio: 0.1, yRatio: 0.1, sortOrder: 1, kioskDocumentId: null,
    assemblyProcedureDocumentId: null, pageIndex: 0,
    record: { checkItemId: 'check-1', checked: true, checkedByOperatorName: '佐藤', checkedAt: '2026-07-06T00:58:00.000Z' }
  }],
  torqueRecords: [],
  restartLogs: [],
  approval: null,
  areaTorqueSummaries: [
    {
      areaId: 'area-1',
      areaCode: '13',
      areaName: 'ストッパー取付',
      processNo: '7',
      totalBoltCount: 1,
      acceptedOkCount: 1,
      ngCount: 0,
      ignoredCount: 0
    }
  ]
};

function renderPage(initialEntry = '/kiosk/assembly/record-approvals', enterPin = true) {
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/kiosk/assembly/record-approvals" element={<KioskAssemblyRecordApprovalPage />} />
        <Route path="/kiosk/assembly" element={<h1>組立ホーム</h1>} />
      </Routes>
    </MemoryRouter>
  );
  if (enterPin) for (const digit of '2520') fireEvent.click(screen.getByRole('button', { name: digit, exact: true }));
  return view;
}

describe('KioskAssemblyRecordApprovalPage', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
    mockListSummaries.mockReset();
    mockGetSession.mockReset();
    mockResolveOperatorNfc.mockReset();
    mockApprove.mockReset();
    mockUseNfcStream.mockReset();
    mockUseNfcStream.mockReturnValue(null);
    mockVerifyPassword.mockResolvedValue({ success: true });
    mockListSummaries.mockResolvedValue([summary]);
    mockGetSession.mockResolvedValue(detail);
    vi.spyOn(window, 'prompt').mockReturnValue('2520');
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('closes the PIN dialog on back, retains the URL/session and offers reauthentication', async () => {
    renderPage('/kiosk/assembly/record-approvals?sessionId=session-1', false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '記録確認の暗証番号' })).toBeInTheDocument();
    expect(mockVerifyPassword).not.toHaveBeenCalled(); expect(window.prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '組立記録確認' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再認証' }));
    for (const digit of '2520') fireEvent.click(screen.getByRole('button', { name: digit, exact: true }));
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith('session-1'));
  });
  it('returns home using the in-page link after cancelling authentication', async () => {
    renderPage('/kiosk/assembly/record-approvals', false);
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    fireEvent.click(screen.getByRole('link', { name: '組立へ戻る' }));
    expect(await screen.findByRole('heading', { name: '組立ホーム' })).toBeInTheDocument();
  });
  it('keeps the PIN gate available after a network failure', async () => {
    mockVerifyPassword.mockRejectedValue(new Error('offline')); renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('通信できません');
    expect(screen.getByRole('link', { name: '組立へ戻る' })).toBeInTheDocument();
    expect(mockListSummaries).not.toHaveBeenCalled(); expect(window.alert).not.toHaveBeenCalled();
  });
  it('renders completed session detail after password authentication', async () => {
    renderPage();

    await waitFor(() => expect(mockVerifyPassword).toHaveBeenCalledWith({ password: '2520' }));
    expect(await screen.findByRole('heading', { name: '記録確認', exact: true })).toBeInTheDocument();
    expect((await screen.findAllByText('ASM-001')).length).toBeGreaterThan(0);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith('session-1'));
    expect(await screen.findByText('7 · ストッパー取付')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '承認: タグをかざす' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '再認証' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '組立へ戻る' })).toHaveAttribute('href', '/kiosk/assembly');
  });

  it('shows a placeholder for blank process and area labels', async () => {
    mockGetSession.mockResolvedValueOnce({
      ...detail,
      areaTorqueSummaries: detail.areaTorqueSummaries.map((area) => ({
        ...area,
        processNo: '',
        areaName: ''
      }))
    });

    renderPage();

    const table = await screen.findByRole('table', { name: 'エリア別トルク実績' });
    const cells = table.querySelectorAll('tbody tr td');
    expect(cells[0]).toHaveTextContent('— · —');
  });

  it('selects initial session from query parameter', async () => {
    renderPage('/kiosk/assembly/record-approvals?sessionId=session-1');

    await waitFor(() => expect(mockGetSession).toHaveBeenCalledWith('session-1'));
  });


  it('filters pending, approved and all records with pressed chips and a pending count', async () => {
    const approval = {
      approvedAt: '2026-07-06T02:30:00.000Z', approverEmployeeId: 'employee-2',
      approverEmployeeCodeSnapshot: 'E002', approverEmployeeNameSnapshot: '高橋',
      approverNfcTagUidSnapshot: 'tag-2', comment: null, clientDeviceId: null, clientDeviceNameSnapshot: null
    };
    mockListSummaries.mockResolvedValue([summary, { ...summary, id: 'session-2', productNo: 'ASM-002', approval }]);
    mockGetSession.mockImplementation(async (id: string) => id === 'session-2' ? { ...detail, id, productNo: 'ASM-002', approval } : detail);
    renderPage();
    const pending = await screen.findByRole('button', { name: '未承認 1', exact: true });
    expect(pending).toHaveAttribute('aria-pressed', 'true');
    const list = within(screen.getByRole('region', { name: '完了製品一覧' }));
    expect(list.getByRole('button', { name: /ASM-001/ })).toBeInTheDocument();
    expect(list.queryByRole('button', { name: /ASM-002/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '承認済み', exact: true }));
    expect(pending).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '承認済み', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(list.queryByRole('button', { name: /ASM-001/ })).not.toBeInTheDocument();
    expect(list.getByRole('button', { name: /ASM-002/ })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByRole('status', { name: '承認状態' })).toHaveTextContent('承認済み 高橋 07/06 11:30');
    expect(screen.queryByRole('button', { name: /承認:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全て', exact: true }));
    expect(screen.getByRole('button', { name: '全て', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(list.getByRole('button', { name: /ASM-001/ })).toBeInTheDocument();
    expect(list.getByRole('button', { name: /ASM-002/ })).toBeInTheDocument();
  });

  it('searches product numbers and operators immediately within the selected filter', async () => {
    mockListSummaries.mockResolvedValue([summary, { ...summary, id: 'session-2', productNo: 'ASM-002', operatorNameSnapshot: '鈴木' }]);
    mockGetSession.mockImplementation(async (id: string) => ({ ...detail, id, productNo: id === 'session-2' ? 'ASM-002' : 'ASM-001' }));
    renderPage();
    await screen.findByRole('button', { name: '未承認 2', exact: true });
    const list = within(screen.getByRole('region', { name: '完了製品一覧' }));
    const search = screen.getByRole('searchbox', { name: '製番・作業者' });
    fireEvent.change(search, { target: { value: '  asm-002  ' } });
    expect(list.queryByRole('button', { name: /ASM-001/ })).not.toBeInTheDocument();
    expect(list.getByRole('button', { name: /ASM-002/ })).toBeInTheDocument();
    await waitFor(() => expect(mockGetSession).toHaveBeenLastCalledWith('session-2'));
    fireEvent.change(search, { target: { value: '佐藤' } });
    expect(list.getByRole('button', { name: /ASM-001/ })).toBeInTheDocument();
    expect(list.queryByRole('button', { name: /ASM-002/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '該当なし' } });
    expect(screen.getByText('該当する完了製品がありません')).toBeInTheDocument();
    expect(await screen.findByText('確認する完了製品を選択してください。')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(list.getByRole('button', { name: /ASM-002/ })).toBeInTheDocument();
    expect(mockListSummaries).toHaveBeenCalledTimes(1);
  });

  it('reloads the list API from the 44px button at the end of the filter row', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ASM-001' });
    const reload = screen.getByRole('button', { name: '再読込' });
    expect(reload).toHaveClass('h-11', 'w-11', 'ml-auto');
    expect(reload.parentElement?.lastElementChild).toBe(reload);
    expect(within(reload.parentElement!).getByRole('button', { name: '全て' })).toBeInTheDocument();
    expect(reload.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    mockListSummaries.mockResolvedValue([summary, { ...summary, id: 'session-2', productNo: 'ASM-002' }]);
    fireEvent.click(reload);
    expect(await screen.findByRole('button', { name: /ASM-002/ })).toBeInTheDocument();
    expect(mockListSummaries).toHaveBeenCalledTimes(2);
    expect(mockListSummaries).toHaveBeenLastCalledWith({ status: 'completed', limit: 50 });
    expect(screen.getByRole('button', { name: /ASM-001/ })).toHaveAttribute('aria-current', 'true');
  });

  it('shows a short list error and retries a failed initial fetch with the same button', async () => {
    mockListSummaries.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const alert = await screen.findByRole('alert');
    const list = screen.getByRole('region', { name: '完了製品一覧' });
    expect(within(list).getByRole('alert')).toHaveTextContent('一覧の取得に失敗しました。');
    expect(screen.queryByText('該当する完了製品がありません')).not.toBeInTheDocument();
    const retry = within(alert.parentElement!).getByRole('button', { name: '再読込' });
    expect(retry).toHaveClass('h-11', 'w-11');
    expect(within(list).getAllByRole('button', { name: '再読込' })).toHaveLength(2);
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'ASM-001' })).toBeInTheDocument();
    expect(mockListSummaries).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps existing rows and detail after a reload failure and clears the error on retry', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ASM-001' });
    mockListSummaries.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '再読込' }));
    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /ASM-001/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('heading', { name: 'ASM-001' })).toBeInTheDocument();
    fireEvent.click(within(alert.parentElement!).getByRole('button', { name: '再読込' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '再読込' })).toBeEnabled());
    expect(mockListSummaries).toHaveBeenCalledTimes(3);
  });

  it('lets a row replace the initial URL selection and marks only that row current', async () => {
    mockListSummaries.mockResolvedValue([summary, { ...summary, id: 'session-2', productNo: 'ASM-002' }]);
    mockGetSession.mockImplementation(async (id: string) => ({ ...detail, id, productNo: id === 'session-2' ? 'ASM-002' : 'ASM-001' }));
    renderPage('/kiosk/assembly/record-approvals?sessionId=session-2');
    const first = await screen.findByRole('button', { name: /ASM-001/ });
    const second = screen.getByRole('button', { name: /ASM-002/ });
    expect(second).toHaveAttribute('aria-current', 'true');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(second).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('heading', { name: 'ASM-001' })).toBeInTheDocument();
    expect(mockGetSession).toHaveBeenLastCalledWith('session-1');
  });

  it('shows the three pairs of header values and side-by-side result tables', async () => {
    renderPage();
    const heading = await screen.findByRole('heading', { name: 'ASM-001' });
    const header = heading.parentElement!;
    const valueFor = (label: string) => within(header).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(valueFor('機種')).toHaveTextContent('MACHINE-X');
    expect(valueFor('作業者')).toHaveTextContent('佐藤');
    expect(valueFor('完了')).toHaveTextContent('07/06 10:00');
    expect(valueFor('テンプレ')).toHaveTextContent('MACHINE-X 標準 v1');
    expect(valueFor('締付')).toHaveTextContent('1 / 1');
    expect(valueFor('必須チェック')).toHaveTextContent('1 / 1');
    const torque = screen.getByRole('table', { name: 'エリア別トルク実績' });
    const check = screen.getByRole('table', { name: 'チェック実績' });
    for (const name of ['エリア', 'OK', 'NG/無視']) {
      expect(within(torque).getByRole('columnheader', { name })).toHaveAttribute('scope', 'col');
    }
    expect(torque.querySelector('thead')).not.toHaveClass('sr-only');
    expect(torque.querySelector('thead')).toHaveClass('text-[16px]', 'text-[#9fadb9]');
    expect(within(torque).getByRole('cell', { name: '1 / 1' })).toHaveClass('text-[#3ba776]');
    expect(within(check).getByRole('cell', { name: '済' })).toHaveClass('text-[#3ba776]');
    expect(within(check).getByRole('cell', { name: '09:58' })).toBeInTheDocument();
    expect(torque.parentElement?.parentElement).toBe(check.parentElement?.parentElement);
  });

  it('shows incomplete results in red and keeps the check table for optional or empty checks', async () => {
    mockGetSession.mockResolvedValue({
      ...detail,
      checkSummary: { requiredTotal: 0, requiredCompleted: 0, allRequiredCompleted: true },
      checkItems: detail.checkItems.map(item => ({ ...item, required: false, record: null })),
      areaTorqueSummaries: detail.areaTorqueSummaries.map(area => ({ ...area, acceptedOkCount: 0, ngCount: 1, ignoredCount: 2 }))
    });
    renderPage();
    const torque = await screen.findByRole('table', { name: 'エリア別トルク実績' });
    expect(within(torque).getByRole('cell', { name: '0 / 1' })).toHaveClass('text-[#e5484d]');
    expect(within(torque).getByText('NG 1')).toHaveClass('text-[#e5484d]');
    expect(within(torque).getByText('無視 2')).toHaveClass('text-[#e5484d]');
    expect(within(torque).getByRole('cell', { name: 'NG 1 無視 2' })).toBeInTheDocument();
    const check = screen.getByRole('table', { name: 'チェック実績' });
    expect(within(check).getByText('任意')).toBeInTheDocument();
    expect(within(check).getByRole('cell', { name: '未' })).toHaveClass('text-[#e5484d]');
    expect(within(check).getByRole('cell', { name: '—' })).toBeInTheDocument();
    expect(screen.getByText('必須チェック').nextElementSibling).toHaveTextContent('0 / 0');
  });

  it('keeps the NFC lookup and explicit approval API flow in the compact badge', async () => {
    const approval = {
      approvedAt: '2026-07-06T02:30:00.000Z', approverEmployeeId: 'employee-2',
      approverEmployeeCodeSnapshot: 'E002', approverEmployeeNameSnapshot: '高橋',
      approverNfcTagUidSnapshot: 'tag-2', comment: null, clientDeviceId: null, clientDeviceNameSnapshot: null
    };
    mockResolveOperatorNfc.mockResolvedValue({ employeeId: 'employee-2', displayName: '高橋' });
    mockApprove.mockResolvedValue({ ...detail, approval });
    renderPage();
    expect(await screen.findByRole('button', { name: '承認: タグをかざす' })).toBeDisabled();
    mockListSummaries.mockResolvedValue([{ ...summary, approval }]);
    mockUseNfcStream.mockReturnValue({ uid: 'tag-2', timestamp: '2026-07-06T02:29:00.000Z' });
    fireEvent.click(screen.getByRole('button', { name: '全て', exact: true }));
    const approve = await screen.findByRole('button', { name: '承認: 高橋で承認' });
    expect(mockResolveOperatorNfc).toHaveBeenCalledWith('tag-2');
    expect(mockApprove).not.toHaveBeenCalled();
    fireEvent.click(approve);
    expect(await screen.findByRole('status', { name: '承認状態' })).toHaveTextContent('承認済み 高橋 07/06 11:30');
    expect(mockApprove).toHaveBeenCalledWith('session-1', { approverEmployeeTagUid: 'tag-2' });
    await waitFor(() => expect(mockListSummaries).toHaveBeenCalledTimes(2));
    expect(mockResolveOperatorNfc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '未承認 0', exact: true })).toBeInTheDocument();
  });

  it('announces NFC lookup progress and the resolved approver beside the badge', async () => {
    let resolveLookup!: (value: { employeeId: string; displayName: string }) => void;
    mockResolveOperatorNfc.mockImplementation(() => new Promise(resolve => { resolveLookup = resolve; }));
    renderPage();
    const badge = await screen.findByRole('button', { name: '承認: タグをかざす' });
    const status = screen.getByRole('status', { name: '承認者照合' });
    expect(status.parentElement).toBe(badge.parentElement);
    expect(status).toHaveClass('max-h-11');
    mockUseNfcStream.mockReturnValue({ uid: 'tag-2', timestamp: '1' });
    fireEvent.click(screen.getByRole('button', { name: '全て', exact: true }));
    expect(status).toHaveTextContent('照合中…');
    expect(badge).toBeDisabled();
    await act(async () => resolveLookup({ employeeId: 'employee-2', displayName: '高橋' }));
    expect(status).toHaveTextContent('承認者: 高橋');
    expect(status.children).toHaveLength(0);
    expect(screen.getByRole('button', { name: '承認: 高橋で承認' })).toBeEnabled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('announces a short NFC failure beside the badge', async () => {
    mockResolveOperatorNfc.mockRejectedValueOnce(new Error('unregistered'));
    renderPage();
    const badge = await screen.findByRole('button', { name: '承認: タグをかざす' });
    mockUseNfcStream.mockReturnValue({ uid: 'unknown', timestamp: '1' });
    fireEvent.click(screen.getByRole('button', { name: '全て', exact: true }));
    const status = screen.getByRole('status', { name: '承認者照合' });
    await waitFor(() => expect(status).toHaveTextContent('未登録のNFCタグです。'));
    expect(status.parentElement).toBe(badge.parentElement);
    expect(status).toHaveClass('max-h-11');
    expect(status.children).toHaveLength(0);
    expect(badge).toBeDisabled();
  });

  it('displays NFC and approval failures near the badge and allows retrying approval', async () => {
    mockResolveOperatorNfc.mockRejectedValueOnce(new Error('unregistered'));
    renderPage();
    await screen.findByRole('button', { name: '承認: タグをかざす' });
    mockUseNfcStream.mockReturnValue({ uid: 'unknown', timestamp: '1' });
    fireEvent.click(screen.getByRole('button', { name: '全て', exact: true }));
    await waitFor(() => expect(screen.getByRole('status', { name: '承認者照合' })).toHaveTextContent('未登録のNFCタグです。'));
    expect(screen.getByRole('button', { name: '承認: タグをかざす' })).toBeDisabled();
    expect(mockApprove).not.toHaveBeenCalled();
    mockResolveOperatorNfc.mockResolvedValue({ employeeId: 'employee-2', displayName: '高橋' });
    mockUseNfcStream.mockReturnValue({ uid: 'tag-2', timestamp: '2' });
    fireEvent.click(screen.getByRole('button', { name: '未承認 1', exact: true }));
    const approve = await screen.findByRole('button', { name: '承認: 高橋で承認' });
    mockApprove.mockRejectedValue({ response: { data: { message: '承認処理に失敗しました。' } } });
    fireEvent.click(approve);
    await waitFor(() => expect(screen.getByRole('status', { name: '承認者照合' })).toHaveTextContent('承認処理に失敗しました。'));
    expect(approve).toBeEnabled();
  });

  it('keeps both tables visible when the record has no checks', async () => {
    mockGetSession.mockResolvedValue({ ...detail, checkItems: [], checkSummary: { requiredTotal: 0, requiredCompleted: 0, allRequiredCompleted: true } });
    renderPage();
    await screen.findByRole('table', { name: 'エリア別トルク実績' });
    const check = screen.getByRole('table', { name: 'チェック実績' });
    expect(check.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(screen.getByText('必須チェック').nextElementSibling).toHaveTextContent('0 / 0');
  });

  it('shows password gate when authentication fails', async () => {
    mockVerifyPassword.mockResolvedValue({ success: false });
    renderPage();

    expect(await screen.findByText('違います')).toBeInTheDocument();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '組立へ戻る' })).toBeInTheDocument();
    expect(mockListSummaries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(mockVerifyPassword).toHaveBeenCalledTimes(2));
  });
});
