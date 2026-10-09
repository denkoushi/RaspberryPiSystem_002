import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn(), update: vi.fn() }));
vi.mock('../../../api/client', () => ({
  getKioskInquiryReceiverSettings: mocks.get,
  lookupKioskInquiryEmployee: mocks.lookup,
  updateKioskInquiryReceiverSettings: mocks.update
}));

import { KioskInquiryReceiverSettings } from './KioskInquiryReceiverSettings';

const tanaka = { employeeId: 'employee-12', employeeCode: '0012', displayName: '田中' };
const sato = { employeeId: 'employee-34', employeeCode: '0034', displayName: '佐藤' };
const settings = {
  devices: [
    { id: 'desk', name: '事務所デスク端末', location: '事務所', inquiryReceiverEnabled: true },
    { id: 'site', name: '加工キオスク', location: '第2工場', inquiryReceiverEnabled: false }
  ], employees: [tanaka]
};
function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<KioskInquiryReceiverSettings />, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  });
}
async function add(code: string) {
  const input = await screen.findByRole('textbox', { name: '社員番号' });
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '追加' }));
}
beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ settings });
  mocks.lookup.mockReset().mockResolvedValue({ employee: sato });
  mocks.update.mockReset().mockResolvedValue({ settings: { ...settings, employees: [tanaka, sato] } });
});

describe('KioskInquiryReceiverSettings', () => {
  it('looks up an employee before adding their code and name', async () => {
    renderSettings();
    await add('0034');
    expect(await screen.findByText('佐藤')).toBeInTheDocument();
    expect(screen.getByText('0034')).toBeInTheDocument();
    expect(mocks.lookup).toHaveBeenCalledWith('0034');
    expect(screen.getByRole('textbox', { name: '社員番号' })).toHaveValue('');
  });

  it('rejects duplicate codes without looking them up', async () => {
    renderSettings();
    await add('0012');
    expect(screen.getByRole('alert')).toHaveTextContent('0012 は登録済みです');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('reports a missing code using errorCode', async () => {
    mocks.lookup.mockRejectedValue({ isAxiosError: true,
      response: { status: 404, data: { errorCode: 'KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND' } } });
    renderSettings();
    await add('9999');
    expect(await screen.findByRole('alert')).toHaveTextContent('社員番号 9999 は社員マスタにありません');
    expect(screen.queryByText('9999')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('saves selected devices and employee codes', async () => {
    renderSettings();
    await add('0034');
    await screen.findByText('佐藤');
    fireEvent.click(screen.getByRole('checkbox', { name: '加工キオスク' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('status')).toHaveTextContent('お問い合わせの受信設定を保存しました。');
    expect(mocks.update).toHaveBeenCalledWith({ receiverClientDeviceIds: ['desk', 'site'], employeeCodes: ['0012', '0034'] });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
  });

  it('removes employees and restores the saved draft', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: '0012 を外す' }));
    expect(screen.queryByText('田中')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '加工キオスク' }));
    fireEvent.click(screen.getByRole('button', { name: '変更を戻す' }));
    expect(screen.getByText('田中')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '加工キオスク' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('keeps the draft when saving fails', async () => {
    mocks.update.mockRejectedValue(new Error('network'));
    renderSettings();
    await screen.findByText('田中');
    fireEvent.click(screen.getByRole('checkbox', { name: '加工キオスク' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存に失敗しました。');
    expect(screen.getByRole('checkbox', { name: '加工キオスク' })).toBeChecked();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });
});
