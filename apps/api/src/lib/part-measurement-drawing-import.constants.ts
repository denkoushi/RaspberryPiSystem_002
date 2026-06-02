/** 部品測定図面: 画像ファイルの入力上限（変換前） */
export const PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES = 12 * 1024 * 1024;

/** 部品測定図面: PDF ファイルの入力上限（変換前） */
export const PART_MEASUREMENT_PDF_INPUT_MAX_BYTES = 30 * 1024 * 1024;

/** 部品測定図面: 保存する画像（変換後 JPEG 含む）の上限 */
export const PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES = 12 * 1024 * 1024;

/** PDF → JPEG 変換 DPI（部品測定図面専用） */
export const PART_MEASUREMENT_PDF_RENDER_DPI = 144;

/** PDF → JPEG 変換品質 */
export const PART_MEASUREMENT_PDF_JPEG_QUALITY = 85;

/** pdftoppm 実行 timeout（ms） */
export const PART_MEASUREMENT_PDF_CONVERT_TIMEOUT_MS = 30_000;

/** PDF 変換待ちキュー上限（同時実行 1 件 + 待機 N 件を超えたら 503） */
export const PART_MEASUREMENT_PDF_CONVERT_QUEUE_MAX = 4;
