import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export const KIOSK_HEADER_TAB_LABELS: Record<KioskReorderableHeaderTabId, string> = {
  borrow: '持出',
  self_inspection: '自主検査',
  instruments_borrow: '計測機器 持出',
  rigging_borrow: '吊具 持出',
  production_schedule: '生産スケジュール',
  manual_order: '手動順番',
  leader_order_board: '順位ボード',
  progress_overview: '進捗一覧',
  load_balancing: '負荷調整',
  purchase_order_lookup: '購買照会',
  pallet_visualization: 'パレット',
  shelf_master: '棚マスタ',
  documents: '要領書',
  part_measurement: '部品測定',
  inspection_drawing: '検査図面',
  rigging_analytics: '集計',
  due_management: '納期管理',
  call: '通話'
};
