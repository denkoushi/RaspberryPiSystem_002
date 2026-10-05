import type { CSSProperties } from 'react';

/** 承認済み action-first モックの色・角丸。 */
export const KIOSK_ANALYTICS_THEME = {
  background: '#0a101c',
  surface: '#121a2a',
  surface2: '#18233a',
  line: 'rgba(160,180,220,.14)',
  rowLine: 'rgba(160,180,220,.07)',
  text: '#f4f6fb',
  muted: '#9aa8c0',
  faint: '#63718c',
  borrow: '#f9853a',
  borrowBg: 'rgba(249,133,58,.12)',
  borrowPillBg: 'rgba(249,133,58,.14)',
  return: '#19b98a',
  returnBg: 'rgba(25,185,138,.12)',
  returnPillBg: 'rgba(25,185,138,.14)',
  alert: '#ff5d55',
  alertBg: 'rgba(255,93,85,.12)',
  alertLine: 'rgba(255,93,85,.45)',
  panelRadius: '12px',
  controlRadius: '10px',
  buttonRadius: '7px',
  pillRadius: '6px',
  trackRadius: '4px',
  barRadius: '3px 3px 0 0',
  legendRadius: '2px',
  roundRadius: '999px'
} as const;

export const kioskAnalyticsThemeStyle = Object.fromEntries(
  Object.entries(KIOSK_ANALYTICS_THEME).map(([key, value]) => [`--ka-${key}`, value])
) as CSSProperties;
