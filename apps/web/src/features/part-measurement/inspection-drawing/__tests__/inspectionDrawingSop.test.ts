import { describe, expect, it } from 'vitest';

import { INSPECTION_DRAWING_SOP_BY_SCREEN } from '../inspectionDrawingSop';

describe('INSPECTION_DRAWING_SOP_BY_SCREEN', () => {
  it('maps the library and template revision to their canonical sheets', () => {
    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.library).toMatchObject({
      id: 'inspection-drawing-existing-edit',
      sheetId: 'library',
      contextLabel: '1 / 2 · 一覧画面'
    });
    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.library.srcDoc).toContain(
      '検査図面を開く'
    );

    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.templateEdit).toMatchObject({
      id: 'inspection-drawing-existing-edit',
      sheetId: 'edit',
      contextLabel: '2 / 2 · 編集画面'
    });
    expect(INSPECTION_DRAWING_SOP_BY_SCREEN.templateEdit.srcDoc).toContain(
      '一覧に戻る'
    );
  });
});
