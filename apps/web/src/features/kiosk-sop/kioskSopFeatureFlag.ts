/** Draft SOPs are available in DEV or an explicitly enabled release build. */
export const KIOSK_SOP_POPUP_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_KIOSK_SOP_POPUP_ENABLED === 'true';
