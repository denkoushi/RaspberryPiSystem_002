import { NavLink, Outlet } from 'react-router-dom';
import { KioskRedirect } from '../components/KioskRedirect';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { Input } from '../components/ui/Input';
import { DEFAULT_CLIENT_KEY, setClientKeyHeader } from '../api/client';
import { useSystemInfo } from '../api/hooks';
import { useEffect } from 'react';

const navLink = 'rounded-md px-4 py-2 text-white hover:bg-white/10 transition-colors';

export function KioskLayout() {
  const [clientKey, setClientKey] = useLocalStorage('kiosk-client-key', DEFAULT_CLIENT_KEY);
  const [clientId, setClientId] = useLocalStorage('kiosk-client-id', '');
  const { data: systemInfo } = useSystemInfo();

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    if (!clientKey || clientKey === 'client-demo-key') {
      setClientKey(DEFAULT_CLIENT_KEY);
      setClientKeyHeader(DEFAULT_CLIENT_KEY);
    } else {
      setClientKeyHeader(clientKey);
    }
  }, [clientKey, setClientKey]);

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
              <NavLink to="/kiosk" className={({ isActive }) => (isActive ? `${navLink} bg-emerald-500` : navLink)}>
                持出
              </NavLink>
              <NavLink to="/kiosk/return" className={({ isActive }) => (isActive ? `${navLink} bg-emerald-500` : navLink)}>
                返却
              </NavLink>
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
