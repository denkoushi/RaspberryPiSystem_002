import { useNavigate } from 'react-router-dom';

import { PartSearchCharPalette } from '../../features/mobile-placement/part-search/PartSearchCharPalette';
import { partSearchHitIdentity } from '../../features/mobile-placement/part-search/partSearchIdentity';
import { PartSearchResultCard } from '../../features/mobile-placement/part-search/PartSearchResultCard';
import { useMobilePlacementPartSearch } from '../../features/mobile-placement/part-search/useMobilePlacementPartSearch';

export function MobilePlacementPartSearchPage() {
  const navigate = useNavigate();
  const {
    partQuery,
    setPartQuery,
    machineQuery,
    setMachineQuery,
    paletteTarget,
    setPaletteTarget,
    normalizedPartQuery,
    suggestQuery,
    visibleHits,
    hiddenPaletteKeys,
    selected,
    setSelected,
    clearSelection
  } = useMobilePlacementPartSearch();

  const showEmpty =
    normalizedPartQuery.length > 0 && !suggestQuery.isLoading && !suggestQuery.isError && visibleHits.length === 0;

  const inputClass =
    'mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-3 text-base text-white placeholder:text-slate-500';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4 pt-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-white">部品名で棚を探す</h1>
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
        部品名（FHINMEI / FHINCD）
        <input
          value={partQuery}
          onChange={(e) => {
            setPartQuery(e.target.value);
            clearSelection();
          }}
          onFocus={() => setPaletteTarget('part')}
          placeholder="例: 脚 / アシ / FHINCD"
          className={inputClass}
          inputMode="search"
          autoComplete="off"
        />
      </label>

      <label className="block text-xs font-medium text-slate-300">
        機種名（登録製番ボタン下段・任意）
        <input
          value={machineQuery}
          onChange={(e) => {
            setMachineQuery(e.target.value);
            clearSelection();
          }}
          onFocus={() => setPaletteTarget('machine')}
          placeholder="例: DAD3350…"
          className={inputClass}
          inputMode="search"
          autoComplete="off"
        />
      </label>

      <p className="text-[11px] text-slate-500">
        文字パレットは「{paletteTarget === 'part' ? '部品名' : '機種名'}」に追記します（フォーカスで切替）。
      </p>

      <div className="max-h-[min(52vh,420px)] overflow-y-auto rounded-xl border border-white/10 bg-slate-900/30 p-2">
        <PartSearchCharPalette
          hiddenKeys={hiddenPaletteKeys}
          onAppend={(s) => {
            if (paletteTarget === 'part') {
              setPartQuery((prev) => prev + s);
            } else {
              setMachineQuery((prev) => prev + s);
            }
            clearSelection();
          }}
          onBackspace={() => {
            if (paletteTarget === 'part') {
              setPartQuery((prev) => prev.slice(0, -1));
            } else {
              setMachineQuery((prev) => prev.slice(0, -1));
            }
            clearSelection();
          }}
        />
      </div>

      <section aria-live="polite" className="space-y-2">
        {normalizedPartQuery.length > 0 ? (
          <div className="text-xs text-slate-400">
            {suggestQuery.isLoading ? '検索中…' : suggestQuery.isError ? '検索に失敗しました。通信を確認してください。' : null}
          </div>
        ) : null}

        {showEmpty ? <p className="text-sm text-slate-300">該当なし</p> : null}

        <ul className="flex flex-col gap-2">
          {visibleHits.map((hit) => (
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
          <PartSearchResultCard hit={selected} />
        </aside>
      ) : null}
    </div>
  );
}
