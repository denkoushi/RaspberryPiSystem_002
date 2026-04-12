import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getMobilePlacementPartSearchSuggest } from '../../api/client';
import { PartSearchCharPalette } from '../../features/mobile-placement/part-search/PartSearchCharPalette';
import { partSearchHitIdentity } from '../../features/mobile-placement/part-search/partSearchIdentity';
import { PartSearchResultCard } from '../../features/mobile-placement/part-search/PartSearchResultCard';

import type { PartPlacementSearchHitDto } from '../../features/mobile-placement/part-search/types';

const DEBOUNCE_MS = 320;

export function MobilePlacementPartSearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState<PartPlacementSearchHitDto | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q]);

  const suggestQuery = useQuery({
    queryKey: ['mobile-placement-part-search', debouncedQ],
    queryFn: () => getMobilePlacementPartSearchSuggest(debouncedQ),
    enabled: debouncedQ.length > 0
  });

  const allHits = useMemo(() => {
    const data = suggestQuery.data;
    if (!data) return [];
    return [...data.currentPlacements, ...data.scheduleCandidates];
  }, [suggestQuery.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4 pt-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-white">部品名で棚を探す</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            現在棚を最優先表示。棚未登録の部品はスケジュールから補助候補を出します。
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-sm text-white active:bg-slate-700"
          onClick={() => navigate('/kiosk/mobile-placement')}
        >
          戻る
        </button>
      </div>

      <label className="block text-xs font-medium text-slate-300">
        検索（入力または下のキーから）
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(null);
          }}
          placeholder="例: 脚 / アシ / FHINCD"
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-3 text-base text-white placeholder:text-slate-500"
          inputMode="search"
          autoComplete="off"
        />
      </label>

      <div className="max-h-[min(52vh,420px)] overflow-y-auto rounded-xl border border-white/10 bg-slate-900/30 p-2">
        <PartSearchCharPalette
          onAppend={(s) => {
            setQ((prev) => prev + s);
            setSelected(null);
          }}
          onBackspace={() => {
            setQ((prev) => prev.slice(0, -1));
            setSelected(null);
          }}
        />
      </div>

      <section aria-live="polite" className="space-y-2">
        <div className="text-xs text-slate-400">
          {debouncedQ.length === 0
            ? '検索語を入力してください（1文字以上）。'
            : suggestQuery.isLoading
              ? '検索中…'
              : suggestQuery.isError
                ? '検索に失敗しました。通信を確認してください。'
                : `候補 ${allHits.length} 件`}
        </div>

        {debouncedQ.length > 0 && !suggestQuery.isLoading && !suggestQuery.isError && allHits.length === 0 ? (
          <p className="text-sm text-slate-300">該当する候補がありません。</p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {allHits.map((hit) => (
            <li key={partSearchHitIdentity(hit)}>
              <PartSearchResultCard
                hit={hit}
                selected={selected != null && partSearchHitIdentity(selected) === partSearchHitIdentity(hit)}
                onSelect={() => setSelected(hit)}
              />
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <aside className="rounded-xl border border-sky-500/30 bg-slate-900/60 p-3">
          <div className="mb-2 text-xs font-semibold text-sky-200">選択中の詳細</div>
          <PartSearchResultCard hit={selected} />
        </aside>
      ) : null}
    </div>
  );
}
