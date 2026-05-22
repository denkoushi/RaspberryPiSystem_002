import type { Md3Tokens } from '../../renderers/_design-system/md3.js';
import { LOAN_INSPECTION_ACTIVE_BAND_WARNING_MIX } from './card-metrics.js';

export type LoanInspectionCardChrome = {
  hasLoans: boolean;
  cardFill: string;
  cardStroke: string;
  bandFill: string;
  nameFill: string;
  countFill: string;
};

const EMPTY_CARD_BASE = '#020617';

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

export function resolveLoanInspectionCardChrome(t: Md3Tokens, hasLoans: boolean): LoanInspectionCardChrome {
  if (hasLoans) {
    const bandFill = mixHex(
      t.colors.status.warning,
      t.colors.status.infoContainer,
      LOAN_INSPECTION_ACTIVE_BAND_WARNING_MIX,
    );
    return {
      hasLoans: true,
      cardFill: t.colors.status.infoContainer,
      cardStroke: 'transparent',
      bandFill,
      nameFill: t.colors.status.onInfoContainer,
      countFill: t.colors.status.onInfoContainer,
    };
  }
  const bandFill = mixHex(t.colors.text.primary, EMPTY_CARD_BASE, 0.06);
  return {
    hasLoans: false,
    cardFill: EMPTY_CARD_BASE,
    cardStroke: t.colors.card.border,
    bandFill,
    nameFill: t.colors.text.primary,
    countFill: t.colors.text.secondary,
  };
}
