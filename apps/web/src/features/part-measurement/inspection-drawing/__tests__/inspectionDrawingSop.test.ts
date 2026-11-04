import { describe, expect, it } from 'vitest';

import { getKioskSopManual } from '../../../kiosk-sop/kioskSopRegistry';
import { INSPECTION_DRAWING_SOP_BY_SCREEN } from '../inspectionDrawingSop';

describe('INSPECTION_DRAWING_SOP_BY_SCREEN', () => {
  it('maps the library and template revision to their canonical sheets', async () => {
    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.library).toMatchObject({
      manualId: 'inspection-drawing',
      initialSheetId: 'library-entry-search'
    });

    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.templateEdit).toMatchObject({
      manualId: 'inspection-drawing',
      initialSheetId: 'edit-basics'
    });

    const manual = getKioskSopManual('inspection-drawing');
    expect(manual.sheets).toHaveLength(10);
    expect(await manual.loadSourceHtml()).toContain('検査図面を開く');
    expect(await manual.loadSourceHtml()).toContain('一覧に戻る');
    expect(await manual.loadSourceHtml()).toContain('必須');
    expect(await manual.loadSourceHtml()).toContain('任意');
  });
});
