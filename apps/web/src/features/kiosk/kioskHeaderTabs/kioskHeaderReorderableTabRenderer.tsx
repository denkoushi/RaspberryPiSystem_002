import { NavLink } from 'react-router-dom';

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
  onDueManagementNavigate: () => void;
  dueManagementPending: boolean;
};

function renderNavLinkTab(params: {
  to: string;
  label: ReactNode;
  isActive: boolean;
  activeClassName: string;
  end?: boolean;
  style?: React.CSSProperties;
}): ReactNode {
  const { to, label, isActive, activeClassName, end, style } = params;
  return (
    <NavLink
      to={to}
      end={end}
      className={() => kioskHeaderNavClass(isActive, activeClassName)}
      style={style}
    >
      {label}
    </NavLink>
  );
}

export function renderKioskReorderableHeaderTab(
  tabId: KioskReorderableHeaderTabId,
  ctx: KioskHeaderReorderableTabContext
): ReactNode {
  const { pathname } = ctx;

  switch (tabId) {
    case 'borrow':
      return renderNavLinkTab({
        to: '/kiosk',
        label: '持出',
        isActive: pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo',
        activeClassName: 'bg-emerald-500 text-white'
      });
    case 'self_inspection':
      return renderNavLinkTab({
        to: '/kiosk/part-measurement/self-inspection',
        label: '自主検査',
        isActive: isKioskSelfInspectionPath(pathname),
        activeClassName: 'bg-amber-500 text-slate-950'
      });
    case 'instruments_borrow':
      return renderNavLinkTab({
        to: '/kiosk/instruments/borrow',
        label: '計測機器 持出',
        isActive: pathname.startsWith('/kiosk/instruments/borrow'),
        activeClassName: 'bg-emerald-500 text-white'
      });
    case 'rigging_borrow':
      return renderNavLinkTab({
        to: '/kiosk/rigging/borrow',
        label: '吊具 持出',
        isActive: pathname.startsWith('/kiosk/rigging/borrow'),
        activeClassName: 'bg-amber-400 text-slate-900'
      });
    case 'production_schedule':
      return renderNavLinkTab({
        to: '/kiosk/production-schedule',
        label: '生産スケジュール',
        isActive: pathname === '/kiosk/production-schedule',
        activeClassName: 'bg-blue-500 text-white',
        end: true
      });
    case 'manual_order':
      return renderNavLinkTab({
        to: '/kiosk/production-schedule/manual-order',
        label: '手動順番',
        isActive: pathname.startsWith('/kiosk/production-schedule/manual-order'),
        activeClassName: 'bg-indigo-500 text-white'
      });
    case 'leader_order_board':
      return renderNavLinkTab({
        to: '/kiosk/production-schedule/leader-order-board',
        label: '順位ボード',
        isActive: pathname.startsWith('/kiosk/production-schedule/leader-order-board'),
        activeClassName: 'bg-violet-600 text-white'
      });
    case 'progress_overview':
      return renderNavLinkTab({
        to: '/kiosk/production-schedule/progress-overview',
        label: '進捗一覧',
        isActive: pathname.startsWith('/kiosk/production-schedule/progress-overview'),
        activeClassName: 'bg-cyan-600 text-white'
      });
    case 'load_balancing':
      return renderNavLinkTab({
        to: '/kiosk/production-schedule/load-balancing',
        label: '負荷調整',
        isActive: pathname.startsWith('/kiosk/production-schedule/load-balancing'),
        activeClassName: 'bg-fuchsia-700 text-white'
      });
    case 'purchase_order_lookup':
      return renderNavLinkTab({
        to: '/kiosk/purchase-order-lookup',
        label: '購買照会',
        isActive: pathname.startsWith('/kiosk/purchase-order-lookup'),
        activeClassName: 'bg-lime-600 text-white'
      });
    case 'pallet_visualization':
      return renderNavLinkTab({
        to: '/kiosk/pallet-visualization',
        label: 'パレット',
        isActive: pathname.startsWith('/kiosk/pallet-visualization'),
        activeClassName: 'bg-orange-600 text-white'
      });
    case 'shelf_master':
      return renderNavLinkTab({
        to: '/kiosk/mobile-placement/shelf-master',
        label: '棚マスタ',
        isActive: pathname.startsWith('/kiosk/mobile-placement/shelf-master'),
        activeClassName: 'bg-stone-600 text-white'
      });
    case 'documents':
      return renderNavLinkTab({
        to: '/kiosk/documents',
        label: '要領書',
        isActive: pathname.startsWith('/kiosk/documents'),
        activeClassName: 'bg-teal-600 text-white'
      });
    case 'assembly':
      return renderNavLinkTab({
        to: '/kiosk/assembly',
        label: '組立',
        isActive: pathname.startsWith('/kiosk/assembly'),
        activeClassName: 'bg-cyan-500 text-slate-950'
      });
    case 'part_measurement':
      return renderNavLinkTab({
        to: '/kiosk/part-measurement',
        label: '部品測定',
        isActive: isKioskPartMeasurementHubPath(pathname),
        activeClassName: 'bg-rose-600 text-white'
      });
    case 'inspection_drawing':
      return renderNavLinkTab({
        to: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
        label: '検査図面',
        isActive: isKioskInspectionDrawingPath(pathname),
        activeClassName: 'bg-amber-700 text-white'
      });
    case 'rigging_analytics': {
      const isActive = pathname.startsWith('/kiosk/rigging-analytics');
      return renderNavLinkTab({
        to: '/kiosk/rigging-analytics',
        label: '集計',
        isActive,
        activeClassName: 'text-white',
        style: isActive ? { backgroundColor: 'var(--color-primitive-blue-900)' } : undefined
      });
    }
    case 'due_management':
      return (
        <button
          type="button"
          onClick={() => void ctx.onDueManagementNavigate()}
          disabled={ctx.dueManagementPending}
          className={kioskHeaderNavClass(
            pathname.startsWith('/kiosk/production-schedule/due-management'),
            'bg-sky-600 text-white'
          )}
        >
          納期管理
        </button>
      );
    case 'call':
      return renderNavLinkTab({
        to: '/kiosk/call',
        label: '📞 通話',
        isActive: pathname.startsWith('/kiosk/call'),
        activeClassName: 'bg-purple-600 text-white'
      });
    default:
      return null;
  }
}
