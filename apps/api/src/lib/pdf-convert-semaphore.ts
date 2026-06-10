import {
  resetDrawingRasterConvertSemaphoreForTests,
  withDrawingRasterConvertSlot
} from './drawing-raster-convert-semaphore.js';

/** @deprecated 互換 alias — 新規コードは withDrawingRasterConvertSlot を使う */
export async function withPdfConvertSlot<T>(fn: () => Promise<T>): Promise<T> {
  return withDrawingRasterConvertSlot(fn);
}

/** @deprecated 互換 alias */
export function resetPdfConvertSemaphoreForTests(): void {
  resetDrawingRasterConvertSemaphoreForTests();
}
