export const PLANNING_BOARD_SHEET_RATIO = 0.8;
export const PLANNING_BOARD_SHEET_MAX_HEIGHT = 760;
export const planningBoardSheetHeight = (containerHeight: number) => Math.min(containerHeight * PLANNING_BOARD_SHEET_RATIO, PLANNING_BOARD_SHEET_MAX_HEIGHT);

/** Coordinates and heights are CSS pixels within the shared container. */
export function planningBoardSheetGeometry(containerHeight: number, paneTop: number, paneBottom: number, sheetOpen: boolean, chainHeight: number) {
  const sheetHeight = sheetOpen ? planningBoardSheetHeight(containerHeight) : 0;
  const paneHeight = Math.max(0, paneBottom - paneTop);
  const sheetOverlap = Math.min(paneHeight, Math.max(0, paneBottom - (containerHeight - sheetHeight)));
  // A fully covered pane's strip must escape that pane and sit above the sheet.
  const chainBottom = Math.min(Math.max(0, containerHeight - chainHeight), Math.max(sheetHeight, containerHeight - paneBottom));
  const chainTop = containerHeight - chainBottom - chainHeight;
  const bottomInset = Math.min(paneHeight, Math.max(sheetOverlap, paneBottom - chainTop));
  return { sheetHeight, sheetOverlap, chainBottom, bottomInset };
}

export function planningBoardSharedBottomInset(paneTop: number, paneBottom: number, sheetOverlap: number, chainTop: number, chainHeight: number) {
  const overlaps = chainTop < paneBottom && chainTop + chainHeight > paneTop;
  return overlaps ? Math.min(Math.max(0, paneBottom - paneTop), Math.max(sheetOverlap, paneBottom - chainTop)) : sheetOverlap;
}
