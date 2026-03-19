export const KIOSK_TARGET_LOCATION_STORAGE_KEY = 'due-management-target-location';

export const DEFAULT_KIOSK_TARGET_LOCATIONS = ['第2工場', 'トークプラザ', '第1工場'] as const;

export type KioskTargetLocation = (typeof DEFAULT_KIOSK_TARGET_LOCATIONS)[number];
