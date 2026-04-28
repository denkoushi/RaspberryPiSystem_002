import type { Md3Tokens } from '../_design-system/md3.js';

/** サイネJPEGパレットボードグリッド列数（画面幅とは独立に固定運用／将来 RenderConfig で上書え可能な余地） */
export const PALLET_SIGNAGE_GRID_COLS = 4;

export const palletBoardSignageColor = {
  surfaceBackground: '#0a0f14',
  sidebarFill: '#0d1319',
  sidebarOutline: 'rgba(38, 166, 154, 0.18)',
  cardOccupiedFill: '#0f171f',
  cardEmptyFill: '#0a1118',
  activeStroke: '#26a69a',
  activeGlow: 'rgba(38, 166, 154, 0.45)',
  palletNumberBright: '#40e8d9',
  palletNumberMuted: 'rgba(142, 160, 178, 0.75)',
  badgeFill: 'rgba(255, 143, 74, 0.14)',
  badgeStroke: 'rgba(255, 143, 74, 0.45)',
  badgeText: 'rgba(255, 143, 74, 0.92)',
  metaCyan: '#5dd5f5',
  /** メタ行の製番・個数などプレーンテキスト（ティール系） */
  metaPlainTeal: 'rgba(134, 200, 200, 0.88)',
  /** メタ区切り "|" を弱める */
  metaSeparatorMuted: 'rgba(134, 200, 200, 0.45)',
  emptyDashBorder: 'rgba(120, 130, 145, 0.35)',
} as const;

/**
 * Material3 基底トークンの上に、パレット可視化サイネ用の色差し替えを重ねる（既存 Renderer とは疎結合）。
 */
export function mergeMd3TokensForPalletBoardSignage(base: Md3Tokens): Md3Tokens {
  return {
    ...base,
    colors: {
      ...base.colors,
      surface: {
        ...base.colors.surface,
        background: palletBoardSignageColor.surfaceBackground,
        containerHigh: palletBoardSignageColor.cardOccupiedFill,
        container: palletBoardSignageColor.sidebarFill,
      },
      outline: palletBoardSignageColor.emptyDashBorder,
      grid: 'rgba(255,255,255,0.08)',
      status: {
        ...base.colors.status,
        success: palletBoardSignageColor.activeStroke,
        info: palletBoardSignageColor.metaCyan,
      },
      text: {
        ...base.colors.text,
        primary: '#e8eef4',
        secondary: '#8ea0b2',
      },
      card: {
        ...base.colors.card,
        border: palletBoardSignageColor.emptyDashBorder,
      },
      table: { ...base.colors.table },
    },
  };
}
