import { KIOSK_INITIAL_ROUTE_PATHS } from '@raspi-system/shared-types';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { postKioskPower } from '../../api/client';
import { kioskHeaderNavClass } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderNavClass';
import { renderKioskReorderableHeaderTab } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer';
import { useKioskDueManagementNavigation } from '../../features/kiosk/kioskHeaderTabs/useKioskDueManagementNavigation';
import { KioskPortalIcon } from '../../features/kiosk/portal/KioskPortalIcon';
import { resolveClientKeyForPower } from '../../lib/client-key';

import { KioskClientStatusChip } from './KioskClientStatusChip';
import { KioskInitialRouteButton } from './KioskInitialRouteButton';
import { KioskPowerConfirmModal } from './KioskPowerConfirmModal';
import { KioskPowerMenuModal } from './KioskPowerMenuModal';
import { KioskSignagePreviewModal } from './KioskSignagePreviewModal';
import { PowerDebounceOverlay } from './PowerDebounceOverlay';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

type ClientStatus = {
  temperature: number | null;
  cpuUsage: number;
};

type PowerAction = 'reboot' | 'poweroff';

type KioskHeaderProps = {
  clientKey: string;
  clientId: string;
  defaultMode?: 'PHOTO' | 'TAG';
  initialKioskRoute?: string | null;
  clientStatus?: ClientStatus | null;
  pathname: string;
  navTabOrder: readonly KioskReorderableHeaderTabId[];
  portalControls?: ReactNode;
};

const utilityClass = 'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-inv-line2 px-3 text-[15px] font-semibold text-inv-text hover:bg-inv-s2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan';

const PowerIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3v6" />
    <path d="M5.636 5.636a6.5 6.5 0 109.192 0" />
  </svg>
);

export function KioskHeader({
  clientKey,
  clientId,
  defaultMode,
  initialKioskRoute,
  clientStatus,
  pathname,
  navTabOrder,
  portalControls
}: KioskHeaderProps) {
  const { navigateToDueManagement: handleDueManagementNavigate, isPending: dueManagementPending } = useKioskDueManagementNavigation();
  const isPortal = pathname.replace(/\/$/, '') === KIOSK_INITIAL_ROUTE_PATHS.portal;
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [powerOverlayAction, setPowerOverlayAction] = useState<PowerAction | null>(null);
  const [isPowerProcessing, setIsPowerProcessing] = useState(false);
  const [showPowerMenu, setShowPowerMenu] = useState(false);
  const [showSignagePreview, setShowSignagePreview] = useState(false);

  const handlePowerSelect = (action: PowerAction) => {
    setShowPowerMenu(false);
    setPendingAction(action);
  };

  const handlePowerConfirm = async () => {
    if (!pendingAction) return;
    const actionToExecute = pendingAction;
    setPowerOverlayAction(actionToExecute);
    setPendingAction(null);
    setIsPowerProcessing(true);
    const effectiveClientKey = resolveClientKeyForPower(clientKey);
    if (!effectiveClientKey) {
      setPowerOverlayAction(null);
      window.alert('端末を特定できません。URLに clientKey が含まれているか確認してください。');
      setIsPowerProcessing(false);
      return;
    }
    try {
      await postKioskPower({ action: actionToExecute }, effectiveClientKey);
    } catch (error) {
      setPowerOverlayAction(null);
      console.error('Failed to request power action:', error);
      window.alert('電源操作のリクエストに失敗しました。ネットワーク接続を確認して再度お試しください。');
    } finally {
      setIsPowerProcessing(false);
    }
  };

  const reorderableTabContext = useMemo(
    () => ({
      pathname,
      defaultMode,
      initialKioskRoute,
      onDueManagementNavigate: handleDueManagementNavigate,
      dueManagementPending
    }),
    [defaultMode, initialKioskRoute, handleDueManagementNavigate, pathname, dueManagementPending]
  );

  return (
    <div
      className="flex items-stretch gap-5"
      data-kiosk-dock-overlay={showPowerMenu || showSignagePreview || pendingAction !== null || powerOverlayAction !== null}
    >
      {isPortal ? (
        <div className="mr-auto flex items-center gap-4">
          <h1 className="text-xl font-bold text-inv-text"><Link to={KIOSK_INITIAL_ROUTE_PATHS.portal} aria-current="page" className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan"><KioskPortalIcon className="h-6 w-6 text-inv-cyan" />ポータル</Link></h1>
          {portalControls}
        </div>
      ) : <nav aria-label="画面の切替" className="mr-auto flex min-w-0 max-w-[1340px] flex-1 flex-wrap content-start gap-1.5">
        <Link to={KIOSK_INITIAL_ROUTE_PATHS.portal} className={kioskHeaderNavClass(isPortal)} aria-current={isPortal ? 'page' : undefined}>
          <KioskPortalIcon className="mr-1.5 h-5 w-5" />ポータル
        </Link>
        {navTabOrder.map((tabId) => (
          <span key={tabId} className="shrink-0">
            {renderKioskReorderableHeaderTab(tabId, reorderableTabContext)}
          </span>
        ))}
      </nav>}
      <div className={`flex shrink-0 gap-1.5 border-l border-inv-line pl-5 ${isPortal ? 'items-center' : 'flex-col'}`}>
        <div className="flex h-11 items-center gap-1.5">
          <KioskInitialRouteButton clientKey={clientKey} pathname={pathname} initialKioskRoute={initialKioskRoute} defaultMode={defaultMode} />
          <button
            type="button"
            onClick={() => setShowSignagePreview(true)}
            className={utilityClass}
          >
            サイネージ
          </button>
        </div>
        <div className="flex h-11 items-center gap-1.5">
          <KioskClientStatusChip clientKey={clientKey} clientId={clientId} clientStatus={clientStatus} popoverSide={isPortal ? 'bottom' : 'top'} />
          <Link
            to="/login"
            state={{ from: { pathname: '/admin' }, forceLogin: true }}
            className={utilityClass}
            aria-label="管理コンソール"
            title="管理コンソール"
          >
            管理
          </Link>
          <button
            type="button"
            onClick={() => setShowPowerMenu(true)}
            className={`${utilityClass} w-11 !px-0 hover:border-inv-red hover:text-inv-red`}
            aria-label="電源メニュー"
            title="電源メニュー"
          >
            <PowerIcon />
          </button>
        </div>
      </div>
      <KioskPowerMenuModal
        isOpen={showPowerMenu}
        onClose={() => setShowPowerMenu(false)}
        onSelect={handlePowerSelect}
      />
      <KioskSignagePreviewModal
        isOpen={showSignagePreview}
        onClose={() => setShowSignagePreview(false)}
        kioskClientKey={clientKey}
      />
      <KioskPowerConfirmModal
        isOpen={pendingAction !== null}
        action={pendingAction ?? 'reboot'}
        isProcessing={isPowerProcessing}
        onCancel={() => setPendingAction(null)}
        onConfirm={handlePowerConfirm}
      />
      <PowerDebounceOverlay action={powerOverlayAction} />
    </div>
  );
}
