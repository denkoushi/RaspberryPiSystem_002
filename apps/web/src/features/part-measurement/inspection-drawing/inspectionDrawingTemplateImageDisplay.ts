/**
 * テンプレ作成/編集画面の図面表示 URL 解決。
 * サーバー相対パスは usePartMeasurementDrawingBlobUrl で Blob 化してから渡す。
 */

/** 新規ファイル選択中はサーバー取得を抑止する */
export function inspectionDrawingBlobFetchPath(
  serverDrawingRelativePath: string | null | undefined,
  hasLocalImageFile: boolean
): string | null {
  if (hasLocalImageFile) return null;
  const path = serverDrawingRelativePath?.trim();
  return path ? path : null;
}

/** キャンバス・ズーム UI 用の最終表示 URL（ローカルプレビュー優先） */
export function inspectionDrawingCanvasImageUrl(
  localPreviewUrl: string | null | undefined,
  serverDrawingBlobUrl: string | null | undefined
): string | null {
  return localPreviewUrl ?? serverDrawingBlobUrl ?? null;
}

/** 図面あり判定（読込中も含む — サーバー path・ローカル preview・PDF 変換中） */
export function inspectionDrawingHasImageSource(
  localPreviewUrl: string | null | undefined,
  serverDrawingRelativePath: string | null | undefined,
  previewResolving = false
): boolean {
  if (localPreviewUrl?.trim()) return true;
  if (previewResolving) return true;
  return Boolean(serverDrawingRelativePath?.trim());
}
