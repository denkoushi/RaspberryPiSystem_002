/** A4 landscape sheet size (mm). */
export const INSPECTION_DRAWING_PRINT_SHEET_WIDTH_MM = 297;
export const INSPECTION_DRAWING_PRINT_SHEET_HEIGHT_MM = 210;

/** Padding applied to each print sheet (`p-[5mm]`). */
export const INSPECTION_DRAWING_PRINT_SHEET_PADDING_MM = 5;

/** Drawing page padding after removing P1 OCR fiducials. */
export const INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM = 3;

/** Drawing `<main>` inner width after sheet padding (must match marker layout math). */
export const INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM =
  INSPECTION_DRAWING_PRINT_SHEET_WIDTH_MM - INSPECTION_DRAWING_PRINT_DRAWING_PAGE_PADDING_MM * 2;

/** Record sheet page capacity. */
export const INSPECTION_DRAWING_PRINT_RECORD_POINTS_PER_PAGE = 14;
export const INSPECTION_DRAWING_PRINT_RECORD_ENTRIES_PER_PAGE = 5;
export const INSPECTION_DRAWING_PRINT_MAX_ENTRY_COUNT = 2000;

/** Record table widths (mm): fit 5 OCR-friendly value columns in the A4 landscape body. */
export const INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM = {
  no: 8,
  measurementPoint: 24,
  specification: 30,
  measurementValue: 45
} as const;

export const INSPECTION_DRAWING_PRINT_RECORD_TABLE_FIXED_WIDTH_MM =
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.no +
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementPoint +
  INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.specification;

export function getInspectionDrawingPrintRecordTableWidthMm(entryColumnCount: number): number {
  return (
    INSPECTION_DRAWING_PRINT_RECORD_TABLE_FIXED_WIDTH_MM +
    Math.max(1, entryColumnCount) *
      INSPECTION_DRAWING_PRINT_RECORD_TABLE_COLUMN_WIDTHS_MM.measurementValue
  );
}

/** When true, partial record pages keep a fixed grid with empty placeholder slots. */
export const INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS = true;

/** Drawing page main area height budget (mm) after compact header. */
export const INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM = 195;

export const INSPECTION_DRAWING_PRINT_TIME_ZONE = 'Asia/Tokyo';

/**
 * Production route is enabled for staged Pi5 validation before broader rollout.
 * Keep the preview disclaimer until QR payload / formal report ID are finalized.
 */
export const INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED = true;

/** Screen-only notice; not shown on printed sheets. */
export const INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER =
  'HTMLプレビュー（正式帳票ではありません。現場記録用紙として使用しないでください）';
