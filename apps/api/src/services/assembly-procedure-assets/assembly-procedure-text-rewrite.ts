import { projectOverlayBBoxToCrop } from '@raspi-system/shared-types';

import type { ImageRegionPixelRoi, ImageRegionRoi } from '../image-region/image-region-roi.js';
import type { TextCandidate } from '../image-region/text-candidate.port.js';

type Box = ImageRegionRoi;
type Word = { text: string; bounds: Box };

function right(box: Box): number { return box.xRatio + box.widthRatio; }
function bottom(box: Box): number { return box.yRatio + box.heightRatio; }
function centerY(box: Box): number { return box.yRatio + box.heightRatio / 2; }

const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

/**
 * OCR splits Japanese into words; rejoin them without spaces. Keep spaces between
 * Latin words, and between scripts only where the page shows a visible gap.
 */
export function joinWords(words: { text: string; gap?: number }[]): string {
  return words.reduce((joined, { text, gap = 0 }) => {
    if (!joined) return text;
    const leftCjk = CJK.test(joined.at(-1) ?? '');
    const rightCjk = CJK.test(text[0] ?? '');
    const spaced = !leftCjk && !rightCjk ? true : leftCjk && rightCjk ? false : gap > 0.6;
    return joined + (spaced ? ' ' : '') + text;
  }, '');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function unionBoxes(left: Box, rightBox: Box): Box {
  const xRatio = Math.min(left.xRatio, rightBox.xRatio);
  const yRatio = Math.min(left.yRatio, rightBox.yRatio);
  return {
    xRatio, yRatio,
    widthRatio: Math.max(right(left), right(rightBox)) - xRatio,
    heightRatio: Math.max(bottom(left), bottom(rightBox)) - yRatio
  };
}

export function padPixels(box: ImageRegionPixelRoi, margin: number, width: number, height: number): ImageRegionPixelRoi {
  const left = Math.max(0, box.left - margin);
  const top = Math.max(0, box.top - margin);
  return {
    left, top,
    width: Math.min(width, box.left + box.width + margin) - left,
    height: Math.min(height, box.top + box.height + margin) - top
  };
}

export function pixelsToBox(box: ImageRegionPixelRoi, width: number, height: number): Box {
  const xRatio = box.left / width;
  const yRatio = box.top / height;
  return {
    xRatio, yRatio,
    widthRatio: (box.left + box.width) / width - xRatio,
    heightRatio: (box.top + box.height) / height - yRatio
  };
}

export function selectRewriteText(candidates: TextCandidate[], selection: Box, width: number, height: number) {
  const words = candidates.flatMap(({ text, bounds }) => {
    if (!bounds || !text.trim()) return [];
    const clamped = projectOverlayBBoxToCrop(bounds, { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 });
    return clamped ? [{ text, bounds: clamped }] : [];
  }).sort((a, b) => centerY(a.bounds) - centerY(b.bounds));

  // Join neighboring OCR/PDF words before testing the selection so a drag
  // across part of a line recovers the rest of it. Keep distant columns separate.
  const lines: { anchor: Box; words: Word[] }[] = [];
  for (const word of words) {
    const line = lines.find(({ anchor }) =>
      Math.abs(centerY(anchor) - centerY(word.bounds)) <= Math.min(anchor.heightRatio, word.bounds.heightRatio) / 2);
    if (line) line.words.push(word);
    else lines.push({ anchor: word.bounds, words: [word] });
  }

  const selected = lines.flatMap(({ words: lineWords }) => {
    const segments: { bounds: Box; words: Word[] }[] = [];
    for (const word of lineWords.sort((a, b) => a.bounds.xRatio - b.bounds.xRatio)) {
      const segment = segments.at(-1);
      if (segment && word.bounds.xRatio - right(segment.bounds) <= 2 * word.bounds.heightRatio * height / width) {
        segment.bounds = unionBoxes(segment.bounds, word.bounds);
        segment.words.push(word);
      } else {
        segments.push({ bounds: word.bounds, words: [word] });
      }
    }
    const matching = segments.filter(({ bounds }) => projectOverlayBBoxToCrop(bounds, selection) !== null);
    if (!matching.length) return [];
    return [{
      bounds: matching.map(({ bounds }) => bounds),
      text: joinWords(matching.flatMap((segment) => segment.words).map(({ text, bounds }, index, all) => ({
        text: text.trim(),
        // Gap to the previous word, in text heights.
        gap: index ? (bounds.xRatio - right(all[index - 1].bounds)) * width / (bounds.heightRatio * height) : 0
      }))),
      wordHeights: matching.flatMap((segment) => segment.words.map(({ bounds }) => bounds.heightRatio))
    }];
  });
  if (!selected.length) return null;

  const bounds = selected.flatMap((line) => line.bounds);
  return {
    bounds,
    textBBox: bounds.reduce(unionBoxes),
    text: selected.map((line) => line.text).join('\n'),
    // A line's union box grows with ascenders/descenders and slight skew, so size from the words.
    fontSizeRatio: median(selected.flatMap((line) => line.wordHeights))
  };
}
