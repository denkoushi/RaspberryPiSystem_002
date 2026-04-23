import { useCallback, useEffect, useState } from 'react';

import { pushPalletTenkeyDigit } from './pushPalletTenkeyDigit';

export type UseKioskMobilePalletDigitBufferOptions = {
  /** 加工機 CD など。変わったらバッファをクリアする */
  resetKey: string;
};

/**
 * 配膳スマホパレット画面のテンキー桁バッファ（最大2桁・3キー目で置換は pushPalletTenkeyDigit）。
 */
export function useKioskMobilePalletDigitBuffer({ resetKey }: UseKioskMobilePalletDigitBufferOptions) {
  const [digits, setDigits] = useState<number[]>([]);

  useEffect(() => {
    setDigits([]);
  }, [resetKey]);

  const appendDigit = useCallback((d: number) => {
    setDigits((prev) => pushPalletTenkeyDigit(prev, d));
  }, []);

  const backspace = useCallback(() => {
    setDigits((p) => p.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setDigits([]);
  }, []);

  const reset = useCallback(() => {
    setDigits([]);
  }, []);

  return { digits, appendDigit, backspace, clear, reset };
}
