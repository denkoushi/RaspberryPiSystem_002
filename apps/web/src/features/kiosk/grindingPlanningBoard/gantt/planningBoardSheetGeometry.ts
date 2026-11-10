/** Coordinates and heights are CSS pixels within the shared container. */
export function planningBoardSheetGeometry(containerHeight: number, paneTop: number, paneBottom: number, sheetOpen: boolean, chainHeight: number) {
  const sheetHeight = sheetOpen ? Math.min(containerHeight * 0.56, 520) : 0;
  const paneHeight = Math.max(0, paneBottom - paneTop);
  const sheetOverlap = Math.min(paneHeight, Math.max(0, paneBottom - (containerHeight - sheetHeight)));
  // A fully covered pane's strip must escape that pane and sit above the sheet.
  const chainBottom = Math.min(Math.max(0, containerHeight - chainHeight), Math.max(sheetHeight, containerHeight - paneBottom));
  const chainTop = containerHeight - chainBottom - chainHeight;
  const bottomInset = Math.min(paneHeight, Math.max(sheetOverlap, paneBottom - chainTop));
  return { sheetHeight, sheetOverlap, chainBottom, bottomInset };
}
