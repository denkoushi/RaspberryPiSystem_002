import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { DEFAULT_CLIENT_KEY, setClientKeyHeader } from '../api/client';
import { useKioskConfig } from '../api/hooks';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';
import { Input } from '../components/ui/Input';
import { useLocalStorage } from '../hooks/useLocalStorage';

const navLink = 'rounded-md px-4 py-2 text-white hover:bg-white/10 transition-colors';

export function KioskLayout() {
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const { data: kioskConfig } = useKioskConfig();
  const location = useLocation();
  const [showSupportModal, setShowSupportModal] = useState(false);

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/layouts/KioskLayout.tsx:useEffect',message:'kiosk clientKey normalized to default',data:{hadClientKey:Boolean(clientKey),clientKeyLen:clientKey?.length??0,usedDefault:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run-kiosk-layout',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      setClientKeyHeader(clientKey);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/layouts/KioskLayout.tsx:useEffect',message:'kiosk clientKey applied (non-default)',data:{hadClientKey:Boolean(clientKey),clientKeyLen:clientKey?.length??0,usedDefault:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run-kiosk-layout',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  }, [clientKey, setClientKey]);

  // 直近のキオスクパスを記録し、/kiosk リロード時に復元できるようにする
  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '');
    if (path.startsWith('/kiosk') && path !== '/kiosk') {
      sessionStorage.setItem('kiosk-last-path', path);
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-800 text-white">
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      <header className="border-b border-white/10 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3">
          {/* 上段: タイトルとステーション設定 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
            </div>
            {/* ステーション設定（小さく） */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/70">キオスク端末</span>
              <label className="flex items-center gap-1 text-white/70">
                APIキー:
                <Input
                  value={clientKey}
                  onChange={(e) => setClientKey(e.target.value)}
                  placeholder="client-demo-key"
                  className="h-6 w-32 px-2 text-xs"
                />
              </label>
              <label className="flex items-center gap-1 text-white/70">
                ID:
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="UUID"
                  className="h-6 w-24 px-2 text-xs"
                />
              </label>
            </div>
          </div>
          {/* 下段: CPU情報とナビゲーション */}
          <div className="flex items-center justify-between gap-4">
            {/* CPU温度・負荷モニター（自端末のClientStatusから取得） */}
            {kioskConfig?.clientStatus && (
              <div className="flex items-center gap-3 text-xs shrink-0">
                {kioskConfig.clientStatus.temperature !== null && (
                  <div className="flex items-center gap-1">
                    <span className="text-white/70">CPU温度:</span>
                    <span
                      className={`font-semibold ${
                        kioskConfig.clientStatus.temperature >= 70
                          ? 'text-red-400'
                          : kioskConfig.clientStatus.temperature >= 60
                          ? 'text-yellow-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {kioskConfig.clientStatus.temperature.toFixed(1)}°C
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-white/70">CPU負荷:</span>
                  <span
                    className={`font-semibold ${
                      kioskConfig.clientStatus.cpuUsage >= 80
                        ? 'text-red-400'
                        : kioskConfig.clientStatus.cpuUsage >= 60
                        ? 'text-yellow-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {kioskConfig.clientStatus.cpuUsage.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            {/* ナビゲーション（折り返し可能、横スクロールなし） */}
            <nav className="flex items-center gap-2 flex-wrap justify-end min-w-0 flex-1">
              <NavLink
                to="/kiosk"
                className={() => {
                  // 持出タブ: /kiosk, /kiosk/tag, /kiosk/photo でアクティブ
                  const isBorrowActive =
                    location.pathname === '/kiosk' ||
                    location.pathname === '/kiosk/tag' ||
                    location.pathname === '/kiosk/photo';
                  return isBorrowActive ? `${navLink} bg-emerald-500` : navLink;
                }}
              >
                持出
              </NavLink>
              <NavLink
                to="/kiosk/instruments/borrow"
                className={({ isActive }) => (isActive ? `${navLink} bg-emerald-500` : navLink)}
              >
                計測機器 持出
              </NavLink>
              <NavLink
                to="/kiosk/rigging/borrow"
                className={({ isActive }) => (isActive ? `${navLink} bg-amber-400 text-slate-900` : navLink)}
              >
                吊具 持出
              </NavLink>
              <NavLink
                to="/kiosk/call"
                className={({ isActive }) => (isActive ? `${navLink} bg-purple-600` : navLink)}
              >
                📞 通話
              </NavLink>
              <Link
                to="/login"
                state={{ from: { pathname: '/admin' }, forceLogin: true }}
                className={`${navLink} bg-blue-600 hover:bg-blue-700`}
              >
                管理コンソール
              </Link>
              <button
                onClick={() => setShowSupportModal(true)}
                className={`${navLink} bg-blue-600 hover:bg-blue-700`}
                aria-label="お問い合わせ"
              >
                お問い合わせ
              </button>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex h-[calc(100vh-7rem)] flex-col gap-4 px-4 py-4">
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
