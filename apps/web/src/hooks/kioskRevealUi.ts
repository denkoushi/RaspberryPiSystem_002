/**
 * キオスク沉浸式クローム（上端ヘッダー・順位ボード左ドロワー等）の開閉アニメと、
 * `useTimedHoverReveal` 系の遅延クローズを一元化する。
 * Tailwind のクラス名は静的リテラルのみ（パージ対象に含める）。
 */

/** translate スライド用（transition + duration + easing） */
export const KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS =
  'transition-transform duration-100 ease-out';

/** ホットゾーン／パネル leave 後、折りたたむまでの待ち（キオスク内ホバー開閉と共通） */
export const KIOSK_REVEAL_CLOSE_DELAY_MS = 200;
