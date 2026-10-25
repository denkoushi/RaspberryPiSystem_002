import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { HaizenBottomNav } from '../../features/mobile-placement/haizen/HaizenBottomNav';
import { HaizenIcon } from '../../features/mobile-placement/haizen/HaizenIcon';
import { HaizenSheet } from '../../features/mobile-placement/haizen/HaizenSheet';
import { haizenTabNavigationOptions } from '../../features/mobile-placement/haizen/useHubBackGuard';
import { partSearchHitIdentity } from '../../features/mobile-placement/part-search/partSearchIdentity';
import { PartSearchPhoneHit } from '../../features/mobile-placement/part-search/PartSearchPhoneHit';
import { PartSearchPhoneKeyboard } from '../../features/mobile-placement/part-search/PartSearchPhoneKeyboard';
import { useMobilePlacementPartSearch } from '../../features/mobile-placement/part-search/useMobilePlacementPartSearch';
import { haizenPhoneStyle, hp } from '../../features/mobile-placement/ui/haizenPhoneTokens';

export function MobilePlacementPartSearchPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const search = useMobilePlacementPartSearch();
  const [machineInputOpen, setMachineInputOpen] = useState(false);
  const [machineDraft, setMachineDraft] = useState('');
  // The suggest response has no machine names. Keep the existing query available
  // as a secondary input instead of inventing machine options from part fields.
  const [machineOption, setMachineOption] = useState('');
  const changePart = (value: string) => {
    search.setPartQuery(value);
    search.clearSelection();
  };
  const changeMachine = (value: string) => {
    search.setMachineQuery(value);
    search.clearSelection();
  };
  return <div style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <div className="mx-3.5 mt-3.5 flex h-[58px] shrink-0 items-center gap-2.5 rounded-2xl border-[1.5px] border-[var(--hp-shelf)] bg-[var(--hp-panel2)] pl-3.5 pr-2">
        <HaizenIcon name="search" className="h-[22px] w-[22px] shrink-0 text-[var(--hp-shelf)]" />
        <input aria-label="部品名・品番" placeholder="部品名・品番" value={search.partQuery}
          onChange={(event) => changePart(event.target.value)} onFocus={() => search.setPaletteTarget('part')}
          className="min-w-0 flex-1 bg-transparent text-[23px] font-black caret-[var(--hp-shelf)] outline-none placeholder:text-[17px] placeholder:font-bold placeholder:text-[var(--hp-ink3)]" />
        {search.partQuery && <button type="button" aria-label="全部消す" className={hp.iconButton} onClick={() => changePart('')}>
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 pb-1.5 pt-2">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto" role="group" aria-label="機種">
          <button type="button" className={hp.chip} aria-pressed={!search.machineQuery} onClick={() => changeMachine('')}>全機種</button>
          {machineOption && <button type="button" className={hp.chip} aria-pressed={search.machineQuery === machineOption} onClick={() => changeMachine(machineOption)}>{machineOption}</button>}
        </div>
        <button type="button" className={`shrink-0 text-xs ${hp.muted}`} onClick={() => { setMachineDraft(search.machineQuery); setMachineInputOpen(true); }}>機種指定</button>
        <span className={`ml-auto shrink-0 pl-1.5 text-[13px] font-bold ${hp.faint}`}>{search.visibleHits.length}件</span>
      </div>
      <section aria-label="検索結果" aria-live="polite" className={hp.list}>
        {search.suggestQuery.isError ? <div role="alert" className={hp.empty}>検索に失敗しました<br /><button type="button" className={hp.mini} onClick={() => void search.suggestQuery.refetch()}>再試行</button></div>
          : search.suggestQuery.isLoading ? <p className={hp.empty}>検索中…</p>
          : !search.visibleHits.length ? <p className={hp.empty}>{search.partQuery || search.machineQuery ? '見つかりません' : '部品名・品番を入力'}</p> : null}
        <ul className="flex flex-col gap-2">
          {search.visibleHits.map((hit) => {
            const selected = search.selected != null && partSearchHitIdentity(search.selected) === partSearchHitIdentity(hit);
            return <li key={partSearchHitIdentity(hit)}><PartSearchPhoneHit hit={hit} selected={selected} onSelect={() => search.setSelected(selected ? null : hit)} onDeleted={() => {
              search.clearSelection();
              setToast(`✓ ${hit.shelfCodeRaw} の ${hit.displayName} を消しました`);
            }} /></li>;
          })}
        </ul>
      </section>
      <PartSearchPhoneKeyboard hiddenKeys={search.hiddenPaletteKeys} onAppend={search.appendFromPalette} onPreset={changePart} />
      <HaizenBottomNav active="parts" onSelect={(tab) => {
        if (tab === 'verify' || tab === 'place') {
          try { localStorage.setItem('haizen-tab', tab); } catch { /* Storage may be disabled on the kiosk. */ }
          navigate('/kiosk/mobile-placement', haizenTabNavigationOptions());
        } else if (tab === 'purchase') navigate('/kiosk/purchase-order-lookup', haizenTabNavigationOptions());
      }} onMenu={() => navigate('/kiosk/mobile-placement', haizenTabNavigationOptions({ openHaizenMenu: true }))}>
        <button type="button" onClick={search.backspaceFromPalette} aria-label="1文字消す"
          className="h-[58px] min-w-0 flex-1 rounded-2xl border border-[color-mix(in_srgb,var(--hp-ng)_45%,var(--hp-line))] bg-[var(--hp-bg)] text-base font-black text-[var(--hp-ng)]">1字消す</button>
      </HaizenBottomNav>
    </div>
    {toast && <div role="status" className="absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black text-[var(--hp-bg)]">
      <span className="break-words">{toast}</span>
    </div>}
    {machineInputOpen && <HaizenSheet title="機種指定" onClose={() => setMachineInputOpen(false)}>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        const value = machineDraft.trim();
        setMachineOption(value);
        changeMachine(value);
        setMachineInputOpen(false);
      }}>
        <label className={`flex min-w-0 flex-1 flex-col gap-1 text-[13px] ${hp.muted}`}>機種名
          <input className={hp.input} value={machineDraft} onChange={(event) => setMachineDraft(event.target.value)} />
        </label>
        <button type="submit" className={`${hp.mini} !h-11`}>適用</button>
      </form>
    </HaizenSheet>}
  </div>;
}
