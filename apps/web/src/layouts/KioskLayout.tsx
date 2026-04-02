import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { getResolvedClientKey, setClientKeyHeader } from '../api/client';
import { useDeployStatus, useKioskCallTargets, useKioskConfig } from '../api/hooks';
import { KioskHeader } from '../components/kiosk/KioskHeader';
import { KioskMaintenanceScreen } from '../components/kiosk/KioskMaintenanceScreen';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';
import { usesKioskImmersiveLayout } from '../features/kiosk/kioskImmersiveLayoutPolicy';
import { KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS } from '../hooks/kioskRevealUi';
import { useKioskTopEdgeHeaderReveal } from '../hooks/useKioskTopEdgeHeaderReveal';

export function KioskLayout() {
  const clientKey = getResolvedClientKey();
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? '';
  const { data: kioskConfig } = useKioskConfig();
  const { data: deployStatus } = useDeployStatus();
  const location = useLocation();
  const [showSupportModal, setShowSupportModal] = useState(false);
  const immersiveKioskLayout = usesKioskImmersiveLayout(location.pathname);
  const headerReveal = useKioskTopEdgeHeaderReveal(immersiveKioskLayout);

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
  if (deployStatus?.isMaintenance) {
    return <KioskMaintenanceScreen />;
  }

  return (
    <div
      className={clsx(
        'bg-slate-800 text-white',
        immersiveKioskLayout ? 'flex h-screen min-h-0 flex-col' : 'min-h-screen'
      )}
    >
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      {immersiveKioskLayout ? (
        <div
          className="pointer-events-auto fixed top-0 left-0 right-0 z-[60] h-3"
          onMouseEnter={headerReveal.onHotZoneEnter}
          aria-hidden
        />
      ) : null}
      <header
        className={clsx(
          'border-b border-white/10 bg-slate-900/80 px-4 py-3 backdrop-blur',
          immersiveKioskLayout &&
            clsx('fixed top-0 right-0 left-0 z-50 shadow-lg', KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS),
          immersiveKioskLayout && !headerReveal.isVisible && '-translate-y-full',
          immersiveKioskLayout && headerReveal.isVisible && 'translate-y-0'
        )}
        onMouseEnter={immersiveKioskLayout ? headerReveal.onHeaderMouseEnter : undefined}
        onMouseLeave={immersiveKioskLayout ? headerReveal.onHeaderMouseLeave : undefined}
      >
        <KioskHeader
          clientKey={clientKey}
          clientId={selfClientId}
          onOpenSupport={() => setShowSupportModal(true)}
          clientStatus={kioskConfig?.clientStatus ?? null}
          pathname={location.pathname}
        />
      </header>
      <main
        className={clsx(
          'flex flex-col gap-4 px-4 py-4',
          immersiveKioskLayout ? 'min-h-0 flex-1' : 'h-[calc(100vh-6rem)]'
        )}
      >
        <h1 className="sr-only">キオスク</h1>
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
