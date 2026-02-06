const DEFAULT_DELIMITERS = /[、,，]/;

export type TextLayoutResult = {
  lines: string[];
  truncated: boolean;
  maxCharsPerLine: number;
};

export type TextLayoutOptions = {
  availableWidthPx: number;
  fontPx: number;
  maxLines: number;
  safetyChars?: number;
  minCharsPerLine?: number;
  maxIterations?: number;
  maxCharsPerLine?: number;
  delimiters?: RegExp;
};

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function estimateMaxCharsPerLine(availableWidthPx: number, fontPx: number): number {
  // SVGのsans-serif前提の近似。安全側に倒したいので係数はやや大きめ。
  const approxCharWidth = Math.max(6, fontPx * 0.6);
  return Math.max(6, Math.floor(availableWidthPx / approxCharWidth));
}

function splitByDelimiters(value: string, delimiters: RegExp): string[] {
  return value
    .split(delimiters)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitLongToken(token: string, maxCharsPerLine: number): string[] {
  if (token.length <= maxCharsPerLine) return [token];
  const parts: string[] = [];
  let rest = token;
  while (rest.length > 0) {
    parts.push(rest.slice(0, maxCharsPerLine));
    rest = rest.slice(maxCharsPerLine);
  }
  return parts;
}

function wrapCommaSeparatedToLines(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
  delimiters: RegExp
): { lines: string[]; truncated: boolean } {
  const normalized = text.trim();
  if (!normalized) return { lines: [''], truncated: false };

  const rawTokens = splitByDelimiters(normalized, delimiters);
  const tokens = rawTokens.flatMap((token) => splitLongToken(token, maxCharsPerLine));

  if (tokens.length <= 1) {
    const raw: string[] = [];
    let rest = normalized;
    while (rest.length > 0) {
      raw.push(rest.slice(0, maxCharsPerLine));
      rest = rest.slice(maxCharsPerLine);
      if (raw.length >= maxLines) break;
    }
    const truncated = rest.length > 0;
    return { lines: raw, truncated };
  }

  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const next = current.length === 0 ? token : `${current}, ${token}`;
    if (next.length <= maxCharsPerLine || current.length === 0) {
      current = next;
      continue;
    }
    lines.push(current);
    current = token;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines) {
    lines.push(current);
  }

  const allJoinedCount = tokens.join(', ').length;
  const usedJoinedCount = lines.join(', ').length;
  const truncated = usedJoinedCount < allJoinedCount;
  return { lines: lines.slice(0, maxLines), truncated };
}

export function layoutTextInBounds(text: string, options: TextLayoutOptions): TextLayoutResult {
  const {
    availableWidthPx,
    fontPx,
    maxLines,
    safetyChars = 0,
    minCharsPerLine = 6,
    maxIterations = 48,
    maxCharsPerLine: maxCharsOverride,
    delimiters = DEFAULT_DELIMITERS,
  } = options;

  const baseMaxChars = maxCharsOverride ?? estimateMaxCharsPerLine(availableWidthPx, fontPx);
  let maxChars = Math.max(minCharsPerLine, baseMaxChars - safetyChars);

  for (let attempt = 0; attempt <= maxIterations; attempt += 1) {
    const wrapped = wrapCommaSeparatedToLines(text, maxChars, maxLines, delimiters);
    if (!wrapped.truncated && wrapped.lines.length <= maxLines) {
      return { lines: wrapped.lines, truncated: false, maxCharsPerLine: maxChars };
    }
    if (maxChars <= minCharsPerLine) break;
    maxChars = Math.max(minCharsPerLine, maxChars - 1);
  }

  const fallback = wrapCommaSeparatedToLines(text, maxChars, maxLines, delimiters);
  const lines = fallback.lines.map((line) => truncateText(line, maxChars));
  return { lines, truncated: fallback.truncated, maxCharsPerLine: maxChars };
}
