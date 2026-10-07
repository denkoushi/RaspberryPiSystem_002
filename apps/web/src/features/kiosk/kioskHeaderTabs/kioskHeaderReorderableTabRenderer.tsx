import { resolveKioskDefaultModePath } from '@raspi-system/shared-types';
import { Link } from 'react-router-dom';

import { KIOSK_MACHINE_SIGNAL_PATH } from '../../machine-signal/machineSignalRoutes';
import {
  isKioskInspectionDrawingPath,
  isKioskPartMeasurementHubPath,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH
} from '../../part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';
import { isKioskSelfInspectionPath } from '../../part-measurement/selfInspectionRoutes';

import { kioskHeaderNavClass } from './kioskHeaderNavClass';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

export type KioskHeaderReorderableTabContext = {
  pathname: string;
  defaultMode?: 'PHOTO' | 'TAG';
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
  const { pathname } = ctx;

  switch (tabId) {
    case 'borrow':
      return renderLinkTab({
        to: resolveKioskBorrowHeaderTabPath(ctx.defaultMode),
        label: '持出',
        isActive: pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo',
      });
    case 'inventory_settings':
      return renderLinkTab({
        to: '/kiosk/inventory',
        label: '在庫',
        isActive: pathname.startsWith('/kiosk/inventory'),
      });
    case 'self_inspection':
      return renderLinkTab({
        to: '/kiosk/part-measurement/self-inspection',
        label: '自主検査',
        isActive: isKioskSelfInspectionPath(pathname),
      });
    case 'instruments_borrow':
      return renderLinkTab({
        to: '/kiosk/instruments/borrow',
        label: '計測機器 持出',
        isActive: pathname.startsWith('/kiosk/instruments/borrow'),
      });
    case 'rigging_borrow':
      return renderLinkTab({
        to: '/kiosk/rigging/borrow',
        label: '吊具 持出',
        isActive: pathname.startsWith('/kiosk/rigging/borrow'),
      });
    case 'tag_desk':
      return renderLinkTab({
        to: '/kiosk/tag-desk',
        label: 'タグ管理',
        isActive: pathname.startsWith('/kiosk/tag-desk'),
      });
    case 'production_schedule':
      return renderLinkTab({
        to: '/kiosk/production-schedule',
        label: '生産スケジュール',
        isActive: pathname === '/kiosk/production-schedule',
      });
    case 'manual_order':
      return renderLinkTab({
        to: '/kiosk/production-schedule/manual-order',
        label: '手動順番',
        isActive: pathname.startsWith('/kiosk/production-schedule/manual-order'),
      });
    case 'leader_order_board':
      return renderLinkTab({
        to: '/kiosk/production-schedule/leader-order-board',
        label: '順位ボード',
        isActive: pathname.startsWith('/kiosk/production-schedule/leader-order-board'),
      });
    case 'grinding_planning_board':
      return renderLinkTab({
        to: '/kiosk/production-schedule/planning-board',
        label: '製番ボード',
        isActive: pathname.startsWith('/kiosk/production-schedule/planning-board'),
      });
    case 'progress_overview':
      return renderLinkTab({
        to: '/kiosk/production-schedule/progress-overview',
        label: '進捗一覧',
        isActive: pathname.startsWith('/kiosk/production-schedule/progress-overview'),
      });
    case 'load_balancing':
      return renderLinkTab({
        to: '/kiosk/production-schedule/load-balancing',
        label: '負荷調整',
        isActive: pathname.startsWith('/kiosk/production-schedule/load-balancing'),
      });
    case 'purchase_order_lookup':
      return renderLinkTab({
        to: '/kiosk/purchase-order-lookup',
        label: '購買照会',
        isActive: pathname.startsWith('/kiosk/purchase-order-lookup'),
      });
    case 'pallet_visualization':
      return renderLinkTab({
        to: '/kiosk/pallet-visualization',
        label: 'パレット',
        isActive: pathname.startsWith('/kiosk/pallet-visualization'),
      });
    case 'shelf_master':
      return renderLinkTab({
        to: '/kiosk/mobile-placement/shelf-master',
        label: '棚マスタ',
        isActive: pathname.startsWith('/kiosk/mobile-placement/shelf-master'),
      });
    case 'documents':
      return renderLinkTab({
        to: '/kiosk/documents',
        label: '要領書',
        isActive: pathname.startsWith('/kiosk/documents'),
      });
    case 'assembly':
      return renderLinkTab({
        to: '/kiosk/assembly',
        label: '組立',
        isActive: pathname.startsWith('/kiosk/assembly'),
      });
    case 'part_measurement':
      return renderLinkTab({
        to: '/kiosk/part-measurement',
        label: '部品測定',
        isActive: isKioskPartMeasurementHubPath(pathname),
      });
    case 'inspection_drawing':
      return renderLinkTab({
        to: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
        label: '検査図面',
        isActive: isKioskInspectionDrawingPath(pathname),
      });
    case 'rigging_analytics': {
      const isActive = pathname.startsWith('/kiosk/rigging-analytics');
      return renderLinkTab({
        to: '/kiosk/rigging-analytics',
        label: '集計',
        isActive,
      });
    }
    case 'machine_signal':
      return renderLinkTab({
        to: KIOSK_MACHINE_SIGNAL_PATH,
        label: '設備稼働',
        isActive: pathname.startsWith(KIOSK_MACHINE_SIGNAL_PATH),
      });
    case 'due_management':
      return (
        <button
          type="button"
          onClick={() => void ctx.onDueManagementNavigate()}
          disabled={ctx.dueManagementPending}
          aria-current={pathname.startsWith('/kiosk/production-schedule/due-management') ? 'page' : undefined}
          className={kioskHeaderNavClass(
            pathname.startsWith('/kiosk/production-schedule/due-management')
          )}
        >
          納期管理
        </button>
      );
    case 'call':
      return renderLinkTab({
        to: '/kiosk/call',
        label: '通話',
        isActive: pathname.startsWith('/kiosk/call'),
      });
    default:
      return null;
  }
}
