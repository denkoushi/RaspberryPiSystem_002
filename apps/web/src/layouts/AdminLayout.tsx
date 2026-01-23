import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { NetworkModeBadge } from '../components/NetworkModeBadge';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';

const linkClass =
  'rounded-md px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors [&.active]:bg-emerald-500 [&.active]:text-white';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'apps/web/src/layouts/AdminLayout.tsx:AdminLayout',
      message: 'AdminLayout rendered',
      data: { pathname: location.pathname, username: user?.username ?? null },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'apps/web/src/layouts/AdminLayout.tsx:AdminLayout',
      message: 'Admin nav items (hardcoded)',
      data: {
        navItems: [
          { to: '/admin', label: 'ダッシュボード' },
          { to: '/admin/tools/employees', label: '従業員' },
          { to: '/admin/tools/items', label: 'アイテム' },
          { to: '/admin/tools/unified', label: '統合一覧' },
          { to: '/admin/tools/measuring-instruments', label: '計測機器' },
          { to: '/admin/tools/inspection-items', label: '点検項目' },
          { to: '/admin/tools/instrument-tags', label: 'RFIDタグ' },
          { to: '/admin/tools/inspection-records', label: '点検記録' },
          { to: '/admin/tools/rigging-gears', label: '吊具' },
          { to: '/admin/tools/history', label: '履歴' },
          { to: '/admin/clients', label: 'クライアント端末' },
          { to: '/admin/import', label: '一括登録' },
          { to: '/admin/imports/schedule', label: 'CSVインポート' },
          { to: '/admin/gmail/config', label: 'Gmail設定' },
          { to: '/admin/backup/targets', label: 'バックアップ' },
          { to: '/admin/signage/schedules', label: 'サイネージ' },
          { to: '/admin/signage/preview', label: 'サイネージプレビュー' },
          { to: '/admin/security', label: 'セキュリティ' },
        ],
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return (
    <div className="min-h-screen bg-slate-800 text-white">
      <header className="border-b border-white/10 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
            <h1 className="text-xl font-semibold">管理コンソール</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/kiosk"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              キオスクへ
            </Link>
            <p className="text-sm text-white/70">{user?.username}</p>
            <Button variant="ghost" onClick={logout}>
              ログアウト
            </Button>
          </div>
        </div>
        <div className="mx-auto mt-4 flex max-w-screen-2xl flex-col gap-3 px-4">
          <nav className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
          <NavLink to="/admin" end className={linkClass}>
            ダッシュボード
          </NavLink>
          <NavLink to="/admin/tools/employees" className={linkClass}>
            従業員
          </NavLink>
          <NavLink to="/admin/tools/items" className={linkClass}>
            アイテム
          </NavLink>
          <NavLink to="/admin/tools/unified" className={linkClass}>
            統合一覧
          </NavLink>
          <NavLink to="/admin/tools/measuring-instruments" className={linkClass}>
            計測機器
          </NavLink>
          <NavLink to="/admin/tools/inspection-items" className={linkClass}>
            点検項目
          </NavLink>
          <NavLink to="/admin/tools/instrument-tags" className={linkClass}>
            RFIDタグ
          </NavLink>
          <NavLink to="/admin/tools/inspection-records" className={linkClass}>
            点検記録
          </NavLink>
          <NavLink to="/admin/tools/rigging-gears" className={linkClass}>
            吊具
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
          <NavLink to="/admin/imports/schedule" className={linkClass}>
            CSVインポート
          </NavLink>
          <NavLink to="/admin/csv-dashboards" className={linkClass}>
            CSVダッシュボード
          </NavLink>
          <NavLink to="/admin/gmail/config" className={linkClass}>
            Gmail設定
          </NavLink>
          <NavLink to="/admin/backup/targets" className={linkClass}>
            バックアップ
          </NavLink>
          <NavLink to="/admin/signage/schedules" className={linkClass}>
            サイネージ
          </NavLink>
          <NavLink to="/admin/signage/preview" className={linkClass}>
            サイネージプレビュー
          </NavLink>
          <NavLink to="/admin/security" className={linkClass}>
            セキュリティ
          </NavLink>
          </nav>
          <NetworkModeBadge />
        </div>
      </header>
      <main className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
