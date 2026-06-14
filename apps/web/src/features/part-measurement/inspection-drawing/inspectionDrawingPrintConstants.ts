/** A4 landscape sheet size (mm). */
export const INSPECTION_DRAWING_PRINT_SHEET_WIDTH_MM = 297;
export const INSPECTION_DRAWING_PRINT_SHEET_HEIGHT_MM = 210;

/** Padding applied to each print sheet (`p-[5mm]`). */
export const INSPECTION_DRAWING_PRINT_SHEET_PADDING_MM = 5;

/** Drawing `<main>` inner width after sheet padding (must match marker layout math). */
export const INSPECTION_DRAWING_PRINT_DRAWING_AREA_WIDTH_MM =
  INSPECTION_DRAWING_PRINT_SHEET_WIDTH_MM - INSPECTION_DRAWING_PRINT_SHEET_PADDING_MM * 2;

/** Record sheet grid: columns per row and max points per record page. */
export const INSPECTION_DRAWING_PRINT_RECORD_COLUMNS = 3;
export const INSPECTION_DRAWING_PRINT_RECORD_POINTS_PER_PAGE = 6;

/** When true, partial record pages keep a fixed grid with empty placeholder slots. */
export const INSPECTION_DRAWING_PRINT_FILL_EMPTY_RECORD_SLOTS = true;

/** Drawing page main area height budget (mm) after compact header. */
export const INSPECTION_DRAWING_PRINT_DRAWING_AREA_HEIGHT_MM = 172;

export const INSPECTION_DRAWING_PRINT_TIME_ZONE = 'Asia/Tokyo';

/**
 * HTML print preview is DEV-only until QR payload and record layout are finalized.
 * Enabling production also requires registering the print route outside the DEV block in App.tsx.
 */
export const INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED = import.meta.env.DEV;

/** Screen-only notice; not shown on printed sheets. */
export const INSPECTION_DRAWING_PRINT_PREVIEW_DISCLAIMER =
  'HTMLプレビュー（正式帳票ではありません。現場記録用紙として使用しないでください）';
