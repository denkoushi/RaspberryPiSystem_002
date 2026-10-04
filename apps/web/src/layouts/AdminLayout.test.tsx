import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AdminLayout } from './AdminLayout';
import { ADMIN_NAV_GROUPS, filterAdminNavGroups, findActiveAdminNav } from './adminNavigation';

const logout = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin' }, logout })
}));

vi.mock('../api/hooks', () => ({
  useNetworkModeStatus: () => ({
    data: {
      detectedMode: 'maintenance',
      configuredMode: 'local',
      status: 'internet_connected',
      checkedAt: '2026-10-02T00:45:54.000Z',
      latencyMs: 284
    },
    isLoading: false,
    isError: false
  })
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('adminNavigation', () => {
  it('keeps every admin screen reachable from one group', () => {
    const targets = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    expect(targets).toHaveLength(29);
    expect(new Set(targets).size).toBe(29);
  });

  it('picks the longest matching item for the current path', () => {
    expect(findActiveAdminNav('/admin/tools/machines-uninspected')?.item.label).toBe('未点検（加工機）');
    expect(findActiveAdminNav('/admin/tools/machines')?.item.label).toBe('加工機');
    expect(findActiveAdminNav('/admin/backup/history')?.item.label).toBe('バックアップ');
    expect(findActiveAdminNav('/admin')).toBeNull();
  });

  it('filters by screen name or group name', () => {
    expect(filterAdminNavGroups('csv').flatMap((g) => g.items.map((i) => i.label))).toEqual(['CSV取り込み']);
    expect(filterAdminNavGroups('点検').map((g) => g.label)).toEqual(['点検']);
    expect(filterAdminNavGroups('zzz')).toEqual([]);
  });
});

describe('AdminLayout header', () => {
  it('shows the current screen and opens all screens from a group tab', () => {
    renderAt('/admin/tools/inspection-records');

    expect(screen.queryByRole('link', { name: 'セキュリティ' })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation', { name: '管理ナビゲーション' })).getByRole('button', { name: /^点検/ }));

    expect(screen.getByRole('link', { name: 'セキュリティ' }).getAttribute('href')).toBe('/admin/security');
    expect(screen.getByRole('link', { name: '点検記録' }).getAttribute('aria-current')).toBe('page');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'セキュリティ' })).toBeNull();
  });

  it('gives each tab exactly one text colour, so the current tab stays readable on white', () => {
    renderAt('/admin/import');
    const nav = within(screen.getByRole('navigation', { name: '管理ナビゲーション' }));
    const textColours = (element: HTMLElement) => element.className.split(/\s+/).filter((name) => /^text-(white|slate)/.test(name));

    expect(textColours(nav.getByRole('button', { name: /^システム/ }))).toEqual(['text-slate-950']);
    expect(textColours(nav.getByRole('button', { name: /^点検/ }))).toEqual(['text-white/70']);
    expect(textColours(nav.getByRole('link', { name: 'ダッシュボード' }))).toEqual(['text-white/70']);

    fireEvent.click(nav.getByRole('button', { name: /^点検/ }));
    expect(textColours(nav.getByRole('button', { name: /^点検/ }))).toEqual(['text-white']);
    expect(textColours(nav.getByRole('button', { name: /^システム/ }))).toEqual(['text-slate-950']);
  });

  it('opens search with "/" and narrows the list', () => {
    renderAt('/admin');

    fireEvent.keyDown(document, { key: '/' });
    fireEvent.change(screen.getByLabelText('画面名で絞り込み'), { target: { value: 'バック' } });

    expect(screen.getByRole('link', { name: 'バックアップ' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'セキュリティ' })).toBeNull();
  });

  it('keeps network detail and logout one press away', () => {
    renderAt('/admin');

    fireEvent.click(screen.getByRole('button', { name: /ネットワーク状態: メンテナンスモード（設定値と不一致）/ }));
    expect(screen.getByText('設定値と実際の状態が違います')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'アカウント admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
