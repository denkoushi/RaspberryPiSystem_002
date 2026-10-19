import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export type KioskPortalGroup = {
  label: string;
  tint: string;
  hoverBorder: string;
  tabIds: readonly KioskReorderableHeaderTabId[];
};

export const KIOSK_PORTAL_GROUPS: readonly KioskPortalGroup[] = [
  { label: '持出・返却', tint: 'text-inv-cyan', hoverBorder: 'hover:border-inv-cyan', tabIds: ['borrow', 'instruments_borrow', 'rigging_borrow', 'tag_desk'] },
  { label: '生産', tint: 'text-inv-amber', hoverBorder: 'hover:border-inv-amber', tabIds: ['production_schedule', 'manual_order', 'leader_order_board', 'grinding_planning_board', 'progress_overview', 'load_balancing', 'due_management'] },
  { label: '品質・図面', tint: 'text-inv-green', hoverBorder: 'hover:border-inv-green', tabIds: ['self_inspection', 'part_measurement', 'inspection_drawing', 'documents', 'assembly'] },
  { label: '在庫・購買', tint: 'text-inv-violet', hoverBorder: 'hover:border-inv-violet', tabIds: ['inventory_settings', 'shelf_master', 'pallet_visualization', 'purchase_order_lookup'] },
  { label: '稼働・連絡', tint: 'text-inv-rose', hoverBorder: 'hover:border-inv-rose', tabIds: ['machine_signal', 'rigging_analytics', 'call'] }
];

export function groupKioskPortalTabs(tabOrder: readonly KioskReorderableHeaderTabId[]) {
  return KIOSK_PORTAL_GROUPS.map((group, index) => ({
    ...group,
    tabIds: tabOrder.filter((id) => {
      const groupIndex = KIOSK_PORTAL_GROUPS.findIndex((candidate) => candidate.tabIds.includes(id));
      return (groupIndex < 0 ? KIOSK_PORTAL_GROUPS.length - 1 : groupIndex) === index;
    })
  }));
}
