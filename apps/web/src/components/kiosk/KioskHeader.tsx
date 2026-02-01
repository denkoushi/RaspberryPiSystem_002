import clsx from 'clsx';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { isValidApiKey, isValidUuid } from '../../utils/validation';
import { Row } from '../layout/Row';
import { Input } from '../ui/Input';

import type { ChangeEvent } from 'react';

type ClientStatus = {
  temperature: number | null;
  cpuUsage: number;
};

type KioskHeaderProps = {
  clientKey: string;
  clientId: string;
  onClientKeyChange: (nextValue: string) => void;
  onClientIdChange: (nextValue: string) => void;
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
  onClientKeyChange,
  onClientIdChange,
  onOpenSupport,
  clientStatus,
  pathname
}: KioskHeaderProps) {
  const isBorrowActive = pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo';
  const [apiKeyError, setApiKeyError] = useState<string>('');
  const [clientIdError, setClientIdError] = useState<string>('');

  const handleClientKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    
    // リアルタイムバリデーション
    if (newValue && !isValidApiKey(newValue)) {
      setApiKeyError('APIキーの形式が正しくありません（英数字、ハイフン、アンダースコアのみ、8-100文字）');
      // エラーがある場合は保存しない（useLocalStorageApiKeyが自動修復する）
    } else {
      setApiKeyError('');
      // バリデーションが通った場合のみ保存
      onClientKeyChange(newValue);
    }
  };

  const handleClientIdChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    
    // リアルタイムバリデーション（空文字列も許可）
    if (newValue && !isValidUuid(newValue)) {
      setClientIdError('IDはUUID形式（xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx）である必要があります');
      // エラーがある場合は保存しない（useLocalStorageUuidが自動修復する）
    } else {
      setClientIdError('');
      // バリデーションが通った場合のみ保存
      onClientIdChange(newValue);
    }
  };

  return (
    <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
      <Row className="gap-4 shrink-0">
        <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
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
          <label className="flex flex-col gap-0.5 text-white/70">
            <div className="flex items-center gap-1">
              APIキー:
              <Input
                value={clientKey}
                onChange={handleClientKeyChange}
                placeholder="client-demo-key"
                className={clsx(
                  'h-6 w-32 px-2 text-xs',
                  apiKeyError && 'border-red-500 focus:border-red-500'
                )}
                title={apiKeyError || 'APIキー（英数字、ハイフン、アンダースコアのみ）'}
              />
            </div>
            {apiKeyError && (
              <span className="text-red-400 text-[10px] max-w-32 truncate" title={apiKeyError}>
                {apiKeyError}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-0.5 text-white/70">
            <div className="flex items-center gap-1">
              ID:
              <Input
                value={clientId}
                onChange={handleClientIdChange}
                placeholder="UUID"
                className={clsx(
                  'h-6 w-24 px-2 text-xs',
                  clientIdError && 'border-red-500 focus:border-red-500'
                )}
                title={clientIdError || 'UUID形式（オプショナル）'}
              />
            </div>
            {clientIdError && (
              <span className="text-red-400 text-[10px] max-w-24 truncate" title={clientIdError}>
                {clientIdError}
              </span>
            )}
          </label>
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
    </div>
  );
}
