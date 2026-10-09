import { normalizeKioskInitialRoute, resolveKioskDefaultModePath } from '@raspi-system/shared-types';
import { Link } from 'react-router-dom';

import { KioskHomeIcon } from '../../../components/kiosk/KioskHomeIcon';
import { KIOSK_MACHINE_SIGNAL_PATH } from '../../machine-signal/machineSignalRoutes';
import { KIOSK_INSPECTION_DRAWING_LIBRARY_PATH } from '../../part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';

import { kioskHeaderNavClass } from './kioskHeaderNavClass';
import { isKioskHeaderTabActive, resolveCurrentKioskInitialRoute } from './kioskHeaderTabActivity';

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
  return resolveKioskDefaultModePath(defaultMode);
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

  switch (tabId) {
    case 'borrow':
      return renderLinkTab({
        to: resolveKioskBorrowHeaderTabPath(ctx.defaultMode),
        label: markLabel('持出'),
        isActive,
      });
    case 'inventory_settings':
      return renderLinkTab({
        to: '/kiosk/inventory',
        label: markLabel('在庫'),
        isActive,
      });
    case 'self_inspection':
      return renderLinkTab({
        to: '/kiosk/part-measurement/self-inspection',
        label: markLabel('自主検査'),
        isActive,
      });
    case 'instruments_borrow':
      return renderLinkTab({
        to: '/kiosk/instruments/borrow',
        label: markLabel('計測機器 持出'),
        isActive,
      });
    case 'rigging_borrow':
      return renderLinkTab({
        to: '/kiosk/rigging/borrow',
        label: markLabel('吊具 持出'),
        isActive,
      });
    case 'tag_desk':
      return renderLinkTab({
        to: '/kiosk/tag-desk',
        label: markLabel('タグ管理'),
        isActive,
      });
    case 'production_schedule':
      return renderLinkTab({
        to: '/kiosk/production-schedule',
        label: markLabel('生産スケジュール'),
        isActive,
      });
    case 'manual_order':
      return renderLinkTab({
        to: '/kiosk/production-schedule/manual-order',
        label: markLabel('手動順番'),
        isActive,
      });
    case 'leader_order_board':
      return renderLinkTab({
        to: '/kiosk/production-schedule/leader-order-board',
        label: markLabel('順位ボード'),
        isActive,
      });
    case 'grinding_planning_board':
      return renderLinkTab({
        to: '/kiosk/production-schedule/planning-board',
        label: markLabel('製番ボード'),
        isActive,
      });
    case 'progress_overview':
      return renderLinkTab({
        to: '/kiosk/production-schedule/progress-overview',
        label: markLabel('進捗一覧'),
        isActive,
      });
    case 'load_balancing':
      return renderLinkTab({
        to: '/kiosk/production-schedule/load-balancing',
        label: markLabel('負荷調整'),
        isActive,
      });
    case 'purchase_order_lookup':
      return renderLinkTab({
        to: '/kiosk/purchase-order-lookup',
        label: markLabel('購買照会'),
        isActive,
      });
    case 'pallet_visualization':
      return renderLinkTab({
        to: '/kiosk/pallet-visualization',
        label: markLabel('パレット'),
        isActive,
      });
    case 'shelf_master':
      return renderLinkTab({
        to: '/kiosk/mobile-placement/shelf-master',
        label: markLabel('棚マスタ'),
        isActive,
      });
    case 'documents':
      return renderLinkTab({
        to: '/kiosk/documents',
        label: markLabel('要領書'),
        isActive,
      });
    case 'assembly':
      return renderLinkTab({
        to: '/kiosk/assembly',
        label: markLabel('組立'),
        isActive,
      });
    case 'part_measurement':
      return renderLinkTab({
        to: '/kiosk/part-measurement',
        label: markLabel('部品測定'),
        isActive,
      });
    case 'inspection_drawing':
      return renderLinkTab({
        to: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
        label: markLabel('検査図面'),
        isActive,
      });
    case 'rigging_analytics': {
      return renderLinkTab({
        to: '/kiosk/rigging-analytics',
        label: markLabel('集計'),
        isActive,
      });
    }
    case 'machine_signal':
      return renderLinkTab({
        to: KIOSK_MACHINE_SIGNAL_PATH,
        label: markLabel('設備稼働'),
        isActive,
      });
    case 'due_management':
      return (
        <button
          type="button"
          onClick={() => void ctx.onDueManagementNavigate()}
          disabled={ctx.dueManagementPending}
          aria-current={isActive ? 'page' : undefined}
          className={kioskHeaderNavClass(isActive)}
        >
          納期管理
        </button>
      );
    case 'call':
      return renderLinkTab({
        to: '/kiosk/call',
        label: markLabel('通話'),
        isActive,
      });
    default:
      return null;
  }
}
