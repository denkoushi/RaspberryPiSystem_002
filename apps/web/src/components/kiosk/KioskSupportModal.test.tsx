import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { KioskSupportModal } from './KioskSupportModal';

const employees = [
  { id: 'e1', displayName: '組立 一郎', department: '組立課' },
  { id: 'e2', displayName: '機械 二郎', department: '製造部機械課' },
  { id: 'e3', displayName: '機械 三郎', department: '製造部機械課' },
  { id: 'e4', displayName: '無所属 四郎', department: null }
];

vi.mock('../../api/client', () => ({
  getResolvedClientKey: () => 'client-key',
  postKioskSupport: vi.fn()
}));

vi.mock('../../api/hooks', () => ({
  useKioskEmployees: () => ({ data: employees, isLoading: false })
}));

const renderModal = () =>
  render(
    <MemoryRouter initialEntries={['/kiosk']}>
      <KioskSupportModal isOpen onClose={() => undefined} />
    </MemoryRouter>
  );

const senderNames = () =>
  within(screen.getByLabelText(/送信者/))
    .getAllByRole('option')
    .map((option) => option.textContent?.trim());

describe('KioskSupportModal sender filter', () => {
  it('starts with the machining section and lists only its members', () => {
    renderModal();

    expect(screen.getByLabelText('部署')).toHaveValue('製造部機械課');
    expect(senderNames()).toEqual(['選択してください', '機械 二郎', '機械 三郎']);
  });

  it('switches the sender list with the department and clears the chosen sender', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/送信者/), { target: { value: 'e2' } });
    fireEvent.change(screen.getByLabelText('部署'), { target: { value: '組立課' } });

    expect(screen.getByLabelText(/送信者/)).toHaveValue('');
    expect(senderNames()).toEqual(['選択してください', '組立 一郎']);
  });

  it('groups employees without a department under 部署なし', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('部署'), { target: { value: '' } });

    expect(within(screen.getByLabelText('部署')).getByRole('option', { name: '部署なし' })).toBeInTheDocument();
    expect(senderNames()).toEqual(['選択してください', '無所属 四郎']);
  });
});
