import type { ReactNode } from 'react';

/** キオスク実機相当の最小幅（lg ブレークポイント・ヘッダー1行を再現） */
export const KIOSK_INSPECTION_DRAWING_DEV_PREVIEW_MIN_WIDTH_CLASS = 'min-w-[1280px]';

/** KioskLayout main px-4 相当の有効幅上限 */
export const KIOSK_INSPECTION_DRAWING_DEV_PREVIEW_CONTENT_WIDTH_CLASS =
  'mx-auto w-full max-w-[calc(1280px-2rem)]';

type Props = {
  /** 本番 pathname（比較用ラベル） */
  productionPath: string;
  /** 本番ページ直下 div と同じ className */
  rootClassName: string;
  children: ReactNode;
  /** 画面下部の開発メモ（レイアウトに影響しない fixed） */
  footnote?: string;
  /** true のとき KioskLayout px-4 相当の有効幅を内側ラッパで再現 */
  simulateKioskContentWidth?: boolean;
};

/**
 * 検査図面の開発プレビュー用ラッパー。
 * 本番は KioskLayout > main(px-4 py-4) > ページ直下 div のみ。
 * h-dvh や開発用ヘッダーをページ内に置くとキャンバス高さ・図面 scale がズレるため、オーバーレイのみ付与する。
 */
export function KioskInspectionDrawingDevPreviewChrome({
  productionPath,
  rootClassName,
  children,
  footnote,
  simulateKioskContentWidth = false
}: Props) {
  const pageRoot = simulateKioskContentWidth ? (
    <div className={KIOSK_INSPECTION_DRAWING_DEV_PREVIEW_CONTENT_WIDTH_CLASS}>
      <div className={rootClassName}>{children}</div>
    </div>
  ) : (
    <div className={rootClassName}>{children}</div>
  );

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] border-t border-amber-500/35 bg-amber-950/92 px-2 py-1 text-center text-[0.7rem] font-medium leading-snug text-amber-100/95 shadow-[0_-4px_12px_rgba(0,0,0,0.35)]"
        aria-hidden
      >
        <span className="font-semibold">DEV</span> · 本番ルート {productionPath}
        {footnote ? <> · {footnote}</> : null}
      </div>
      <div className={`w-full ${KIOSK_INSPECTION_DRAWING_DEV_PREVIEW_MIN_WIDTH_CLASS}`}>{pageRoot}</div>
    </>
  );
}
