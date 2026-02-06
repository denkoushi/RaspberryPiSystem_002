import clsx from 'clsx';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { postKioskPower } from '../../api/client';
import { Row } from '../layout/Row';

import { KioskPowerConfirmModal } from './KioskPowerConfirmModal';

type ClientStatus = {
  temperature: number | null;
  cpuUsage: number;
};

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

export function KioskHeader({
  clientKey,
  clientId,
  onOpenSupport,
  clientStatus,
  pathname
}: KioskHeaderProps) {
  const [pendingAction, setPendingAction] = useState<'reboot' | 'poweroff' | null>(null);
  const [isPowerProcessing, setIsPowerProcessing] = useState(false);
  const isBorrowActive = pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo';
  const formatKey = (value: string) => {
    if (!value) return '未設定';
    if (value.length <= 8) return value;
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  };

  const handlePowerConfirm = async () => {
    if (!pendingAction) return;
    setIsPowerProcessing(true);
    try {
      await postKioskPower({ action: pendingAction });
    } catch (error) {
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
          onClick={() => setPendingAction('reboot')}
          className="rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-600"
        >
          再起動
        </button>
        <button
          type="button"
          onClick={() => setPendingAction('poweroff')}
          className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
        >
          シャットダウン
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
            ID: <span className="font-mono text-white/90">{formatKey(clientId)}</span>
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
          <Link to="/login" state={{ from: { pathname: '/admin' }, forceLogin: true }} className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 text-sm font-semibold transition-colors">
            管理コンソール
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
      <KioskPowerConfirmModal
        isOpen={pendingAction !== null}
        action={pendingAction ?? 'reboot'}
        isProcessing={isPowerProcessing}
        onCancel={() => setPendingAction(null)}
        onConfirm={handlePowerConfirm}
      />
    </div>
  );
}
