import { describe, expect, it } from 'vitest';

import { joinWords, selectRewriteText } from '../assembly-procedure-text-rewrite.js';

const word = (text: string, xRatio: number, yRatio: number, widthRatio: number, heightRatio: number) =>
  ({ text, bounds: { xRatio, yRatio, widthRatio, heightRatio } });

describe('joinWords', () => {
  it('joins Japanese OCR words without spaces and keeps spaces between Latin words', () => {
    const plain = (texts: string[]) => texts.map((text) => ({ text }));
    expect(joinWords(plain(['ボル', 'ト', 'を', '確認', 'し', 'て']))).toBe('ボルトを確認して');
    expect(joinWords(plain(['Check', 'the', 'bolt']))).toBe('Check the bolt');
    expect(joinWords(plain(['M8', 'ボルト']))).toBe('M8ボルト');
    expect(joinWords([{ text: '番号' }, { text: 'A-1024', gap: 1.6 }, { text: 'を', gap: 0.87 }])).toBe('番号 A-1024 を');
  });
});

describe('selectRewriteText', () => {
  it('rebuilds a Japanese line without spaces and sizes the font from word heights', () => {
    const candidates = [
      word('ボル', 0.1, 0.1, 0.05, 0.05),
      word('ト', 0.151, 0.105, 0.02, 0.04),
      word('を', 0.172, 0.11, 0.02, 0.04),
      word('確認', 0.193, 0.1, 0.05, 0.06)
    ];
    const result = selectRewriteText(candidates, { xRatio: 0.19, yRatio: 0.1, widthRatio: 0.05, heightRatio: 0.06 }, 1000, 1000);
    expect(result?.text).toBe('ボルトを確認');
    // Word heights 0.04, 0.04, 0.05, 0.06 -> median 0.045; the line union would be 0.06.
    expect(result?.fontSizeRatio).toBeCloseTo(0.045);
  });

  it('keeps a mixed Japanese and Latin line together across an OCR gap of about 1.6 text heights', () => {
    // Pixel boxes from tesseract on a 1600px-wide page: 号 ends at 440, A-1024 starts at 529, height ~55.
    const px = (text: string, x0: number, x1: number) => word(text, x0 / 1600, 0.8, (x1 - x0) / 1600, 55 / 1100);
    const candidates = [px('部', 163, 254), px('品番', 283, 387), px('号', 387, 440), px('A-1024', 529, 643), px('を', 691, 717)];
    const result = selectRewriteText(candidates, { xRatio: 600 / 1600, yRatio: 0.8, widthRatio: 0.02, heightRatio: 0.05 }, 1600, 1100);
    expect(result?.text).toBe('部品番号 A-1024 を');
  });
});
