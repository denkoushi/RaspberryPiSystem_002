import { partSearchHitIdentity } from './partSearchIdentity';
import { PartSearchResultCard } from './PartSearchResultCard';

import type { PartPlacementSearchHitDto } from './types';
import type { UseQueryResult } from '@tanstack/react-query';

export type PartSearchSuggestQuery = Pick<
  UseQueryResult<unknown, Error>,
  'isLoading' | 'isError'
>;

type PartSearchResultsSectionProps = {
  normalizedPartQuery: string;
  suggestQuery: PartSearchSuggestQuery;
  showEmpty: boolean;
  visibleHits: PartPlacementSearchHitDto[];
  selected: PartPlacementSearchHitDto | null;
  onSelectHit: (hit: PartPlacementSearchHitDto) => void;
};

/**
 * 検索ステータス・空結果・ヒット一覧・選択詳細。データ取得は親のフックに委ねる。
 */
export function PartSearchResultsSection(props: PartSearchResultsSectionProps) {
  const { normalizedPartQuery, suggestQuery, showEmpty, visibleHits, selected, onSelectHit } = props;

  return (
    <section aria-live="polite" className="space-y-2">
      {normalizedPartQuery.length > 0 ? (
        <div className="text-xs text-slate-200">
          {suggestQuery.isLoading ? '検索中…' : suggestQuery.isError ? '検索に失敗しました。通信を確認してください。' : null}
        </div>
      ) : null}

      {showEmpty ? <p className="text-sm text-slate-100">該当なし</p> : null}

      <ul className="flex flex-col gap-2">
        {visibleHits.map((hit) => (
          <li key={partSearchHitIdentity(hit)}>
            <PartSearchResultCard
              hit={hit}
              selected={selected != null && partSearchHitIdentity(selected) === partSearchHitIdentity(hit)}
              onSelect={() => onSelectHit(hit)}
            />
          </li>
        ))}
      </ul>

      {selected ? (
        <aside className="rounded-xl border border-sky-500/30 bg-slate-900/60 p-3">
          <PartSearchResultCard hit={selected} />
        </aside>
      ) : null}
    </section>
  );
}
