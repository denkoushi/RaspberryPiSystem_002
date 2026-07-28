import inspectionDrawingExistingEditSopHtml from '../../../../../../docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html?raw';
import { buildKioskSopSrcDoc } from '../../kiosk-sop';

import type { KioskSopView } from '../../kiosk-sop';

const SOP_ID = 'inspection-drawing-existing-edit';
const SOP_TITLE = '検査図面 既存編集';

function createView(sheetId: 'library' | 'edit', contextLabel: string): KioskSopView {
  return Object.freeze({
    id: SOP_ID,
    title: SOP_TITLE,
    contextLabel,
    sheetId,
    srcDoc: buildKioskSopSrcDoc(inspectionDrawingExistingEditSopHtml, sheetId)
  });
}

export const INSPECTION_DRAWING_SOP_BY_SCREEN = Object.freeze({
  library: createView('library', '1 / 2 · 一覧画面'),
  templateEdit: createView('edit', '2 / 2 · 編集画面')
});
