/**
 * キオスク進捗一覧 JPEG のグリッド幾何（列・段・ギャップから各カードの矩形を決める）。
 * 描画ロジックとは分離し、純関数のみとする。
 */

export const KIOSK_PROGRESS_GRID_COLUMNS = 4;
export const KIOSK_PROGRESS_GRID_ROWS = 2;
/** 1ページに並べられる製番スロット数（= columns × rows） */
export const KIOSK_PROGRESS_GRID_CAPACITY =
  KIOSK_PROGRESS_GRID_COLUMNS * KIOSK_PROGRESS_GRID_ROWS;

export interface KioskProgressOverviewGridSlot {
  index: number;
  col: number;
  row: number;
  x0: number;
  y0: number;
  cardW: number;
  cardH: number;
}

export interface KioskProgressOverviewGridLayoutInput {
  width: number;
  height: number;
  columns: number;
  rows: number;
  outerPad: number;
  colGap: number;
  rowGap: number;
}

/**
 * グリッド上の各スロットの位置・サイズを計算する（row-major: 左→右、上→下）。
 */
export function computeKioskProgressOverviewGridSlots(
  input: KioskProgressOverviewGridLayoutInput
): KioskProgressOverviewGridSlot[] {
  const { width, height, columns, rows, outerPad, colGap, rowGap } = input;
  if (columns < 1 || rows < 1 || width <= 0 || height <= 0) {
    return [];
  }

  const innerW = width - 2 * outerPad;
  const innerH = height - 2 * outerPad;
  const cardW = (innerW - (columns - 1) * colGap) / columns;
  const cardH = (innerH - (rows - 1) * rowGap) / rows;

  const slots: KioskProgressOverviewGridSlot[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      slots.push({
        index,
        col,
        row,
        x0: outerPad + col * (cardW + colGap),
        y0: outerPad + row * (cardH + rowGap),
        cardW,
        cardH,
      });
      index += 1;
    }
  }
  return slots;
}
