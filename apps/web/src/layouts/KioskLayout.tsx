import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { getResolvedClientKey, setClientKeyHeader } from '../api/client';
import { useDeployStatus, useKioskCallTargets, useKioskConfig } from '../api/hooks';
import { KioskHeader } from '../components/kiosk/KioskHeader';
import { KioskMaintenanceScreen } from '../components/kiosk/KioskMaintenanceScreen';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';

export function KioskLayout() {
  const clientKey = getResolvedClientKey();
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? '';
  const { data: kioskConfig } = useKioskConfig();
  const { data: deployStatus } = useDeployStatus();
  const location = useLocation();
  const [showSupportModal, setShowSupportModal] = useState(false);

  // client-key が空になってもデフォルトを自動で復元する
  useEffect(() => {
    setClientKeyHeader(getResolvedClientKey());
  }, []);

  // 直近のキオスクパスを記録し、/kiosk リロード時に復元できるようにする
  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '');
    if (path.startsWith('/kiosk') && path !== '/kiosk') {
      sessionStorage.setItem('kiosk-last-path', path);
    }
  }, [location.pathname]);

  // メンテナンス中はメンテナンス画面を表示
  if (deployStatus?.kioskMaintenance) {
    return <KioskMaintenanceScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-800 text-white">
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      <header className="border-b border-white/10 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <KioskHeader
          clientKey={clientKey}
          clientId={selfClientId}
          onOpenSupport={() => setShowSupportModal(true)}
          clientStatus={kioskConfig?.clientStatus ?? null}
          pathname={location.pathname}
        />
      </header>
      <main className="flex h-[calc(100vh-6rem)] flex-col gap-4 px-4 py-4">
        <h1 className="sr-only">キオスク</h1>
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
