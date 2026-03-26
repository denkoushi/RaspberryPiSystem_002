import type { KioskDocumentSearchSnippetVisibleModel } from './search/kiosk-document-search-snippets';

export type KioskDocumentSearchSnippetStripProps = {
  model: KioskDocumentSearchSnippetVisibleModel;
};

/**
 * Renders search-hit excerpts with <mark> for hits. No search logic (presentational only).
 */
export function KioskDocumentSearchSnippetStrip({ model }: KioskDocumentSearchSnippetStripProps) {
  if (model.mode === 'no_match') {
    return (
      <p className="m-0 text-xs leading-snug text-white/50" role="status">
        一致する箇所は見つかりませんでした
      </p>
    );
  }

  return (
    <ul className="m-0 list-none space-y-1.5 p-0" aria-label="検索ヒット抜粋">
      {model.items.map((item, idx) => (
        <li key={idx} className="text-xs leading-snug text-white/75">
          {item.segments.map((seg, j) =>
            seg.type === 'hit' ? (
              <mark
                key={j}
                className="rounded-sm bg-amber-400/35 px-0.5 text-white"
              >
                {seg.value}
              </mark>
            ) : (
              <span key={j} className="whitespace-pre-wrap break-words">
                {seg.value}
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
