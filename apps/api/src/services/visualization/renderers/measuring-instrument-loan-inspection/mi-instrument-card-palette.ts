import type { Md3Tokens } from '../_design-system/md3.js';

/**
 * カード1枚分の塗り・線・テキスト色。SVG では CSS color-mix が使えないため、
 * design-preview の T4（warning 22% + infoContainer）等に相当する比で hex 合成。
 */

export type MiCardChrome = {
  hasLoans: boolean;
  cardFill: string;
  cardStroke: string;
  /** 帯専用。貸出あり: T4（warning を info 地に 22%）/ 貸出なし: #020617 に primary を薄く混ぜる */
  bandFill: string;
  nameFill: string;
  countFill: string;
};

const MI_EMPTY_CARD_BASE = '#020617';

function parseHex3Byte(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return [0, 0, 0];
  }
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, ratioA: number): string {
  const [ar, ag, ab] = parseHex3Byte(a);
  const [br, bg, bb] = parseHex3Byte(b);
  const r = Math.round(ar * ratioA + br * (1 - ratioA));
  const g = Math.round(ag * ratioA + bg * (1 - ratioA));
  const b2 = Math.round(ab * ratioA + bb * (1 - ratioA));
  return `#${[r, g, b2].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param hasLoans 貸出中・返却のいずれかが 1 件以上
 */
export function resolveMiCardChrome(t: Md3Tokens, hasLoans: boolean): MiCardChrome {
  if (hasLoans) {
    // design-preview T4: color-mix(in srgb, status-warning 22%, status-info-container)
    const bandFill = mixHex(t.colors.status.warning, t.colors.status.infoContainer, 0.22);
    return {
      hasLoans: true,
      cardFill: t.colors.status.infoContainer,
      cardStroke: 'transparent',
      bandFill,
      nameFill: t.colors.status.onInfoContainer,
      countFill: t.colors.status.onInfoContainer,
    };
  }
  // HTML: color-mix(in srgb, text-primary 6%, #020617)
  const bandFill = mixHex(t.colors.text.primary, MI_EMPTY_CARD_BASE, 0.06);
  return {
    hasLoans: false,
    cardFill: MI_EMPTY_CARD_BASE,
    cardStroke: t.colors.card.border,
    bandFill,
    nameFill: t.colors.text.primary,
    countFill: t.colors.text.secondary,
  };
}
