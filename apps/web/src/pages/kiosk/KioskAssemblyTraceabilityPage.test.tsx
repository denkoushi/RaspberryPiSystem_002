import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyTraceabilityPage } from './KioskAssemblyTraceabilityPage';

const mockVerify = vi.fn();
const mockList = vi.fn();
const mockResolve = vi.fn();
const mockLink = vi.fn();
const mockAssignFormal = vi.fn();
const mockCorrectFormal = vi.fn();
const mockReassign = vi.fn();
const mockUnlink = vi.fn();

vi.mock('../../api/client', () => ({
  verifyKioskAssemblyTraceabilityAccessPassword: (...args: unknown[]) => mockVerify(...args),
  listAssemblyTraceabilityWorkUnits: (...args: unknown[]) => mockList(...args),
  resolveAssemblyTraceabilityWorkUnit: (...args: unknown[]) => mockResolve(...args),
  linkAssemblyWorkUnits: (...args: unknown[]) => mockLink(...args),
  assignAssemblyFormalIdentifier: (...args: unknown[]) => mockAssignFormal(...args),
  correctAssemblyFormalIdentifier: (...args: unknown[]) => mockCorrectFormal(...args),
  reassignAssemblyWorkUnit: (...args: unknown[]) => mockReassign(...args),
  unlinkAssemblyWorkUnits: (...args: unknown[]) => mockUnlink(...args)
}));

vi.mock('../../features/barcode-scan', () => ({ useSerialBarcodeStream: vi.fn() }));

