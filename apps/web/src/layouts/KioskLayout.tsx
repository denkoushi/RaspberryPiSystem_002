import { DEFAULT_KIOSK_HEADER_TAB_ORDER, normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { getResolvedClientKey, setClientKeyHeader } from '../api/client';
import { useDeployStatus, useKioskCallTargets, useKioskConfig } from '../api/hooks';
import { KioskHeader } from '../components/kiosk/KioskHeader';
import { KioskMaintenanceScreen } from '../components/kiosk/KioskMaintenanceScreen';
import { KioskSupportModal } from '../components/kiosk/KioskSupportModal';
import { KioskRedirect } from '../components/KioskRedirect';
import {
  VIEWPORT_HEIGHT_FULL,
  VIEWPORT_MIN_HEIGHT_FULL
} from '../constants/viewportLayout';
import {
  KIOSK_IMMERSIVE_HEADER_BORDER_CLASS,
  KIOSK_IMMERSIVE_HEADER_FIXED_CLASS,
  KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS,
  KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS,
  KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS
} from '../features/kiosk/kioskImmersiveHeaderChrome';
import { usesKioskImmersiveLayout } from '../features/kiosk/kioskImmersiveLayoutPolicy';
import { useKioskBottomCenterHeaderReveal } from '../hooks/useKioskBottomCenterHeaderReveal';

export function KioskLayout() {
  const clientKey = getResolvedClientKey();
  const callTargetsQuery = useKioskCallTargets();
  const selfClientId = callTargetsQuery.data?.selfClientId ?? '';
  const { data: kioskConfig } = useKioskConfig();
  const { data: deployStatus } = useDeployStatus();
  const location = useLocation();
  const [showSupportModal, setShowSupportModal] = useState(false);
  const immersiveKioskLayout = usesKioskImmersiveLayout(location.pathname);
  const headerReveal = useKioskBottomCenterHeaderReveal(immersiveKioskLayout);
  const navTabOrder = normalizeKioskHeaderTabOrder(
    kioskConfig?.navTabOrder ?? DEFAULT_KIOSK_HEADER_TAB_ORDER
  );

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
        'flex flex-col bg-slate-800 text-white',
        immersiveKioskLayout ? [VIEWPORT_HEIGHT_FULL, 'min-h-0'] : VIEWPORT_MIN_HEIGHT_FULL
      )}
    >
      {/* 設定変更を監視してリダイレクト */}
      <KioskRedirect />
      {immersiveKioskLayout ? (
        <div
          className={KIOSK_IMMERSIVE_HEADER_HOT_ZONE_CLASS}
          onMouseEnter={headerReveal.onHotZoneEnter}
          aria-hidden
        />
      ) : null}
      <header
        className={clsx(
          'shrink-0 bg-slate-900/80 px-4 py-3 backdrop-blur',
          !immersiveKioskLayout && 'border-b border-white/10',
          immersiveKioskLayout && KIOSK_IMMERSIVE_HEADER_BORDER_CLASS,
          immersiveKioskLayout && KIOSK_IMMERSIVE_HEADER_FIXED_CLASS,
          immersiveKioskLayout &&
            !headerReveal.isVisible &&
            KIOSK_IMMERSIVE_HEADER_HIDDEN_TRANSFORM_CLASS,
          immersiveKioskLayout &&
            headerReveal.isVisible &&
            KIOSK_IMMERSIVE_HEADER_VISIBLE_TRANSFORM_CLASS
        )}
        onMouseEnter={immersiveKioskLayout ? headerReveal.onHeaderMouseEnter : undefined}
        onMouseLeave={immersiveKioskLayout ? headerReveal.onHeaderMouseLeave : undefined}
      >
        <KioskHeader
          clientKey={clientKey}
          clientId={selfClientId}
          onOpenSupport={() => setShowSupportModal(true)}
          defaultMode={kioskConfig?.defaultMode}
          clientStatus={kioskConfig?.clientStatus ?? null}
          pathname={location.pathname}
          navTabOrder={navTabOrder}
        />
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <h1 className="sr-only">キオスク</h1>
        <Outlet />
      </main>
      <KioskSupportModal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} />
    </div>
  );
}
