const DEFAULT_MAX_LEN = 120;
const KEYWORD_SNIPPET = /(?:目的|範囲|適用|概要|はじめに)[：:\s]*([^\n]{10,400})/;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clip(s: string, maxLen: number): string {
  const t = collapseWhitespace(s);
  if (t.length <= maxLen) {
    return t;
  }
  return `${t.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function firstParagraph(text: string): string | undefined {
  const chunk = text.split(/\n\s*\n/)[0]?.trim();
  if (!chunk) {
    return undefined;
  }
  return chunk;
}

function midSnippet(text: string, maxLen: number): string | undefined {
  const t = collapseWhitespace(text);
  if (t.length < 40) {
    return undefined;
  }
  const start = Math.floor(t.length * 0.25);
  return clip(t.slice(start), maxLen);
}

function distinctEnough(a: string, b: string): boolean {
  const short = a.length < 12 || b.length < 12;
  if (short) {
    return a !== b;
  }
  const prefix = Math.min(20, a.length, b.length);
  return a.slice(0, prefix) !== b.slice(0, prefix);
}

/**
 * 正規化済み本文から要約候補を最大3件生成（機械的・意味理解なし）
 */
export function buildSummaryCandidates(text: string, maxLen = DEFAULT_MAX_LEN): [string?, string?, string?] {
  const t = text.trim();
  if (!t) {
    return [undefined, undefined, undefined];
  }

  const out: string[] = [];

  const para = firstParagraph(t);
  if (para) {
    out.push(clip(para, maxLen));
  }

  const kw = t.match(KEYWORD_SNIPPET);
  if (kw?.[1]) {
    const snippet = clip(kw[1], maxLen);
    if (!out.length || distinctEnough(out[0], snippet)) {
      out.push(snippet);
    }
  }

  const mid = midSnippet(t, maxLen);
  if (mid) {
    const dup = out.some((x) => !distinctEnough(x, mid));
    if (!dup) {
      out.push(mid);
    }
  }

  if (!out.length) {
    out.push(clip(t, maxLen));
  }

  while (out.length < 3) {
    const tailStart = Math.min(t.length, Math.floor(t.length * 0.55));
    const tail = clip(t.slice(tailStart), maxLen);
    if (tail && !out.some((x) => !distinctEnough(x, tail))) {
      out.push(tail);
      break;
    }
    break;
  }

  return [out[0], out[1], out[2]];
}
