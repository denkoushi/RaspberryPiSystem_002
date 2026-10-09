import { KIOSK_REORDERABLE_HEADER_TAB_IDS, isKioskInitialRouteId } from '@raspi-system/shared-types';

import { KIOSK_MACHINE_SIGNAL_PATH } from '../../machine-signal/machineSignalRoutes';
import {
  isKioskInspectionDrawingPath,
  isKioskPartMeasurementHubPath
} from '../../part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';
import { isKioskSelfInspectionPath } from '../../part-measurement/selfInspectionRoutes';

import type { KioskInitialRouteId, KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export function isKioskHeaderTabActive(tabId: KioskReorderableHeaderTabId, pathname: string): boolean {
  switch (tabId) {
    case 'borrow':
      return pathname === '/kiosk' || pathname === '/kiosk/tag' || pathname === '/kiosk/photo';
    case 'inventory_settings':
      return pathname.startsWith('/kiosk/inventory');
    case 'self_inspection':
      return isKioskSelfInspectionPath(pathname);
    case 'instruments_borrow':
      return pathname.startsWith('/kiosk/instruments/borrow');
    case 'rigging_borrow':
      return pathname.startsWith('/kiosk/rigging/borrow');
    case 'tag_desk':
      return pathname.startsWith('/kiosk/tag-desk');
    case 'production_schedule':
      return pathname === '/kiosk/production-schedule';
    case 'manual_order':
      return pathname.startsWith('/kiosk/production-schedule/manual-order');
    case 'leader_order_board':
      return pathname.startsWith('/kiosk/production-schedule/leader-order-board');
    case 'grinding_planning_board':
      return pathname.startsWith('/kiosk/production-schedule/planning-board');
    case 'progress_overview':
      return pathname.startsWith('/kiosk/production-schedule/progress-overview');
    case 'load_balancing':
      return pathname.startsWith('/kiosk/production-schedule/load-balancing');
    case 'purchase_order_lookup':
      return pathname.startsWith('/kiosk/purchase-order-lookup');
    case 'pallet_visualization':
      return pathname.startsWith('/kiosk/pallet-visualization');
    case 'shelf_master':
      return pathname.startsWith('/kiosk/mobile-placement/shelf-master');
    case 'documents':
      return pathname.startsWith('/kiosk/documents');
    case 'assembly':
      return pathname.startsWith('/kiosk/assembly');
    case 'part_measurement':
      return isKioskPartMeasurementHubPath(pathname);
    case 'inspection_drawing':
      return isKioskInspectionDrawingPath(pathname);
    case 'rigging_analytics':
      return pathname.startsWith('/kiosk/rigging-analytics');
    case 'machine_signal':
      return pathname.startsWith(KIOSK_MACHINE_SIGNAL_PATH);
    case 'due_management':
      return pathname.startsWith('/kiosk/production-schedule/due-management');
    case 'call':
      return pathname.startsWith('/kiosk/call');
  }
}

export function resolveActiveKioskHeaderTab(pathname: string): KioskReorderableHeaderTabId | undefined {
  return KIOSK_REORDERABLE_HEADER_TAB_IDS.find((tabId) => isKioskHeaderTabActive(tabId, pathname));
}

export function resolveCurrentKioskInitialRoute(pathname: string): KioskInitialRouteId | null {
  const tabId = resolveActiveKioskHeaderTab(pathname);
  if (tabId === 'borrow') return pathname === '/kiosk/photo' ? 'borrow_photo' : 'borrow_tag';
  return tabId && isKioskInitialRouteId(tabId) ? tabId : null;
}
