import { useMemo, useState } from 'react';

import { useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { kioskButtonSecondaryClassName, kioskInputClassName, kioskPanelClassName } from '../../kioskTheme';

const choiceClassName = 'min-h-14 min-w-24 rounded-lg border px-5 text-lg font-bold';
const selectedChoiceClassName = `${choiceClassName} border-sky-400 bg-sky-950/60 text-white`;
const idleChoiceClassName = `${choiceClassName} border-white/20 bg-slate-900/60 text-white hover:bg-slate-800`;
const addClassName = `${choiceClassName} border-dashed border-white/40 bg-transparent text-white/80 hover:bg-slate-800 disabled:opacity-40`;

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '追加に失敗しました';
}

function nextNumber(numbers: number[]): number {
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function InventoryShelvesTab({ accessPassword }: { accessPassword: string }) {
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword);
  const shelves = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const areas = useMemo(() => [...new Set(shelves.map((shelf) => shelf.area))].sort((a, b) => a.localeCompare(b, 'ja')), [shelves]);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [shelfId, setShelfId] = useState<string | null>(null);
  const [newArea, setNewArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = mutations.createShelf.isPending || mutations.createDrawer.isPending;

  const area = areaName && areas.includes(areaName) ? areaName : areas[0] ?? null;
  const areaShelves = shelves.filter((shelf) => shelf.area === area).sort((a, b) => a.shelfNumber - b.shelfNumber);
  const shelf = areaShelves.find((entry) => entry.id === shelfId) ?? areaShelves[0] ?? null;

  const run = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    setDone(null);
    try {
      await work();
      setDone(message);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const addShelf = (targetArea: string) => {
    const shelfNumber = nextNumber(shelves.filter((entry) => entry.area === targetArea).map((entry) => entry.shelfNumber));
    void run(() => mutations.createShelf.mutateAsync({ area: targetArea, shelfNumber }), `${targetArea} に 棚${shelfNumber} を追加しました`);
  };

  return (
    <div className="flex flex-col gap-4">
      {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
      {error ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}
      <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="エリア">
        <h2 className="text-xl font-bold text-white">エリア</h2>
        <div className="flex flex-wrap gap-2">
          {areas.map((entry) => (
            <button key={entry} type="button" aria-pressed={entry === area} className={entry === area ? selectedChoiceClassName : idleChoiceClassName} onClick={() => { setAreaName(entry); setShelfId(null); }}>{entry}</button>
          ))}
          {areas.length === 0 ? <p className="text-white/60">まだ棚がありません。下で最初のエリアを追加してください。</p> : null}
        </div>
        <details className="text-sm text-white/70">
          <summary className="flex min-h-11 cursor-pointer items-center">新しいエリアを追加（キーボードのある端末で入力）</summary>
          <div className="mt-2 flex gap-2">
            <input className={`${kioskInputClassName} min-w-0 flex-1`} aria-label="新しいエリア名" placeholder="例: 30007_KSJP-55" value={newArea} onChange={(event) => setNewArea(event.target.value)} />
            <button type="button" className={kioskButtonSecondaryClassName} disabled={pending || !newArea.trim() || areas.includes(newArea.trim())} onClick={() => { const target = newArea.trim(); addShelf(target); setAreaName(target); setNewArea(''); }}>棚1を作って追加</button>
          </div>
        </details>
      </section>
      {area ? (
        <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="棚">
          <h2 className="text-xl font-bold text-white">{area} の棚</h2>
          <div className="flex flex-wrap gap-2">
            {areaShelves.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={entry.id === shelf?.id} className={entry.id === shelf?.id ? selectedChoiceClassName : idleChoiceClassName} onClick={() => setShelfId(entry.id)}>棚{entry.shelfNumber}</button>
            ))}
            <button type="button" className={addClassName} disabled={pending} onClick={() => addShelf(area)}>＋ 棚{nextNumber(areaShelves.map((entry) => entry.shelfNumber))}を追加</button>
          </div>
        </section>
      ) : null}
      {shelf ? (
        <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="引き出し">
          <h2 className="text-xl font-bold text-white">棚{shelf.shelfNumber} の引き出し</h2>
          <div className="flex flex-wrap gap-2">
            {shelf.drawers.map((drawer) => (
              <div key={drawer.id} className="min-w-32 rounded-lg border border-white/15 bg-slate-950/40 p-3 text-white">
                <p className="text-lg font-bold">引出し{drawer.drawerNumber}</p>
                <p className="text-sm text-white/60">{drawer.compartments[0]?.item.name ?? '空き'}</p>
              </div>
            ))}
            <button
              type="button"
              className={addClassName}
              disabled={pending}
              onClick={() => {
                const drawerNumber = nextNumber(shelf.drawers.map((drawer) => drawer.drawerNumber));
                void run(() => mutations.createDrawer.mutateAsync({ shelfId: shelf.id, drawerNumber }), `棚${shelf.shelfNumber} に 引出し${drawerNumber} を追加しました`);
              }}
            >
              ＋ 引出し{nextNumber(shelf.drawers.map((drawer) => drawer.drawerNumber))}を追加
            </button>
          </div>
        </section>
      ) : null}
      <p className="text-sm text-white/60">番号は続き番号で追加します。飛び番号が必要なときは管理画面（PC）から追加してください。</p>
    </div>
  );
}
