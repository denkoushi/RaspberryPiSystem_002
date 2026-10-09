import { describe, expect, it } from 'vitest';

import {
  KIOSK_INITIAL_ROUTE_IDS,
  KIOSK_INITIAL_ROUTE_LABELS,
  KIOSK_INITIAL_ROUTE_PATHS,
  KIOSK_SELECTABLE_INITIAL_ROUTE_IDS,
  isKioskSelectableInitialRouteId,
  resolveKioskInitialPath
} from './kiosk-initial-route.js';

describe('kiosk initial route contract', () => {
  it('exposes self-inspection as a selectable initial route', () => {
    expect(KIOSK_INITIAL_ROUTE_IDS).toContain('self_inspection');
    expect(KIOSK_SELECTABLE_INITIAL_ROUTE_IDS).toContain('self_inspection');
    expect(KIOSK_INITIAL_ROUTE_LABELS.self_inspection).toBe('自主検査');
    expect(KIOSK_INITIAL_ROUTE_PATHS.self_inspection).toBe(
      '/kiosk/part-measurement/self-inspection'
    );
    expect(isKioskSelectableInitialRouteId('self_inspection')).toBe(true);
  });

  it('resolves self-inspection before the legacy default mode fallback', () => {
    expect(
      resolveKioskInitialPath({ initialRoute: 'self_inspection', defaultMode: 'PHOTO' })
    ).toBe('/kiosk/part-measurement/self-inspection');
  });
});

const expectedRoutes = [
  ['borrow_tag', '2タグスキャン', '/kiosk/tag'],
  ['borrow_photo', '写真撮影持出', '/kiosk/photo'],
  ['production_schedule', '生産スケジュール', '/kiosk/production-schedule'],
  ['leader_order_board', '順位ボード', '/kiosk/production-schedule/leader-order-board'],
  ['assembly', '組立', '/kiosk/assembly'],
  ['self_inspection', '自主検査', '/kiosk/part-measurement/self-inspection'],
  ['inventory_settings', '在庫', '/kiosk/inventory'],
  ['instruments_borrow', '計測機器 持出', '/kiosk/instruments/borrow'],
  ['rigging_borrow', '吊具 持出', '/kiosk/rigging/borrow'],
  ['manual_order', '手動順番', '/kiosk/production-schedule/manual-order'],
  ['grinding_planning_board', '製番ボード', '/kiosk/production-schedule/planning-board'],
  ['progress_overview', '進捗一覧', '/kiosk/production-schedule/progress-overview'],
  ['load_balancing', '負荷調整', '/kiosk/production-schedule/load-balancing'],
  ['purchase_order_lookup', '購買照会', '/kiosk/purchase-order-lookup'],
  ['pallet_visualization', 'パレット', '/kiosk/pallet-visualization'],
  ['shelf_master', '棚マスタ', '/kiosk/mobile-placement/shelf-master'],
  ['documents', '要領書', '/kiosk/documents'],
  ['part_measurement', '部品測定', '/kiosk/part-measurement'],
  ['inspection_drawing', '検査図面', '/kiosk/part-measurement/inspection'],
  ['rigging_analytics', '集計', '/kiosk/rigging-analytics'],
  ['machine_signal', '設備稼働', '/kiosk/machine-signal'],
  ['call', '通話', '/kiosk/call']
] as const;

describe('all startup pages', () => {
  it('includes every eligible header tab, all selectable, without PIN tabs', async () => {
    const { KIOSK_REORDERABLE_HEADER_TAB_IDS } = await import('./kiosk-header-tab-order.js');
    const expectedIds = KIOSK_REORDERABLE_HEADER_TAB_IDS.flatMap((id) =>
      id === 'borrow' ? ['borrow_tag', 'borrow_photo'] : id === 'tag_desk' || id === 'due_management' ? [] : [id]
    );
    expect([...KIOSK_INITIAL_ROUTE_IDS].sort()).toEqual(expectedIds.sort());
    expect(KIOSK_SELECTABLE_INITIAL_ROUTE_IDS).toEqual(KIOSK_INITIAL_ROUTE_IDS);
    expect(Object.keys(KIOSK_INITIAL_ROUTE_PATHS).sort()).toEqual([...KIOSK_INITIAL_ROUTE_IDS].sort());
    expect(Object.keys(KIOSK_INITIAL_ROUTE_LABELS).sort()).toEqual([...KIOSK_INITIAL_ROUTE_IDS].sort());
    expect(isKioskSelectableInitialRouteId('tag_desk')).toBe(false);
    expect(isKioskSelectableInitialRouteId('due_management')).toBe(false);
  });

  it.each(expectedRoutes)('keeps the ID, label and path for %s', (id, label, path) => {
    expect(KIOSK_INITIAL_ROUTE_IDS).toContain(id);
    expect(KIOSK_INITIAL_ROUTE_LABELS[id]).toBe(label);
    expect(KIOSK_INITIAL_ROUTE_PATHS[id]).toBe(path);
    expect(resolveKioskInitialPath({ initialRoute: id, defaultMode: 'TAG' })).toBe(path);
  });

  it('resolves null using the legacy default mode', () => {
    expect(resolveKioskInitialPath({ initialRoute: null, defaultMode: 'PHOTO' })).toBe('/kiosk/photo');
    expect(resolveKioskInitialPath({ initialRoute: null, defaultMode: 'TAG' })).toBe('/kiosk/tag');
  });
});