const detail = {
  workUnit: {
    id: 'final-id', workId: 'FINAL-001', status: 'completed' as const, productNo: 'P-001', targetUnit: '完成品', templateName: '標準 v1', completedAt: '2026-07-20T00:00:00.000Z', invalidation: null
  },
  activeParent: null,
  activeChildren: [],
  root: {
    workUnit: {
      id: 'final-id', workId: 'FINAL-001', status: 'completed' as const, productNo: 'P-001', targetUnit: '完成品', templateName: '標準 v1', completedAt: '2026-07-20T00:00:00.000Z', invalidation: null
    },
    formalIdentifier: null
  },
  formalIdentifierHistory: [],
  compositionHistory: [],
  genealogy: []
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly/traceability']}>
      <Routes>
        <Route path="/kiosk/assembly/traceability" element={<KioskAssemblyTraceabilityPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyTraceabilityPage', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockList.mockReset();
    mockResolve.mockReset();
    mockLink.mockReset();
    mockAssignFormal.mockReset();
    mockCorrectFormal.mockReset();
    mockReassign.mockReset();
    mockUnlink.mockReset();
    mockVerify.mockResolvedValue({ success: true });
    mockList.mockResolvedValue([]);
    mockResolve.mockResolvedValue(detail);
    mockLink.mockResolvedValue({ id: 'link-1' });
    mockAssignFormal.mockResolvedValue({ id: 'formal-1', formalId: 'FORMAL-001' });
    vi.spyOn(window, 'prompt').mockReturnValue('2520');
  });

  it('authenticates, resolves a parent work ID, and sends work-ID contracts', async () => {
    renderPage();

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith({ password: '2520' }));
    const parentInput = await screen.findByPlaceholderText('作業用IDをスキャンまたは入力');
    fireEvent.change(parentInput, { target: { value: 'final-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('FINAL-001'));
    expect(await screen.findByText('子アセンブリを追加')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('完了済み子の作業用ID'), { target: { value: 'sub-001' } });
    fireEvent.click(screen.getByRole('button', { name: '紐付け' }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith({
      parentWorkId: 'FINAL-001',
      childWorkId: 'sub-001',
      accessPassword: '2520'
    }));
  });

  it('uses the formal-ID field only for the completed root', async () => {
    renderPage();
    const parentInput = await screen.findByPlaceholderText('作業用IDをスキャンまたは入力');
    fireEvent.change(parentInput, { target: { value: 'FINAL-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('正式ID');

    fireEvent.change(screen.getByPlaceholderText('正式IDをスキャンまたは入力'), { target: { value: 'formal-001' } });
    fireEvent.click(screen.getByRole('button', { name: '付与' }));
    await waitFor(() => expect(mockAssignFormal).toHaveBeenCalledWith({
      workId: 'FINAL-001', formalId: 'formal-001', accessPassword: '2520'
    }));
  });

  it.each(['親変更', '解除', '訂正'])('requires dialog fields for %s and preserves the API payload', async (action) => {
    mockResolve.mockResolvedValue({
      ...detail,
      activeChildren: [{ linkId: 'link-1', workUnit: { ...detail.workUnit, id: 'child-id', workId: 'SUB-001' } }],
      formalIdentifierHistory: [{ id: 'formal-1', formalId: 'FORMAL-001', supersededAt: null }]
    });
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText('作業用IDをスキャンまたは入力'), { target: { value: 'FINAL-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('子アセンブリを追加');
    expect(screen.queryByLabelText('理由')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('変更先 親作業用ID')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('正式IDをスキャンまたは入力'), { target: { value: 'FORMAL-002' } });
    fireEvent.click(screen.getByRole('button', { name: action }));

    const dialog = within(screen.getByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: '確定する' });
    expect(dialog.getAllByRole('button').map((button) => button.textContent)).toEqual(['キャンセル', '確定する']);
    expect(confirm).toBeDisabled();
    expect(dialog.getByRole('status')).toHaveTextContent('理由を入力');
    fireEvent.change(dialog.getByLabelText('理由'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('理由'), { target: { value: '誤登録の修正' } });
    if (action === '親変更') {
      expect(confirm).toBeDisabled();
      expect(dialog.getByRole('status')).toHaveTextContent('変更先を入力');
      fireEvent.change(dialog.getByLabelText('変更先 親作業用ID'), { target: { value: 'FINAL-002' } });
    } else {
      expect(dialog.queryByLabelText('変更先 親作業用ID')).not.toBeInTheDocument();
    }
    expect(confirm).toBeEnabled();
    expect(dialog.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(confirm);

    const api = action === '親変更' ? mockReassign : action === '解除' ? mockUnlink : mockCorrectFormal;
    const payload = { accessPassword: '2520', reason: '誤登録の修正', ...(action === '親変更' ? { parentWorkId: 'FINAL-002' } : action === '訂正' ? { formalId: 'FORMAL-002' } : {}) };
    await waitFor(() => expect(api).toHaveBeenCalledExactlyOnceWith(action === '訂正' ? 'formal-1' : 'link-1', payload));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // A subsequent action must collect fresh dialog inputs after a successful save.
    fireEvent.change(screen.getByPlaceholderText('正式IDをスキャンまたは入力'), { target: { value: 'FORMAL-003' } });
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(screen.getByLabelText('理由')).toHaveValue('');
    if (action === '親変更') expect(screen.getByLabelText('変更先 親作業用ID')).toHaveValue('');
    expect(screen.getByRole('button', { name: '確定する' })).toBeDisabled();
  });

  it.each(['cancel', 'escape', 'backdrop'])('clears dialog fields on %s without changing the composition', async (closeMethod) => {
    mockResolve.mockResolvedValue({
      ...detail,
      activeChildren: [{ linkId: 'link-1', workUnit: { ...detail.workUnit, id: 'child-id', workId: 'SUB-001' } }]
    });
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText('作業用IDをスキャンまたは入力'), { target: { value: 'FINAL-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    fireEvent.click(await screen.findByRole('button', { name: '親変更' }));
    fireEvent.change(screen.getByLabelText('理由'), { target: { value: '誤登録' } });
    fireEvent.change(screen.getByLabelText('変更先 親作業用ID'), { target: { value: 'FINAL-002' } });
    if (closeMethod === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    else if (closeMethod === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.mouseDown(screen.getByRole('dialog'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockReassign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '親変更' }));
    expect(screen.getByLabelText('理由')).toHaveValue('');
    expect(screen.getByLabelText('変更先 親作業用ID')).toHaveValue('');
    expect(screen.getByRole('button', { name: '確定する' })).toBeDisabled();
  });

  it('shows invalidation reason and timestamp for a directly resolved work ID', async () => {
    mockResolve.mockResolvedValueOnce({
      ...detail,
      workUnit: {
        ...detail.workUnit,
        invalidation: {
          reason: '誤った製番で登録したため',
          invalidatedAt: '2026-07-26T06:30:00.000Z',
          sourceState: 'completed'
        }
      }
    });
    renderPage();

    const parentInput = await screen.findByPlaceholderText('作業用IDをスキャンまたは入力');
    fireEvent.change(parentInput, { target: { value: 'FINAL-001' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    expect(await screen.findByText('削除済み（読み取り専用）')).toBeInTheDocument();
    expect(screen.getByText('削除理由: 誤った製番で登録したため')).toBeInTheDocument();
    expect(screen.getByLabelText('作業用IDの削除履歴')).toHaveTextContent('削除日時:');
  });
});
