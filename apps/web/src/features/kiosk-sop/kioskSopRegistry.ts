import inspectionDrawingSopHtml from '../../generated/kiosk-sop/inspection-drawing/manual.html?raw';

import type { KioskSopManual, KioskSopManualId } from './types';

const INSPECTION_DRAWING_MANUAL: KioskSopManual = Object.freeze({
  id: 'inspection-drawing',
  title: '検査図面 操作取説',
  sourceHtml: inspectionDrawingSopHtml,
  sheets: Object.freeze([
    { id: 'library-entry-search', label: '一覧・検索' },
    { id: 'library-visual-management', label: '図面管理' },
    { id: 'library-template-management', label: 'テンプレート管理' },
    { id: 'edit-basics', label: '編集の基本' },
    { id: 'edit-visual-source', label: '図面ソース' },
    { id: 'edit-required-point', label: '測定点の必須項目' },
    { id: 'edit-advanced-point', label: '測定点の補助設定' },
    { id: 'edit-point-management', label: '点・引出線管理' },
    { id: 'edit-trial-report', label: '試行・帳票' },
    { id: 'edit-group-history', label: '資源・履歴' }
  ])
});

const MANUALS: Readonly<Record<KioskSopManualId, KioskSopManual>> = Object.freeze({
  'inspection-drawing': INSPECTION_DRAWING_MANUAL
});

export function getKioskSopManual(manualId: KioskSopManualId): KioskSopManual {
  return MANUALS[manualId];
}
