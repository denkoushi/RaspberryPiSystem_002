/** 自主検査セッション画面の図面パネル表示フェーズ（SelfInspection 専用） */
export type SelfInspectionDrawingPanelPhase = 'canvas' | 'loading' | 'missing' | 'error';

export function resolveSelfInspectionDrawingPanelPhase(input: {
  drawingPath: string | null | undefined;
  blobUrl: string | null | undefined;
  loadError: string | null | undefined;
}): SelfInspectionDrawingPanelPhase {
  const hasDrawingPath = Boolean(input.drawingPath?.trim());
  if (!hasDrawingPath) {
    return 'missing';
  }
  if (input.loadError?.trim()) {
    return 'error';
  }
  if (input.blobUrl?.trim()) {
    return 'canvas';
  }
  return 'loading';
}

export function selfInspectionDrawingZoomEnabled(blobUrl: string | null | undefined): boolean {
  return Boolean(blobUrl?.trim());
}
