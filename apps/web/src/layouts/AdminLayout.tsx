import { Link, NavLink, Outlet } from 'react-router-dom';

import { NetworkModeBadge } from '../components/NetworkModeBadge';
import { Button } from '../components/ui/Button';
import { VIEWPORT_MIN_HEIGHT_FULL } from '../constants/viewportLayout';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';

const linkClass =
  'flex h-9 items-center rounded-md px-3 text-sm font-semibold text-white/75 hover:bg-white/10 transition-colors [&.active]:bg-white [&.active]:text-slate-950';

export function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <ConfirmProvider>
      <div className={`${VIEWPORT_MIN_HEIGHT_FULL} bg-slate-800 text-white`}>
        <header className="border-b border-white/10 bg-slate-900/90 px-3 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <Link to="/admin" className="shrink-0 text-sm font-bold text-white">
              Factory Borrow System
            </Link>
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap" aria-label="管理ナビゲーション">
            <NavLink to="/admin" end className={linkClass}>
              ダッシュボード
            </NavLink>
            <NavLink to="/admin/tools/dgx-resource" className={linkClass}>
              DGXリソース
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
            <NavLink to="/admin/tools/measuring-instrument-genres" className={linkClass}>
              計測機器ジャンル
            </NavLink>
            <NavLink to="/admin/tools/part-measurement-templates" className={linkClass}>
              部品測定テンプレ
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
            <NavLink to="/admin/tools/machines" className={linkClass}>
              加工機
            </NavLink>
            <NavLink to="/admin/tools/machines-uninspected" className={linkClass}>
              未点検（加工機）
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
            <NavLink to="/admin/kiosk-settings" className={linkClass}>
              キオスク表示設定
            </NavLink>
            <NavLink to="/admin/kiosk-documents" className={linkClass}>
              要領書（キオスク）
            </NavLink>
            <NavLink to="/admin/import" className={linkClass}>
              CSV取り込み
            </NavLink>
            <NavLink to="/admin/csv-dashboards" className={linkClass}>
              CSVダッシュボード
            </NavLink>
            <NavLink to="/admin/production-schedule-settings" className={linkClass}>
              生産スケジュール設定
            </NavLink>
            <NavLink to="/admin/visualization-dashboards" className={linkClass}>
              可視化ダッシュボード
            </NavLink>
            <NavLink to="/admin/pallet-machine-illustrations" className={linkClass}>
              パレット加工機イラスト
            </NavLink>
            <NavLink to="/admin/gmail/config" className={linkClass}>
              Gmail設定
            </NavLink>
            <NavLink to="/admin/reports/loan-report" className={linkClass}>
              貸出レポート
            </NavLink>
            <NavLink to="/admin/local-llm" className={linkClass}>
              LocalLLM
            </NavLink>
            <NavLink to="/admin/photo-loan-label-reviews" className={linkClass}>
              写真持出VLM
            </NavLink>
            <NavLink to="/admin/photo-gallery-seed" className={linkClass}>
              ギャラリー教師登録
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
              <p className="hidden max-w-32 truncate text-sm text-white/65 lg:block">{user?.username}</p>
              <Button variant="ghost" onClick={logout}>
                ログアウト
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex max-w-screen-2xl flex-col gap-4 px-4 py-4 sm:px-6">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  );
}
