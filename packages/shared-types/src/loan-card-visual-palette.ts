/**
 * 貸出カードの視覚トークン（工具 / 計測 / 吊具 / 期限超過）。
 * API（Playwright HTML）とキオスク（React インラインスタイル）の共通正本。
 */

export type LoanCardKind = 'tool' | 'instrument' | 'rigging';

export type LoanCardChromeInput = {
  isInstrument: boolean;
  isRigging: boolean;
  isExceeded: boolean;
};

export type LoanCardChrome = {
  background: string;
  borderColor: string;
  borderWidth: string;
};

/** Playwright 用カード外皮（グラデーション + 光彩 + 境界） */
export type LoanCardHtmlAppearance = {
  background: string;
  boxShadow: string;
  borderWidth: string;
  borderColor: string;
  /** 左上ハイライト（絶対配置レイヤー用） */
  sheenBackground: string;
  /** SVG ノイズオーバーレイの不透明度 */
  noiseOpacity: number;
};

/** キオスク持出一覧カードの種別（`presentActiveLoanListLines` と対応） */
export type KioskActiveLoanCardKind = 'instrument' | 'rigging' | 'item';

export type KioskLoanCardSurfaceTokens = {
  /** カードルート（例: `<li style={...}>`） */
  root: {
    background: string;
    boxShadow: string;
    borderWidth: string;
    borderStyle: 'solid';
    borderColor: string;
    color: string;
  };
  sheen: {
    background: string;
  };
};

type KindPalette = {
  flatBackground: string;
  flatBorder: string;
  htmlBackground: string;
  /** box-shadow 用 RGB 成分（カンマ区切り） */
  shadowTintRgb: string;
};

const PALETTE: Record<LoanCardKind, KindPalette> = {
  tool: {
    flatBackground: 'rgb(59,130,246)',
    flatBorder: 'rgb(29,78,216)',
    htmlBackground: 'linear-gradient(145deg, #1a6bff, #0a3d8f)',
    shadowTintRgb: '26,107,255',
  },
  instrument: {
    flatBackground: 'rgb(147,51,234)',
    flatBorder: 'rgb(107,33,168)',
    htmlBackground: 'linear-gradient(145deg, #8b5cf6, #5b21b6)',
    shadowTintRgb: '139,92,246',
  },
  rigging: {
    flatBackground: 'rgb(249,115,22)',
    flatBorder: 'rgb(194,65,12)',
    htmlBackground: 'linear-gradient(145deg, #f97316, #b45309)',
    shadowTintRgb: '249,115,22',
  },
};

export function loanCardKindFromFlags(input: { isInstrument: boolean; isRigging: boolean }): LoanCardKind {
  if (input.isInstrument) {
    return 'instrument';
  }
  if (input.isRigging) {
    return 'rigging';
  }
  return 'tool';
}

export function kioskActiveLoanKindToChromeInput(
  kind: KioskActiveLoanCardKind,
  isOverdue: boolean
): LoanCardChromeInput {
  return {
    isInstrument: kind === 'instrument',
    isRigging: kind === 'rigging',
    isExceeded: isOverdue,
  };
}

/**
 * 単色フィル（従来 HTML/SVG 概念と同一の「カテゴリ色」）。
 * Playwright 本体カードでは resolveLoanCardHtmlAppearance を優先する。
 */
export function resolveLoanCardChrome(view: LoanCardChromeInput): LoanCardChrome {
  const pKind = loanCardKindFromFlags(view);
  const p = PALETTE[pKind];
  const borderColor = view.isExceeded ? 'rgb(220,38,38)' : p.flatBorder;
  const borderWidth = view.isExceeded ? '4px' : '2px';
  return { background: p.flatBackground, borderColor, borderWidth };
}

/** Playwright HTML カードのモダン外皮（デザインプレビュー準拠） */
export function resolveLoanCardHtmlAppearance(view: LoanCardChromeInput): LoanCardHtmlAppearance {
  const pKind = loanCardKindFromFlags(view);
  const p = PALETTE[pKind];
  const baseShadow = '0 2px 6px rgba(0,0,0,0.25)';
  const categoryGlow = `0 12px 40px rgba(${p.shadowTintRgb},0.18)`;
  const insetNormal = 'inset 0 1px 0 rgba(255,255,255,0.15)';
  const exceededGlow = '0 12px 40px rgba(239,68,68,0.22)';
  const insetExceeded = 'inset 0 1px 0 rgba(255,255,255,0.12)';

  return {
    background: p.htmlBackground,
    boxShadow: view.isExceeded
      ? `${baseShadow}, ${exceededGlow}, ${insetExceeded}`
      : `${baseShadow}, ${categoryGlow}, ${insetNormal}`,
    borderWidth: view.isExceeded ? '2.5px' : '1.5px',
    borderColor: view.isExceeded ? '#ef4444' : 'rgba(255,255,255,0.18)',
    sheenBackground: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.14), transparent 55%)',
    noiseOpacity: 0.04,
  };
}

/**
 * キオスク `KioskActiveLoanCard` 用。Playwright HTML と同じ resolveLoanCardHtmlAppearance に基づく。
 * （blur / backdrop-filter なし — Pi4 向けに軽量）
 */
export function resolveKioskLoanCardSurfaceTokens(
  kind: KioskActiveLoanCardKind,
  isOverdue: boolean
): KioskLoanCardSurfaceTokens {
  const appearance = resolveLoanCardHtmlAppearance(kioskActiveLoanKindToChromeInput(kind, isOverdue));
  return {
    root: {
      background: appearance.background,
      boxShadow: appearance.boxShadow,
      borderWidth: appearance.borderWidth,
      borderStyle: 'solid',
      borderColor: appearance.borderColor,
      color: '#ffffff',
    },
    sheen: {
      background: appearance.sheenBackground,
    },
  };
}
