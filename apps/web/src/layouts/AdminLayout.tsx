import { NavLink, Outlet } from 'react-router-dom';

import { NetworkModeBadge } from '../components/NetworkModeBadge';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';

const linkClass =
  'rounded-md px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors [&.active]:bg-emerald-500 [&.active]:text-white';

export function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
            <h1 className="text-xl font-semibold">管理コンソール</h1>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-white/70">{user?.username}</p>
            <Button variant="ghost" onClick={logout}>
              ログアウト
            </Button>
          </div>
        </div>
        <div className="mx-auto mt-4 flex max-w-6xl flex-col gap-3">
          <nav className="flex gap-2">
          <NavLink to="/admin" end className={linkClass}>
            ダッシュボード
          </NavLink>
          <NavLink to="/admin/tools/employees" className={linkClass}>
            従業員
          </NavLink>
          <NavLink to="/admin/tools/items" className={linkClass}>
            アイテム
          </NavLink>
          <NavLink to="/admin/tools/history" className={linkClass}>
            履歴
          </NavLink>
          <NavLink to="/admin/clients" className={linkClass}>
            クライアント端末
          </NavLink>
          <NavLink to="/admin/import" className={linkClass}>
            一括登録
          </NavLink>
          <NavLink to="/admin/signage/schedules" className={linkClass}>
            サイネージ
          </NavLink>
          </nav>
          <NetworkModeBadge />
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
