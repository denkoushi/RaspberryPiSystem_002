import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { NetworkModeBadge } from '../components/NetworkModeBadge';
import { Button } from '../components/ui/Button';
import { VIEWPORT_MIN_HEIGHT_FULL } from '../constants/viewportLayout';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';

const linkClass =
  'flex h-9 items-center rounded-md px-3 text-sm font-semibold text-white/75 hover:bg-white/10 transition-colors [&.active]:bg-white [&.active]:text-slate-950';
const lightLinkClass =
  'flex h-9 items-center rounded-md px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-950 transition-colors [&.active]:bg-slate-100 [&.active]:text-slate-950';

export function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isDgxResourceRoute =
    location.pathname === '/admin/dgx-resource' ||
    location.pathname.startsWith('/admin/dgx-resource/') ||
    location.pathname === '/admin/tools/dgx-resource' ||
    location.pathname.startsWith('/admin/tools/dgx-resource/');
  const navLinkClass = isDgxResourceRoute ? lightLinkClass : linkClass;

  return (
    <ConfirmProvider>
      <div
        className={
          isDgxResourceRoute
            ? `${VIEWPORT_MIN_HEIGHT_FULL} bg-[#f6f7f9] text-slate-950`
            : `${VIEWPORT_MIN_HEIGHT_FULL} bg-slate-800 text-white`
        }
      >
        <header
          className={
            isDgxResourceRoute
              ? 'border-b border-slate-300 bg-white px-3 py-2'
              : 'border-b border-white/10 bg-slate-900/90 px-3 py-2 backdrop-blur'
          }
        >
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <Link
              to="/admin"
              className={isDgxResourceRoute ? 'shrink-0 text-sm font-bold text-slate-950' : 'shrink-0 text-sm font-bold text-white'}
            >
              Factory Borrow System
            </Link>
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap" aria-label="管理ナビゲーション">
            <NavLink to="/admin" end className={navLinkClass}>
              ダッシュボード
            </NavLink>
            <NavLink to="/admin/tools/dgx-resource" className={navLinkClass}>
              DGXリソース
            </NavLink>
            <NavLink to="/admin/tools/employees" className={navLinkClass}>
              従業員
            </NavLink>
            <NavLink to="/admin/tools/items" className={navLinkClass}>
              アイテム
            </NavLink>
            <NavLink to="/admin/tools/unified" className={navLinkClass}>
              統合一覧
            </NavLink>
            <NavLink to="/admin/tools/measuring-instruments" className={navLinkClass}>
              計測機器
            </NavLink>
            <NavLink to="/admin/tools/measuring-instrument-genres" className={navLinkClass}>
              計測機器ジャンル
            </NavLink>
            <NavLink to="/admin/tools/part-measurement-templates" className={navLinkClass}>
              部品測定テンプレ
            </NavLink>
            <NavLink to="/admin/part-measurement/self-inspection-reviews" className={navLinkClass}>
              自主検査レビュー
            </NavLink>
            <NavLink to="/admin/tools/inspection-items" className={navLinkClass}>
              点検項目
            </NavLink>
            <NavLink to="/admin/tools/instrument-tags" className={navLinkClass}>
              RFIDタグ
            </NavLink>
            <NavLink to="/admin/tools/inspection-records" className={navLinkClass}>
              点検記録
            </NavLink>
            <NavLink to="/admin/tools/machines" className={navLinkClass}>
              加工機
            </NavLink>
            <NavLink to="/admin/tools/machines-uninspected" className={navLinkClass}>
              未点検（加工機）
            </NavLink>
            <NavLink to="/admin/tools/rigging-gears" className={navLinkClass}>
              吊具
            </NavLink>
            <NavLink to="/admin/tools/history" className={navLinkClass}>
              履歴
            </NavLink>
            <NavLink to="/admin/clients" className={navLinkClass}>
              クライアント端末
            </NavLink>
            <NavLink to="/admin/kiosk-settings" className={navLinkClass}>
              キオスク表示設定
            </NavLink>
            <NavLink to="/admin/kiosk-documents" className={navLinkClass}>
              要領書（キオスク）
            </NavLink>
            <NavLink to="/admin/import" className={navLinkClass}>
              CSV取り込み
            </NavLink>
            <NavLink to="/admin/csv-dashboards" className={navLinkClass}>
              CSVダッシュボード
            </NavLink>
            <NavLink to="/admin/production-schedule-settings" className={navLinkClass}>
              生産スケジュール設定
            </NavLink>
            <NavLink to="/admin/visualization-dashboards" className={navLinkClass}>
              可視化ダッシュボード
            </NavLink>
            <NavLink to="/admin/pallet-machine-illustrations" className={navLinkClass}>
              パレット加工機イラスト
            </NavLink>
            <NavLink to="/admin/gmail/config" className={navLinkClass}>
              Gmail設定
            </NavLink>
            <NavLink to="/admin/reports/loan-report" className={navLinkClass}>
              貸出レポート
            </NavLink>
            <NavLink to="/admin/local-llm" className={navLinkClass}>
              LocalLLM
            </NavLink>
            <NavLink to="/admin/photo-loan-label-reviews" className={navLinkClass}>
              写真持出VLM
            </NavLink>
            <NavLink to="/admin/photo-gallery-seed" className={navLinkClass}>
              ギャラリー教師登録
            </NavLink>
            <NavLink to="/admin/backup/targets" className={navLinkClass}>
              バックアップ
            </NavLink>
            <NavLink to="/admin/signage/schedules" className={navLinkClass}>
              サイネージ
            </NavLink>
            <NavLink to="/admin/signage/preview" className={navLinkClass}>
              サイネージプレビュー
            </NavLink>
            <NavLink to="/admin/security" className={navLinkClass}>
              セキュリティ
            </NavLink>
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden xl:block">
                <NetworkModeBadge />
              </div>
              <Link
                to="/kiosk"
                className="hidden h-9 items-center rounded-md bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 sm:flex"
              >
                キオスクへ
              </Link>
              <p className={`hidden max-w-32 truncate text-sm lg:block ${isDgxResourceRoute ? 'text-slate-500' : 'text-white/65'}`}>
                {user?.username}
              </p>
              <Button variant="ghost" onClick={logout}>
                ログアウト
              </Button>
            </div>
          </div>
        </header>
        <main
          className={
            isDgxResourceRoute
              ? 'mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:px-6'
              : 'mx-auto flex max-w-screen-2xl flex-col gap-4 px-4 py-4 sm:px-6'
          }
        >
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  );
}
