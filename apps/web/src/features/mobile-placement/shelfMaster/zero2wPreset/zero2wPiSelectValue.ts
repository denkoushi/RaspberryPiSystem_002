/** ドロップダウン: 変更しない（既存棚の現状維持） */
export const ZERO2W_PI_UNCHANGED = '';

/** ドロップダウン: 担当棚を解除 */
export const ZERO2W_PI_CLEAR = '__clear__';

export type Zero2wPiSelectValue = typeof ZERO2W_PI_UNCHANGED | typeof ZERO2W_PI_CLEAR | string;
