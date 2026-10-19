import { KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KIOSK_HEADER_TAB_LABELS } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderTabLabels';
import { KioskPortalControls } from '../../features/kiosk/portal/KioskPortalControls';
import { useKioskPortalLargeScreen } from '../../features/kiosk/portal/useKioskPortalLargeScreen';

import { KioskPortalPage } from './KioskPortalPage';

const mocks = vi.hoisted(() => ({ config: { defaultMode: 'PHOTO', portalHiddenTabIds: [] as string[], navTabOrder: ['rigging_borrow', 'borrow'] }, save: vi.fn(), verify: vi.fn() }));
vi.mock('../../api/hooks', () => ({
  useKioskConfig: () => ({ data: mocks.config }),
  useUpdateKioskPortalCards: () => ({ mutateAsync: mocks.save, isPending: false }),
  useVerifyKioskDueManagementAccessPassword: () => ({ mutateAsync: mocks.verify, isPending: false })
}));

function Shell() {
  const { largeScreen, toggleLargeScreen } = useKioskPortalLargeScreen();
  return <><KioskPortalControls clientKey="test-device" largeScreen={largeScreen} onToggleLargeScreen={toggleLargeScreen} /><Outlet context={{ portalLargeScreen: largeScreen }} /></>;
}
function showPortal() {
  return render(<MemoryRouter initialEntries={['/kiosk/portal']}><Routes>
    <Route element={<Shell />}><Route path="/kiosk/portal" element={<KioskPortalPage />} /></Route>
    <Route path="/kiosk/photo" element={<p>写真持出の遷移先</p>} />
    <Route path="/kiosk/production-schedule/due-management" element={<p>認証済み納期管理</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.config.portalHiddenTabIds = [];
  mocks.save.mockResolvedValue({ ok: true });
  mocks.verify.mockResolvedValue({ success: true, token: 'test-token' });
});

describe('KioskPortalPage', () => {
  it('renders every card in grouped header order and navigates using PHOTO mode', () => {
    showPortal();
    for (const id of KIOSK_REORDERABLE_HEADER_TAB_IDS) {
      expect(screen.getByRole(id === 'due_management' ? 'button' : 'link', { name: KIOSK_HEADER_TAB_LABELS[id] })).toBeInTheDocument();
    }
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('吊具 持出');
    expect(links[1]).toHaveTextContent('持出');
    fireEvent.click(screen.getByRole('link', { name: '持出' }));
    expect(screen.getByText('写真持出の遷移先')).toBeInTheDocument();
  });
  it('omits hidden cards and shows the empty state when all are hidden', () => {
    mocks.config.portalHiddenTabIds = ['borrow'];
    const view = showPortal();
    expect(screen.queryByRole('link', { name: '持出' })).not.toBeInTheDocument();
    view.unmount();
    mocks.config.portalHiddenTabIds = [...KIOSK_REORDERABLE_HEADER_TAB_IDS];
    showPortal();
    expect(screen.getByText('出すカードがありません。上の歯車で選んでください')).toBeInTheDocument();
  });
  it('persists large mode across remounts and uses fixed larger cards', () => {
    const view = showPortal();
    fireEvent.click(screen.getByRole('button', { name: '50インチ表示' }));
    expect(localStorage.getItem('kiosk-portal-large-screen')).toBe('true');
    expect(screen.getByRole('link', { name: /持出・返却 持出$/ })).toHaveClass('w-[262px]', 'h-[184px]');
    view.unmount();
    showPortal();
    expect(screen.getByRole('button', { name: '50インチ表示' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('still toggles when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    showPortal();
    fireEvent.click(screen.getByRole('button', { name: '50インチ表示' }));
    expect(screen.getByRole('button', { name: '50インチ表示' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('uses the same password navigation for the due-management card', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('password');
    showPortal();
    fireEvent.click(screen.getByRole('button', { name: '納期管理' }));
    await waitFor(() => expect(screen.getByText('認証済み納期管理')).toBeInTheDocument());
    expect(mocks.verify).toHaveBeenCalledWith({ password: 'password' });
  });
  it('cancels draft changes, supports all/none, and saves hidden ids', async () => {
    mocks.config.portalHiddenTabIds = ['borrow'];
    showPortal();
    fireEvent.click(screen.getByRole('button', { name: '出すカードを選ぶ' }));
    expect(screen.getByRole('checkbox', { name: '持出' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '出すカードを選ぶ' }));
    expect(screen.getByRole('checkbox', { name: '持出' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'なし' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '通話' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.save).toHaveBeenCalledWith(KIOSK_REORDERABLE_HEADER_TAB_IDS.filter((id) => id !== 'call'));
  });
  it('keeps the draft and reports save failures in the modal', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline'));
    showPortal();
    fireEvent.click(screen.getByRole('button', { name: '出すカードを選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした');
    expect(screen.getByRole('dialog', { name: 'この端末に出すカード' })).toBeInTheDocument();
  });
});
