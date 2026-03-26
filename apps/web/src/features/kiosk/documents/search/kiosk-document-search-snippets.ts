export type KioskDocumentSearchSnippetSegment = { type: 'text' | 'hit'; value: string };

/** One excerpt around a single match, ready for <mark> rendering */
export type KioskDocumentSearchSnippet = {
  segments: KioskDocumentSearchSnippetSegment[];
};

export type KioskDocumentSearchSnippetModel =
  | { mode: 'hidden' }
  | { mode: 'no_match' }
  | { mode: 'snippets'; items: KioskDocumentSearchSnippet[] };

export type KioskDocumentSearchSnippetVisibleModel = Exclude<
  KioskDocumentSearchSnippetModel,
  { mode: 'hidden' }
>;

export function isKioskDocumentSnippetStripVisible(
  model: KioskDocumentSearchSnippetModel
): model is KioskDocumentSearchSnippetVisibleModel {
  return model.mode !== 'hidden';
}

export type BuildKioskDocumentSearchSnippetOptions = {
  maxSnippets?: number;
  contextLength?: number;
};

const DEFAULT_MAX_SNIPPETS = 3;
const DEFAULT_CONTEXT = 60;

/** Escape user input for use inside a RegExp character class is wrong; escape for whole pattern. */
export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function buildExcerptSegments(
  fullText: string,
  matchStart: number,
  matchEnd: number,
  contextLength: number
): KioskDocumentSearchSnippet {
  const excerptStart = Math.max(0, matchStart - contextLength);
  const excerptEnd = Math.min(fullText.length, matchEnd + contextLength);
  const slice = fullText.slice(excerptStart, excerptEnd);
  const localHitStart = matchStart - excerptStart;
  const localHitEnd = matchEnd - excerptStart;

  const segments: KioskDocumentSearchSnippetSegment[] = [];
  if (excerptStart > 0) {
    segments.push({ type: 'text', value: '…' });
  }
  if (localHitStart > 0) {
    segments.push({ type: 'text', value: slice.slice(0, localHitStart) });
  }
  if (localHitEnd > localHitStart) {
    segments.push({ type: 'hit', value: slice.slice(localHitStart, localHitEnd) });
  }
  if (localHitEnd < slice.length) {
    segments.push({ type: 'text', value: slice.slice(localHitEnd) });
  }
  if (excerptEnd < fullText.length) {
    segments.push({ type: 'text', value: '…' });
  }
  return { segments };
}

/**
 * Build UI model for search-hit excerpts on raw extracted text.
 * Matching: case-insensitive substring search on original string (RegExp `i`), escaped metacharacters.
 */
export function buildKioskDocumentSearchSnippetModel(
  extractedText: string | null | undefined,
  rawQuery: string,
  options?: BuildKioskDocumentSearchSnippetOptions
): KioskDocumentSearchSnippetModel {
  const query = rawQuery.trim();
  if (!query) {
    return { mode: 'hidden' };
  }

  const text = extractedText ?? '';
  if (!text) {
    return { mode: 'no_match' };
  }

  const maxSnippets = options?.maxSnippets ?? DEFAULT_MAX_SNIPPETS;
  const contextLength = options?.contextLength ?? DEFAULT_CONTEXT;

  const re = new RegExp(escapeRegExp(query), 'gi');
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    return { mode: 'no_match' };
  }

  const items: KioskDocumentSearchSnippet[] = [];
  for (let i = 0; i < matches.length && items.length < maxSnippets; i++) {
    const m = matches[i];
    if (m.index === undefined || m[0].length === 0) {
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    items.push(buildExcerptSegments(text, start, end, contextLength));
  }

  return items.length > 0 ? { mode: 'snippets', items } : { mode: 'no_match' };
}
