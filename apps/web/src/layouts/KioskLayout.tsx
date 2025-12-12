import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { DEFAULT_CLIENT_KEY, setClientKeyHeader } from '../api/client';
import { useSystemInfo } from '../api/hooks';
import { KioskRedirect } from '../components/KioskRedirect';
import { Input } from '../components/ui/Input';
import { useLocalStorage } from '../hooks/useLocalStorage';

const navLink = 'rounded-md px-4 py-2 text-white hover:bg-white/10 transition-colors';

export function KioskLayout() {
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const { data: systemInfo } = useSystemInfo();
  const location = useLocation();

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
    } else {
      setClientKeyHeader(clientKey);
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
    <div className="min-h-screen bg-slate-900 text-white">
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      <header className="border-b border-white/10 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
              <h1 className="text-xl font-semibold">キオスク端末</h1>
            </div>
            {/* ステーション設定（小さく） */}
            <div className="flex items-center gap-2 text-xs">
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
          <div className="flex items-center gap-4">
            {/* CPU温度・負荷モニター */}
            {systemInfo && (
              <div className="flex items-center gap-3 text-xs">
                {systemInfo.cpuTemp !== null && (
                  <div className="flex items-center gap-1">
                    <span className="text-white/70">CPU温度:</span>
                    <span
                      className={`font-semibold ${
                        systemInfo.cpuTemp >= 70
                          ? 'text-red-400'
                          : systemInfo.cpuTemp >= 60
                          ? 'text-yellow-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {systemInfo.cpuTemp.toFixed(1)}°C
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-white/70">CPU負荷:</span>
                  <span
                    className={`font-semibold ${
                      systemInfo.cpuLoad >= 80
                        ? 'text-red-400'
                        : systemInfo.cpuLoad >= 60
                        ? 'text-yellow-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {systemInfo.cpuLoad.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            <nav className="space-x-2">
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
              <Link
                to="/admin"
                className={`${navLink} bg-blue-600 hover:bg-blue-700`}
              >
                管理コンソール
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex h-[calc(100vh-5rem)] flex-col gap-4 px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
