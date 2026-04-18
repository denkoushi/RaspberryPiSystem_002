/**
 * Tailwind クラス断片: モバイル/キオスクで `vh` が実表示とズレるのを避けるため `dvh` を使う。
 */
export const VIEWPORT_MIN_HEIGHT_FULL = 'min-h-dvh' as const;

export const VIEWPORT_HEIGHT_FULL = 'h-dvh' as const;

/** `100vw` 由来の横はみ出しを抑える（親幅に合わせ、flex 子の min-width 縮小を許可） */
export const VIEWPORT_WIDTH_SAFE = 'w-full min-w-0' as const;

export const DIALOG_MAX_HEIGHT = 'max-h-[calc(100dvh-2rem)]' as const;
