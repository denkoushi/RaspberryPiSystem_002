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
  // Cheap approximation good enough for signage labels.
  return Math.round(text.length * fontPx * 0.6);
}

function truncateToChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
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
    return { fill: t.colors.status.successContainer, text: t.colors.status.onSuccessContainer, stroke: t.colors.grid };
  }
  if (tone === 'error') {
    return { fill: t.colors.status.errorContainer, text: t.colors.status.onErrorContainer, stroke: t.colors.grid };
  }
  if (tone === 'info') {
    return { fill: t.colors.status.infoContainer, text: t.colors.status.onInfoContainer, stroke: t.colors.grid };
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
    const approxChars = Math.floor((maxWidth - paddingX * 2) / Math.max(1, Math.round(fontSize * 0.6)));
    displayText = truncateToChars(displayText, approxChars);
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

