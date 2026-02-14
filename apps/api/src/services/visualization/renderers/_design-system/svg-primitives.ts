import type { Md3Tokens } from './md3.js';

export function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estimateTextWidth(text: string, fontPx: number): number {
  // Approximation tuned for mixed JP/ASCII text:
  // - ASCII-ish (<= 0xFF): 0.6em
  // - Wide chars (JP/CJK/emoji etc): 1.0em
  // This avoids under-estimating JP strings and prevents right-edge clipping.
  let usedEm = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    usedEm += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return Math.round(usedEm * fontPx);
}

export type ChipTone = 'success' | 'error' | 'info' | 'neutral';

export function resolveChipToneFromInspectionResult(value: string): ChipTone {
  if (value === '未使用') return 'neutral';
  const abnormalMatch = value.match(/異常\s*(\d+)/);
  const abnormalCount = abnormalMatch ? Number(abnormalMatch[1]) : 0;
  return abnormalCount >= 1 ? 'error' : 'info';
}

export function resolveChipColors(t: Md3Tokens, tone: ChipTone): { fill: string; text: string; stroke: string } {
  if (tone === 'success') {
    // Use strong fills so chips don't get buried on dark backgrounds.
    return { fill: t.colors.status.success, text: t.colors.text.onColor, stroke: t.colors.outline };
  }
  if (tone === 'error') {
    return { fill: t.colors.status.error, text: t.colors.text.onColor, stroke: t.colors.outline };
  }
  if (tone === 'info') {
    return { fill: t.colors.status.info, text: t.colors.text.onColor, stroke: t.colors.outline };
  }
  return { fill: t.colors.surface.containerHigh, text: t.colors.text.primary, stroke: t.colors.grid };
}

export function renderChip(options: {
  x: number;
  y: number;
  maxWidth: number;
  text: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  paddingX: number;
  paddingY: number;
  radius: number;
  fill: string;
  textColor: string;
  stroke?: string;
  strokeWidth?: number;
}): { svg: string; width: number; height: number; displayText: string } {
  const paddingX = Math.max(0, Math.round(options.paddingX));
  const paddingY = Math.max(0, Math.round(options.paddingY));
  const fontSize = Math.max(1, Math.round(options.fontSize));
  const chipHeight = Math.max(1, fontSize + paddingY * 2);
  const maxWidth = Math.max(1, Math.round(options.maxWidth));

  let displayText = options.text;
  let width = estimateTextWidth(displayText, fontSize) + paddingX * 2;
  if (width > maxWidth) {
    // Recompute truncation budget using the same em approximation.
    const maxEm = (maxWidth - paddingX * 2) / Math.max(1, fontSize);
    let usedEm = 0;
    let out = '';
    for (const ch of options.text) {
      const code = ch.codePointAt(0);
      const em = code != null && code <= 0xff ? 0.6 : 1.0;
      if (usedEm + em > maxEm) break;
      usedEm += em;
      out += ch;
    }
    displayText = out.length > 0 ? `${out}...` : '...';
    width = Math.min(maxWidth, estimateTextWidth(displayText, fontSize) + paddingX * 2);
  }

  const rect = `<rect x="${options.x}" y="${options.y}" width="${width}" height="${chipHeight}" rx="${options.radius}" ry="${options.radius}" fill="${options.fill}"${
    options.stroke ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth ?? 1}"` : ''
  } />`;

  const textX = options.x + paddingX;
  const textY = options.y + Math.round(chipHeight / 2);
  const text = `<text x="${textX}" y="${textY}" dominant-baseline="middle" font-size="${fontSize}" font-weight="${options.fontWeight}" fill="${options.textColor}" font-family="${options.fontFamily}">${escapeSvgText(displayText)}</text>`;

  return { svg: `<g>${rect}${text}</g>`, width, height: chipHeight, displayText };
}

