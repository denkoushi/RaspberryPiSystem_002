/**
 * 貸出カードの枠色（工具 / 計測 / 吊具 / 期限超過）。
 * HTML・将来の別レンダラで再利用可能な薄い境界（単一責任）。
 */
export type LoanCardChrome = {
  background: string;
  borderColor: string;
  borderWidth: string;
};

export type LoanCardChromeInput = {
  isInstrument: boolean;
  isRigging: boolean;
  isExceeded: boolean;
};

export function resolveLoanCardChrome(view: LoanCardChromeInput): LoanCardChrome {
  let bg: string;
  let borderNormal: string;
  if (view.isInstrument) {
    bg = 'rgb(147,51,234)';
    borderNormal = 'rgb(107,33,168)';
  } else if (view.isRigging) {
    bg = 'rgb(249,115,22)';
    borderNormal = 'rgb(194,65,12)';
  } else {
    bg = 'rgb(59,130,246)';
    borderNormal = 'rgb(29,78,216)';
  }
  const borderColor = view.isExceeded ? 'rgb(220,38,38)' : borderNormal;
  const borderWidth = view.isExceeded ? '4px' : '2px';
  return { background: bg, borderColor, borderWidth };
}
