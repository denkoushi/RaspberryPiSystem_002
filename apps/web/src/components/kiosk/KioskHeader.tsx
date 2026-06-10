import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { postKioskPower } from '../../api/client';
import { useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';
import { renderKioskReorderableHeaderTab } from '../../features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer';
import { resolveClientKeyForPower } from '../../lib/client-key';
import { Row } from '../layout/Row';

import { KioskPowerConfirmModal } from './KioskPowerConfirmModal';
import { KioskPowerMenuModal } from './KioskPowerMenuModal';
import { KioskSignagePreviewModal } from './KioskSignagePreviewModal';
import { PowerDebounceOverlay } from './PowerDebounceOverlay';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

type ClientStatus = {
  temperature: number | null;
  cpuUsage: number;
};

type PowerAction = 'reboot' | 'poweroff';

type KioskHeaderProps = {
  clientKey: string;
  clientId: string;
  onOpenSupport: () => void;
  clientStatus?: ClientStatus | null;
  pathname: string;
  navTabOrder: readonly KioskReorderableHeaderTabId[];
};

const DUE_MANAGEMENT_AUTH_SESSION_KEY = 'kiosk-due-management-authenticated';

const GearIcon = () => (
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
    <path d="M11.983 2.25c-.483 0-.96.037-1.43.109a1.5 1.5 0 00-1.17 1.022l-.258.816a1.5 1.5 0 01-1.094 1.002l-.847.193a1.5 1.5 0 00-1.13 1.13l-.193.847a1.5 1.5 0 01-1.002 1.094l-.816.258a1.5 1.5 0 00-1.022 1.17 10.5 10.5 0 000 2.86 1.5 1.5 0 001.022 1.17l.816.258a1.5 1.5 0 011.002 1.094l.193.847a1.5 1.5 0 001.13 1.13l.847.193a1.5 1.5 0 011.094 1.002l.258.816a1.5 1.5 0 001.17 1.022 10.5 10.5 0 002.86 0 1.5 1.5 0 001.17-1.022l.258-.816a1.5 1.5 0 011.094-1.002l.847-.193a1.5 1.5 0 001.13-1.13l.193-.847a1.5 1.5 0 011.002-1.094l.816-.258a1.5 1.5 0 001.022-1.17 10.5 10.5 0 000-2.86 1.5 1.5 0 00-1.022-1.17l-.816-.258a1.5 1.5 0 01-1.002-1.094l-.193-.847a1.5 1.5 0 00-1.13-1.13l-.847-.193a1.5 1.5 0 01-1.094-1.002l-.258-.816a1.5 1.5 0 00-1.17-1.022 10.5 10.5 0 00-1.43-.109z" />
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

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
  onOpenSupport,
  clientStatus,
  pathname,
  navTabOrder
}: KioskHeaderProps) {
  const navigate = useNavigate();
  const verifyDueManagementAccessPasswordMutation = useVerifyKioskDueManagementAccessPassword();
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [powerOverlayAction, setPowerOverlayAction] = useState<PowerAction | null>(null);
  const [isPowerProcessing, setIsPowerProcessing] = useState(false);
  const [showPowerMenu, setShowPowerMenu] = useState(false);
  const [showSignagePreview, setShowSignagePreview] = useState(false);

  const formatKey = (value: string) => {
    if (!value) return '未設定';
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  };

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

  const handleDueManagementNavigate = useCallback(async () => {
    if (pathname.startsWith('/kiosk/production-schedule/due-management')) {
      navigate('/kiosk/production-schedule/due-management');
      return;
    }
    const isAuthenticated =
      typeof window !== 'undefined' && window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY) === '1';
    if (isAuthenticated) {
      navigate('/kiosk/production-schedule/due-management');
      return;
    }
    const password = typeof window !== 'undefined' ? window.prompt('納期管理パスワードを入力してください') : null;
    if (!password) return;
    try {
      const result = await verifyDueManagementAccessPasswordMutation.mutateAsync({ password });
      if (!result.success) {
        window.alert('パスワードが違います');
        return;
      }
      window.sessionStorage.setItem(DUE_MANAGEMENT_AUTH_SESSION_KEY, '1');
      navigate('/kiosk/production-schedule/due-management');
    } catch {
      window.alert('認証に失敗しました。ネットワーク接続を確認してください。');
    }
  }, [navigate, pathname, verifyDueManagementAccessPasswordMutation]);

  const reorderableTabContext = useMemo(
    () => ({
      pathname,
      onDueManagementNavigate: handleDueManagementNavigate,
      dueManagementPending: verifyDueManagementAccessPasswordMutation.isPending
    }),
    [handleDueManagementNavigate, pathname, verifyDueManagementAccessPasswordMutation.isPending]
  );

  return (
    <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
      <Row className="gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setShowPowerMenu(true)}
          className="rounded-md bg-slate-700 p-2 text-white transition-colors hover:bg-slate-600"
          aria-label="電源メニュー"
          title="電源メニュー"
        >
          <PowerIcon />
        </button>
        {clientStatus ? (
          <Row className="gap-3 text-xs shrink-0">
            {clientStatus.temperature !== null ? (
              <Row className="gap-1">
                <span className="text-white/70">CPU温度:</span>
                <span
                  className={
                    clientStatus.temperature >= 70
                      ? 'font-semibold text-red-400'
                      : clientStatus.temperature >= 60
                        ? 'font-semibold text-yellow-400'
                        : 'font-semibold text-emerald-400'
                  }
                >
                  {clientStatus.temperature.toFixed(1)}°C
                </span>
              </Row>
            ) : null}
            <Row className="gap-1">
              <span className="text-white/70">CPU負荷:</span>
              <span
                className={
                  clientStatus.cpuUsage >= 80
                    ? 'font-semibold text-red-400'
                    : clientStatus.cpuUsage >= 60
                      ? 'font-semibold text-yellow-400'
                      : 'font-semibold text-emerald-400'
                }
              >
                {clientStatus.cpuUsage.toFixed(1)}%
              </span>
            </Row>
          </Row>
        ) : null}
      </Row>
      <Row className="gap-3 min-w-0 flex-1" justify="end">
        <Row className="gap-2 text-xs shrink-0">
          <span className="text-white/70">キオスク端末</span>
          <span className="text-white/70">
            APIキー: <span className="font-mono text-white/90">{formatKey(clientKey)}</span>
          </span>
          <span className="text-white/70">
            通話ID: <span className="font-mono text-white/90">{formatKey(clientId)}</span>
          </span>
        </Row>
        <nav className="flex items-center gap-1 min-w-0 flex-nowrap overflow-x-auto whitespace-nowrap">
          {navTabOrder.map((tabId) => (
            <span key={tabId} className="shrink-0">
              {renderKioskReorderableHeaderTab(tabId, reorderableTabContext)}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setShowSignagePreview(true)}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md px-3 py-2 text-sm font-semibold transition-colors"
          >
            サイネージ
          </button>
          <Link
            to="/login"
            state={{ from: { pathname: '/admin' }, forceLogin: true }}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-md p-2 text-sm font-semibold transition-colors"
            aria-label="管理コンソール"
            title="管理コンソール"
          >
            <GearIcon />
          </Link>
          <button
            onClick={onOpenSupport}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 text-sm font-semibold transition-colors"
            aria-label="お問い合わせ"
          >
            お問い合わせ
          </button>
        </nav>
      </Row>
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
