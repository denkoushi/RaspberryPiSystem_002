import { normalizeKioskInitialRoute } from '@raspi-system/shared-types';
import { Link } from 'react-router-dom';

import { KioskHomeIcon } from '../../../components/kiosk/KioskHomeIcon';

import { kioskHeaderNavClass } from './kioskHeaderNavClass';
import { isKioskHeaderTabActive, resolveCurrentKioskInitialRoute } from './kioskHeaderTabActivity';
import { KIOSK_HEADER_TAB_LABELS } from './kioskHeaderTabLabels';
import { resolveKioskHeaderTabPath } from './kioskHeaderTabRoutes';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

export type KioskHeaderReorderableTabContext = {
  pathname: string;
  defaultMode?: 'PHOTO' | 'TAG';
  initialKioskRoute?: string | null;
  onDueManagementNavigate: () => void;
  dueManagementPending: boolean;
};

export function resolveKioskBorrowHeaderTabPath(defaultMode: KioskHeaderReorderableTabContext['defaultMode']): string {
  return resolveKioskHeaderTabPath('borrow', defaultMode);
}

function renderLinkTab(params: {
  to: string;
  label: ReactNode;
  isActive: boolean;
}): ReactNode {
  const { to, label, isActive } = params;
  return (
    <Link
      to={to}
      className={kioskHeaderNavClass(isActive)}
      aria-current={isActive ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}

export function renderKioskReorderableHeaderTab(
  tabId: KioskReorderableHeaderTabId,
  ctx: KioskHeaderReorderableTabContext
): ReactNode {
  const isActive = isKioskHeaderTabActive(tabId, ctx.pathname);
  const initialRoute = normalizeKioskInitialRoute(ctx.initialKioskRoute)
    ?? (ctx.defaultMode === 'PHOTO' ? 'borrow_photo' : 'borrow_tag');
  // 持出は 1 つのタブがタグ/写真の 2 画面を兼ねる。開いている間は今の画面、それ以外はタブの行き先で判定する。
  const borrowRoute = isActive
    ? resolveCurrentKioskInitialRoute(ctx.pathname)
    : (ctx.defaultMode === 'PHOTO' ? 'borrow_photo' : 'borrow_tag');
  const isInitialTab = tabId === 'borrow' ? initialRoute === borrowRoute : initialRoute === tabId;
  const markLabel = (label: string) => isInitialTab ? (
    <><KioskHomeIcon filled className={`mr-1.5 h-4 w-4 shrink-0 ${isActive ? 'text-inv-cyan-ink' : 'text-inv-cyan'}`} /><span className="sr-only">開始ページ </span>{label}</>
  ) : label;

  if (tabId === 'due_management') {
    return (
      <button
        type="button"
        onClick={() => void ctx.onDueManagementNavigate()}
        disabled={ctx.dueManagementPending}
        aria-current={isActive ? 'page' : undefined}
        className={kioskHeaderNavClass(isActive)}
      >
        {KIOSK_HEADER_TAB_LABELS[tabId]}
      </button>
    );
  }
  return renderLinkTab({
    to: resolveKioskHeaderTabPath(tabId, ctx.defaultMode),
    label: markLabel(KIOSK_HEADER_TAB_LABELS[tabId]),
    isActive
  });
}
