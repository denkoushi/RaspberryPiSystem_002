import { useMemo, useState } from 'react';

import { useInventoryImports, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';

import { AreaNameEditor } from './AreaNameEditor';

const chipOn = 'h-10 rounded-lg border-2 border-sky-400 bg-sky-950/60 px-3 text-base font-bold text-white';
const chipOff = 'h-10 rounded-lg border border-white/25 bg-slate-800 px-3 text-base text-white/90 hover:bg-slate-700';
const numberOn = 'h-11 w-16 rounded-lg border-2 border-sky-400 bg-sky-950/60 text-base font-bold text-white';
const numberOff = 'h-11 w-16 rounded-lg border border-white/25 bg-slate-800 text-base font-bold text-white/90 hover:bg-slate-700';
const addClass = 'h-11 rounded-lg border border-dashed border-white/40 px-3 text-sm text-white/85 hover:bg-slate-800 disabled:opacity-40';
const panelClass = 'flex flex-col gap-2.5 rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-3.5';

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '処理に失敗しました';
}

function nextNumber(numbers: number[]): number {
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function InventoryShelvesTab({ accessPassword }: { accessPassword: string }) {
  const locationsQuery = useInventoryLocations();
  const importsQuery = useInventoryImports(accessPassword);
  const mutations = useInventoryMutations(accessPassword);
  const shelves = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const areas = useMemo(() => [...new Set(shelves.map((shelf) => shelf.area))].sort((a, b) => a.localeCompare(b, 'ja')), [shelves]);
  // Machines of mailed candidates, offered as buttons when naming an area.
  const machineChoices = useMemo(() => [...new Set((importsQuery.data ?? []).map((entry) => entry.area))], [importsQuery.data]);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [shelfId, setShelfId] = useState<string | null>(null);
  const [editor, setEditor] = useState<'rename' | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = mutations.createShelf.isPending || mutations.createDrawer.isPending || mutations.renameArea.isPending;

  const area = areaName && areas.includes(areaName) ? areaName : areas[0] ?? null;
  const areaShelves = shelves.filter((shelf) => shelf.area === area).sort((a, b) => a.shelfNumber - b.shelfNumber);
  const shelf = areaShelves.find((entry) => entry.id === shelfId) ?? areaShelves[0] ?? null;

  const run = async (work: () => Promise<unknown>, message: string, after?: () => void) => {
    setError(null);
    setDone(null);
    try {
      await work();
      setDone(message);
      after?.();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const addShelf = (targetArea: string) => {
    const shelfNumber = nextNumber(shelves.filter((entry) => entry.area === targetArea).map((entry) => entry.shelfNumber));
    void run(() => mutations.createShelf.mutateAsync({ area: targetArea, shelfNumber }), `${targetArea} に 棚${shelfNumber} を追加しました`, () => { setAreaName(targetArea); setShelfId(null); setEditor(null); });
  };

  return (
    <div className="flex flex-col gap-3">
      {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 px-3 py-2 text-base font-semibold text-emerald-100" role="status">{done}</p> : null}
      {error ? <p className="rounded border border-red-400/50 bg-red-950/60 px-3 py-2 text-base text-red-100" role="alert">{error}</p> : null}

      <section className={panelClass} aria-label="エリア">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white">エリア</h2>
          <span className="text-sm text-white/60">加工機 ＋ 東西南北</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {areas.map((entry) => (
            <button key={entry} type="button" aria-pressed={entry === area} className={entry === area ? chipOn : chipOff} onClick={() => { setAreaName(entry); setShelfId(null); setEditor(null); }}>{entry}</button>
          ))}
          {area ? <button type="button" className={addClass} disabled={pending} onClick={() => setEditor('rename')}>名前を変える</button> : null}
          <button type="button" className={addClass} disabled={pending} onClick={() => setEditor('new')}>＋ 新しいエリア</button>
        </div>
        {editor === 'rename' && area ? (
          <AreaNameEditor
            key={`rename-${area}`}
            title={`エリア名を変える：${area} →`}
            initialArea={area}
            machineChoices={machineChoices}
            confirmLabel="名前を変える"
            pending={pending}
            onCancel={() => setEditor(null)}
            onConfirm={(next) => void run(
              () => mutations.renameArea.mutateAsync({ from: area, to: next }),
              `「${area}」を「${next}」に変えました（棚・引き出し・在庫はそのまま）`,
              () => { setAreaName(next); setEditor(null); },
            )}
          />
        ) : null}
        {editor === 'new' ? (
          <AreaNameEditor
            key="new"
            title="新しいエリア（棚1ができます）"
            machineChoices={machineChoices}
            confirmLabel="棚1を作る"
            pending={pending}
            onCancel={() => setEditor(null)}
            onConfirm={(next) => (areas.includes(next) ? setError(`「${next}」はもうあります`) : addShelf(next))}
          />
        ) : null}
      </section>

      {area ? (
        <section className={panelClass} aria-label="棚">
          <h2 className="text-base font-bold text-white">{area} の棚</h2>
          <div className="flex flex-wrap gap-1.5">
            {areaShelves.map((entry) => (
              <button key={entry.id} type="button" aria-label={`棚${entry.shelfNumber}`} aria-pressed={entry.id === shelf?.id} className={entry.id === shelf?.id ? numberOn : numberOff} onClick={() => setShelfId(entry.id)}>{entry.shelfNumber}</button>
            ))}
            <button type="button" className={addClass} disabled={pending} onClick={() => addShelf(area)}>＋ 棚{nextNumber(areaShelves.map((entry) => entry.shelfNumber))}を追加</button>
          </div>
        </section>
      ) : <p className="text-white/60">まだ棚がありません。「＋ 新しいエリア」から作ってください。</p>}

      {shelf ? (
        <section className={panelClass} aria-label="引き出し">
          <h2 className="text-base font-bold text-white">棚{shelf.shelfNumber} の引き出し</h2>
          <div className="flex flex-wrap gap-1.5">
            {shelf.drawers.map((drawer) => (
              <div key={drawer.id} className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">
                <p className="text-base font-bold">引出し{drawer.drawerNumber}</p>
                <p className="truncate text-sm text-white/60">{drawer.compartments[0]?.item.name ?? '空き'}</p>
              </div>
            ))}
            <button
              type="button"
              className={addClass}
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
    </div>
  );
}
