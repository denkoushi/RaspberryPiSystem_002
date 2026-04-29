/**
 * KioskActiveLoanCard のレイアウト定数（色トークンは {@link resolveKioskLoanCardSurfaceTokens} に分離）。
 * Tailwind JIT がクラスを検出できるよう、ピクセル指定クラスはこのファイル内でリテラルとして記述する。
 */

/** 歴史的ベースサムネ寸法（キオスク）。倍率適用前のエッジ長（px）。 */
export const KIOSK_ACTIVE_LOAN_CARD_THUMB_BASE_PX = 72;

/** サムネ表示倍率（要件: 1.5倍）。 */
export const KIOSK_ACTIVE_LOAN_CARD_THUMB_SCALE = 1.5;

/** サムネ表示エッジ長（px）。 `BASE * SCALE` を整数へ。 */
export const KIOSK_ACTIVE_LOAN_CARD_THUMB_DISPLAY_PX = Math.round(
  KIOSK_ACTIVE_LOAN_CARD_THUMB_BASE_PX * KIOSK_ACTIVE_LOAN_CARD_THUMB_SCALE
);

/**
 * カード外寸の固定高さ（px）。
 * グリッド行の縦位置を揃え、サムネ108px + メタ情報 + ボタン行が収まる前提。
 */
export const KIOSK_ACTIVE_LOAN_CARD_FIXED_HEIGHT_PX = 248;

/** ルート `<li>`（固定外寸・縦フレックス・クリップ）。値は {@link KIOSK_ACTIVE_LOAN_CARD_FIXED_HEIGHT_PX} と同期すること。 */
export const kioskActiveLoanCardRootClassName =
  'relative flex flex-col gap-3 overflow-hidden rounded-lg p-3 min-h-[248px] h-[248px]';

/** メイン行（サムネ + 本文）。本文が縦にはみ出さないよう `min-h-0`。 */
export const kioskActiveLoanCardMainRowClassName =
  'relative z-10 flex min-h-0 flex-1 gap-3';

/** サムネ列ラッパー（縮めない）。 */
export const kioskActiveLoanCardThumbWrapClassName = 'flex-shrink-0';

/** サムネ `<img>`（108×108、`object-cover`）。 */
export const kioskActiveLoanCardThumbImgClassName =
  'h-[108px] w-[108px] cursor-pointer rounded border border-white/25 object-cover hover:opacity-80';

/** 本文カラム（末尾揃え・省略の基点）。`text-end` で論理寄せ（RTL でも整合）。 */
export const kioskActiveLoanCardBodyColumnClassName =
  'flex min-h-0 min-w-0 flex-1 flex-col text-end text-white';

/** 単行行の標準（右寄せ省略）。 */
export const kioskActiveLoanCardTruncOneLineClassName = 'truncate';

/** メタ情報行（従業員・設置場所）。 */
export const kioskActiveLoanCardMetaLineClassName = 'mt-1 text-sm text-white/90';

/** ボタン行（現状どおり右寄せ）。 */
export const kioskActiveLoanCardActionsRowClassName =
  'relative z-10 flex w-full shrink-0 flex-row flex-wrap justify-end gap-2';
