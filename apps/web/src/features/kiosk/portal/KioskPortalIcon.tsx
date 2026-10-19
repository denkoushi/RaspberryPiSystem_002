import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

const cardPaths: Record<KioskReorderableHeaderTabId, string> = {
  borrow: 'M4 4h10v5M14 15v5H4V4m6 8h11m-4-4 4 4-4 4',
  instruments_borrow: 'M5 3h14v18H5zM8 6h8v5H8zM8 15h1m6 0h1m-8 3h1m6 0h1',
  rigging_borrow: 'M12 3v6a4 4 0 1 1-4 4M7 3h10M5 21h14',
  tag_desk: 'M3 3h8l10 10-8 8L3 11zM7 7h.01',
  production_schedule: 'M4 5h16v16H4zM4 10h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 3h2',
  manual_order: 'M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01',
  leader_order_board: 'M3 9h5v12H3zM10 3h5v18h-5zM17 13h4v8h-4z',
  grinding_planning_board: 'M3 4h18v16H3zM3 9h18M8 9v11m5-7h5m-5 3h3',
  progress_overview: 'M4 3v18h17M7 15l4-5 4 3 6-8',
  load_balancing: 'M12 3v18M5 21h14M3 7h18M6 7l-3 8h6L6 7m12 0-3 8h6l-3-8',
  due_management: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2',
  self_inspection: 'M9 4H5v17h14V4h-4M9 3h6v4H9zM8 13l3 3 5-6',
  part_measurement: 'M3 7h18v10H3zM7 7v5m4-5v3m4-3v5m4-5v3',
  inspection_drawing: 'M4 3h11l5 5v13H4zM15 3v6h5M7 17l4-6 5 6H7',
  documents: 'M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3zM12 6v15',
  assembly: 'M12 3l8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10',
  inventory_settings: 'M3 4h18v6H3zM5 10v11h14V10M9 14h6',
  shelf_master: 'M4 3v18M20 3v18M4 10h16M4 19h16M7 4h5v6H7zM12 13h5v6h-5z',
  pallet_visualization: 'M3 17h18v4H3zM6 17v4m12-4v4M5 3h14v11H5zM12 3v11M5 8h14',
  purchase_order_lookup: 'M4 3h10v6M4 3v18h8M14 3l6 6h-6V3M16 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8M19 19l3 3',
  machine_signal: 'M3 12h4l3-8 4 16 3-8h4',
  rigging_analytics: 'M4 20V10h4v10m4 0V4h4v16m4 0v-6M2 21h20',
  call: 'M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4c0 2-2 2-3 2C10 20 4 14 3 6c0-1 0-3 2-3'
};

export function KioskPortalIcon({ tabId, className }: { tabId?: KioskReorderableHeaderTabId; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d={tabId ? cardPaths[tabId] : 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'} />
  </svg>;
}
