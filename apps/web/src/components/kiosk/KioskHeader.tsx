import clsx from 'clsx';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { getResolvedClientKey, postClientLogs, postKioskPower } from '../../api/client';
import { Row } from '../layout/Row';

import { KioskPowerConfirmModal } from './KioskPowerConfirmModal';
import { KioskPowerMenuModal } from './KioskPowerMenuModal';
import { KioskSignagePreviewModal } from './KioskSignagePreviewModal';

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
};

const navBase = 'rounded-md px-3 py-2 text-sm font-semibold transition-colors';
const navInactive = 'text-white hover:bg-white/10';

const navClass = (isActive: boolean, activeClassName: string) =>
  clsx(navBase, isActive ? activeClassName : navInactive);

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

const powerOverlayMessage: Record<PowerAction, string> = {
  reboot: '再起動を実行しています。しばらくお待ちください。',
  poweroff: 'シャットダウンを実行しています。まもなく画面が消えます。'
};

export function KioskHeader({
  clientKey,
  clientId,
  onOpenSupport,
  clientStatus,
  pathname
}: KioskHeaderProps) {
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [isPowerProcessing, setIsPowerProcessing] = useState(false);
  const [showPowerMenu, setShowPowerMenu] = useState(false);
  const [showSignagePreview, setShowSignagePreview] = useState(false);
  const [powerOverlayAction, setPowerOverlayAction] = useState<PowerAction | null>(null);
  const isBorrowActive = pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo';
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
    setIsPowerProcessing(true);
    const effectiveClientKey = (getResolvedClientKey() || clientKey || '').trim();
    // #region agent log
    const urlClientKey = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('clientKey') : null;
    const storedKey = typeof window !== 'undefined' ? window.localStorage.getItem('kiosk-client-key') : null;
    postClientLogs(
      {
        clientId: clientId || 'power-debug-unknown',
        logs: [
          {
            level: 'INFO',
            message: '[power-debug] power request start',
            context: {
              action: pendingAction,
              clientKeyProp: clientKey,
              clientKeySent: effectiveClientKey,
              urlClientKey,
              localStorageKioskKey: storedKey?.slice(0, 50) ?? null,
              pathname: typeof window !== 'undefined' ? window.location.pathname : null,
            },
          },
        ],
      },
      effectiveClientKey
    ).catch(() => {});
    // #endregion
    try {
      await postKioskPower({ action: pendingAction }, effectiveClientKey);
      // #region agent log
      postClientLogs(
        {
          clientId: clientId || 'power-debug-unknown',
          logs: [{ level: 'INFO', message: '[power-debug] power request accepted', context: { action: pendingAction } }],
        },
        effectiveClientKey
      ).catch(() => {});
      // #endregion
      setPowerOverlayAction(pendingAction);
    } catch (error) {
      // #region agent log
      postClientLogs(
        {
          clientId: clientId || 'power-debug-unknown',
          logs: [
            {
              level: 'ERROR',
              message: '[power-debug] power request failed',
              context: {
                action: pendingAction,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            },
          ],
        },
        effectiveClientKey
      ).catch(() => {});
      // #endregion
      console.error('Failed to request power action:', error);
    } finally {
      setIsPowerProcessing(false);
      setPendingAction(null);
    }
  };

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
                  className={clsx(
                    'font-semibold',
                    clientStatus.temperature >= 70
                      ? 'text-red-400'
                      : clientStatus.temperature >= 60
                      ? 'text-yellow-400'
                      : 'text-emerald-400'
                  )}
                >
                  {clientStatus.temperature.toFixed(1)}°C
                </span>
              </Row>
            ) : null}
            <Row className="gap-1">
              <span className="text-white/70">CPU負荷:</span>
              <span
                className={clsx(
                  'font-semibold',
                  clientStatus.cpuUsage >= 80
                    ? 'text-red-400'
                    : clientStatus.cpuUsage >= 60
                    ? 'text-yellow-400'
                    : 'text-emerald-400'
                )}
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
          <NavLink to="/kiosk" className={() => navClass(isBorrowActive, 'bg-emerald-500 text-white')}>
            持出
          </NavLink>
          <NavLink
            to="/kiosk/instruments/borrow"
            className={({ isActive }) => navClass(isActive, 'bg-emerald-500 text-white')}
          >
            計測機器 持出
          </NavLink>
          <NavLink
            to="/kiosk/rigging/borrow"
            className={({ isActive }) => navClass(isActive, 'bg-amber-400 text-slate-900')}
          >
            吊具 持出
          </NavLink>
          <NavLink
            to="/kiosk/production-schedule"
            className={({ isActive }) => navClass(isActive, 'bg-blue-500 text-white')}
          >
            生産スケジュール
          </NavLink>
          <NavLink to="/kiosk/call" className={({ isActive }) => navClass(isActive, 'bg-purple-600 text-white')}>
            📞 通話
          </NavLink>
          <button
            type="button"
            onClick={() => setShowSignagePreview(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-md px-3 py-2 text-sm font-semibold transition-colors"
          >
            サイネージ
          </button>
          <Link
            to="/login"
            state={{ from: { pathname: '/admin' }, forceLogin: true }}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-md p-2 text-sm font-semibold transition-colors"
            aria-label="管理コンソール"
            title="管理コンソール"
          >
            <GearIcon />
          </Link>
          <button
            onClick={onOpenSupport}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 text-sm font-semibold transition-colors"
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
      />
      <KioskPowerConfirmModal
        isOpen={pendingAction !== null}
        action={pendingAction ?? 'reboot'}
        isProcessing={isPowerProcessing}
        onCancel={() => setPendingAction(null)}
        onConfirm={handlePowerConfirm}
      />
      {powerOverlayAction && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black text-white"
          role="status"
          aria-live="polite"
          style={{ pointerEvents: 'auto' }}
        >
          <p className="text-xl font-medium">{powerOverlayMessage[powerOverlayAction]}</p>
        </div>
      )}
    </div>
  );
}
