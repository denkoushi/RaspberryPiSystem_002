import { KIOSK_PROGRESS_GRID_CAPACITY } from './kiosk-progress-overview-layout.js';

/** 1ページあたりの製番カード数（サイネージ JPEG は 4列×2段＝8スロットに合わせる） */
export const DEFAULT_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE = KIOSK_PROGRESS_GRID_CAPACITY;
export const MAX_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE = KIOSK_PROGRESS_GRID_CAPACITY;

export function sanitizeSeibanPerPage(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE;
  }
  const n = Math.floor(value);
  if (n < 1) {
    return 1;
  }
  if (n > MAX_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE) {
    return MAX_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE;
  }
  return n;
}

export function progressOverviewPageCount(itemCount: number, seibanPerPage: number): number {
  if (seibanPerPage < 1) {
    return 0;
  }
  if (itemCount <= 0) {
    return 0;
  }
  return Math.ceil(itemCount / seibanPerPage);
}

export function sliceProgressOverviewItems<T>(items: T[], pageIndex: number, seibanPerPage: number): T[] {
  if (seibanPerPage < 1) {
    return [];
  }
  const start = pageIndex * seibanPerPage;
  return items.slice(start, start + seibanPerPage);
}
