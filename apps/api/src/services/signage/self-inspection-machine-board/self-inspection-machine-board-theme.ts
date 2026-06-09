export const SIMB_SIGNAGE_BG = '#020617';
export const SIMB_SIGNAGE_HEADER_BORDER = '#334155';
export const SIMB_SIGNAGE_TEXT_PRIMARY = '#f8fafc';
export const SIMB_SIGNAGE_TEXT_MUTED = '#94a3b8';
export const SIMB_SIGNAGE_TEXT_ACCENT = '#38bdf8';
export const SIMB_SIGNAGE_CARD_BG = '#0f172a';
export const SIMB_SIGNAGE_CARD_BORDER = '#1e293b';
export const SIMB_SIGNAGE_ROW_BORDER = '#1e293b';

export const SIMB_STATUS_NOT_STARTED = '#64748b';
export const SIMB_STATUS_IN_PROGRESS = '#f59e0b';
export const SIMB_STATUS_COMPLETED = '#22c55e';

export const SIMB_HEAT_CENTER = '#22c55e';
export const SIMB_HEAT_EDGE = '#eab308';
export const SIMB_HEAT_OUT = '#ef4444';
export const SIMB_HEAT_MISSING = '#475569';
export const SIMB_HEAT_NEUTRAL = '#64748b';

export const SIMB_HEAT_LEGEND = [
  { label: '中央寄り', color: SIMB_HEAT_CENTER, symbol: '●' },
  { label: '限界寄り', color: SIMB_HEAT_EDGE, symbol: '▲' },
  { label: '未入力', color: SIMB_HEAT_MISSING, symbol: '□' },
  { label: '公差未設定', color: SIMB_HEAT_NEUTRAL, symbol: '—' },
  { label: '公差外', color: SIMB_HEAT_OUT, symbol: '×' },
] as const;
