import { NavLink, Outlet } from 'react-router-dom';
import { KioskRedirect } from '../components/KioskRedirect';

const navLink = 'rounded-md px-4 py-2 text-white hover:bg-white/10 transition-colors';

export function KioskLayout() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      <header className="border-b border-white/10 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
            <h1 className="text-xl font-semibold">キオスク端末</h1>
          </div>
          <nav className="space-x-2">
            <NavLink to="/kiosk" className={({ isActive }) => (isActive ? `${navLink} bg-emerald-500` : navLink)}>
              持出
            </NavLink>
            <NavLink to="/kiosk/return" className={({ isActive }) => (isActive ? `${navLink} bg-emerald-500` : navLink)}>
              返却
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
