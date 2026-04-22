/**
 * 計測機器名称一覧（カンマ区切り）の幅見積・折り返し。レンダラーとレイアウト計算の共有用。
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  let usedEm = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    usedEm += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return Math.round(usedEm * fontPx);
}

export function truncateWithEllipsis(text: string, maxWidthPx: number, fontPx: number): string {
  if (!text) return '-';
  if (estimateTextWidth(text, fontPx) <= maxWidthPx) return text;
  const ellipsis = '...';
  let out = '';
  for (const ch of text) {
    const next = out + ch;
    if (estimateTextWidth(next + ellipsis, fontPx) > maxWidthPx) {
      break;
    }
    out = next;
  }
  return out ? `${out}${ellipsis}` : ellipsis;
}

export function layoutInstrumentNameLines(params: {
  namesText: string;
  maxWidthPx: number;
  fontPx: number;
  maxLines: number;
}): string[] {
  const { namesText, maxWidthPx, fontPx, maxLines } = params;
  if (maxLines <= 0) {
    return [];
  }
  if (!namesText.trim()) {
    return ['-'];
  }

  const tokens = namesText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return ['-'];
  }

  const lines: string[] = [];
  let current = '';
  let consumedAll = true;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const candidate = current ? `${current}, ${token}` : token;
    if (estimateTextWidth(candidate, fontPx) <= maxWidthPx) {
      current = candidate;
      continue;
    }

    if (!current) {
      current = truncateWithEllipsis(token, maxWidthPx, fontPx);
      lines.push(current);
      current = '';
      if (lines.length >= maxLines) {
        consumedAll = i >= tokens.length - 1;
        break;
      }
      continue;
    }

    lines.push(current);
    current = token;
    if (lines.length >= maxLines) {
      consumedAll = false;
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(truncateWithEllipsis(current, maxWidthPx, fontPx));
  } else if (current && lines.length >= maxLines) {
    consumedAll = false;
  }

  if (!consumedAll && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = truncateWithEllipsis(last, maxWidthPx, fontPx);
    if (!lines[lines.length - 1]!.endsWith('...')) {
      lines[lines.length - 1] = truncateWithEllipsis(`${lines[lines.length - 1]!} ...`, maxWidthPx, fontPx);
    }
  }

  return lines;
}
