import { useMemo, useState } from 'react';

import { useInventoryImports, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { EditIcon, PinIcon, PlusIcon } from '../InventoryIcons';
import { invSetupTargets, invButtonSm, invButtonSmGhost, invCard, invEyebrow, invSegAdd } from '../inventoryUi';

import { AreaNameEditor } from './AreaNameEditor';
import { setupErrorText as errorText } from './setupError';

import type { InventoryShelf } from '../../../../api/client';

function nextNumber(numbers: number[]): number {
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function InventoryShelvesTab({ accessPassword }: { accessPassword: string }) {
  const locationsQuery = useInventoryLocations();
  const importsQuery = useInventoryImports(accessPassword, true);
  const mutations = useInventoryMutations(accessPassword, true);
  const shelves = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const areas = useMemo(() => [...new Set(shelves.map((shelf) => shelf.area))].sort((a, b) => a.localeCompare(b, 'ja')), [shelves]);
  // Machines of mailed candidates, offered as buttons when naming an area.
  const machineChoices = useMemo(() => [...new Set((importsQuery.data ?? []).map((entry) => entry.area))], [importsQuery.data]);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [editor, setEditor] = useState<'rename' | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState('area');
  const [deleted, setDeleted] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ kind: 'shelf'; shelf: InventoryShelf } | { kind: 'drawer'; shelfId: string; drawerNumber: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pending = working || mutations.createShelf.isPending || mutations.createDrawer.isPending || mutations.renameArea.isPending;

  const area = areaName && areas.includes(areaName) ? areaName : areas[0] ?? null;
  const areaShelves = shelves.filter((shelf) => shelf.area === area && !deleted.includes(shelf.id)).sort((a, b) => a.shelfNumber - b.shelfNumber);

  const run = async (work: () => Promise<unknown>, message: string, after?: () => void, target = 'area') => {
    setError(null);
    setErrorAt(target);
    if (target !== 'undo') setUndo(null);
    setDone(null);
    setWorking(true);
    try {
      await work();
      setDone(message);
      after?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setWorking(false);
    }
  };

  const addShelf = (targetArea: string) => {
    const shelfNumber = nextNumber(shelves.filter((entry) => entry.area === targetArea).map((entry) => entry.shelfNumber));
    void run(() => mutations.createShelf.mutateAsync({ area: targetArea, shelfNumber }), `棚${shelfNumber}を追加しました`, () => { setAreaName(targetArea); setEditor(null); });
  };

  const removeShelf = (shelf: InventoryShelf) => void run(
    () => mutations.deleteShelf.mutateAsync(shelf.id), `棚${shelf.shelfNumber}を削除しました`,
    () => { setDeleted((ids) => [...ids, shelf.id]); setUndo({ kind: 'shelf', shelf }); }, shelf.id,
  );
  const removeDrawer = (shelf: InventoryShelf, drawer: InventoryShelf['drawers'][number]) => void run(
    () => mutations.deleteDrawer.mutateAsync(drawer.id), `引き出し${drawer.drawerNumber}を削除しました`,
    () => { setDeleted((ids) => [...ids, drawer.id]); setUndo({ kind: 'drawer', shelfId: shelf.id, drawerNumber: drawer.drawerNumber }); }, drawer.id,
  );
  const restore = () => {
    if (!undo) return;
    void run(() => undo.kind === 'shelf'
      ? mutations.createShelf.mutateAsync({ area: undo.shelf.area, shelfNumber: undo.shelf.shelfNumber })
      : mutations.createDrawer.mutateAsync({ shelfId: undo.shelfId, drawerNumber: undo.drawerNumber }),
    '元に戻しました', () => setUndo(null), 'undo');
  };
  const localError = (target: string) => <div className="h-8 shrink-0 overflow-hidden text-sm leading-4">{error && errorAt === target ? <p role="alert" className="line-clamp-2 text-[#ffd0d0]">{error}</p> : null}</div>;

  const drawerCount = (target: string) => shelves.filter((entry) => entry.area === target).reduce((sum, entry) => sum + entry.drawers.length, 0);
  const shelfCount = (target: string) => shelves.filter((entry) => entry.area === target).length;
  const nextShelf = nextNumber(areaShelves.map((entry) => entry.shelfNumber));

  return (
    <div className={`${invSetupTargets} flex min-h-0 flex-1 flex-col gap-3 pt-4`}>
      <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-5">
        <section className="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="エリア">
          <h2 className={invEyebrow}>エリア（加工機 ＋ 方角）</h2>
          {areas.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={entry === area}
              className={`flex h-14 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-left text-[15px] font-bold ${entry === area ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12]' : 'border border-inv-line bg-inv-s1 hover:bg-inv-s2'}`}
              onClick={() => { setAreaName(entry); setEditor(null); }}
            >
              <PinIcon />
              <span className="min-w-0 flex-1 line-clamp-2 break-all">{entry}</span>
              <span className="shrink-0 text-xs font-normal tabular-nums text-inv-faint">棚{shelfCount(entry)}・{drawerCount(entry)}</span>
            </button>
          ))}
          <button type="button" className={`${invSegAdd} h-12 shrink-0 justify-start px-3.5`} disabled={pending} onClick={() => setEditor('new')}>＋ 新しいエリア</button>
        </section>

        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
          <div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden">
            {done ? <p className="min-w-0 truncate text-sm font-bold text-[#d7fbe9]" role="status">{done}</p> : null}
            {undo ? <button type="button" className={invButtonSmGhost} disabled={pending} onClick={restore}>元に戻す</button> : null}
            {errorAt === 'undo' ? localError('undo') : null}
          </div>
          {editor === 'new' ? (
            <AreaNameEditor
              key="new"
              title="新しいエリア（棚1ができます）"
              machineChoices={machineChoices}
              confirmLabel="棚1を作る"
              pending={pending}
              error={errorAt === 'area' ? error : null}
              onCancel={() => setEditor(null)}
              onConfirm={(next) => (areas.includes(next) ? (setErrorAt('area'), setError('同じエリアがあります')) : addShelf(next))}
            />
          ) : null}
          {area ? (
            <>
              <div className="flex items-center gap-3">
                <h2 className="min-w-0 flex-1 line-clamp-2 break-all text-[22px] font-black">{area}</h2>
                <button type="button" className={invButtonSmGhost} disabled={pending} onClick={() => setEditor('rename')}><EditIcon />名前を変える</button>
                <span className="flex-1" />
                <button type="button" className={invButtonSm} aria-label={`棚${nextShelf}を追加`} disabled={pending} onClick={() => addShelf(area)}><PlusIcon />棚{nextShelf}を追加</button>
              </div>
              {editor === null ? localError('area') : null}
              {editor === 'rename' ? (
                <AreaNameEditor
                  key={`rename-${area}`}
                  title={`エリア名を変える：${area} →`}
                  initialArea={area}
                  machineChoices={machineChoices}
                  confirmLabel="名前を変える"
                  pending={pending}
                  error={errorAt === 'area' ? error : null}
                  onCancel={() => setEditor(null)}
                  onConfirm={(next) => void run(
                    () => mutations.renameArea.mutateAsync({ from: area, to: next }),
                    '名前を変えました',
                    () => { setAreaName(next); setEditor(null); },
                  )}
                />
              ) : null}
              {areaShelves.map((entry) => {
                const used = entry.drawers.filter((drawer) => drawer.compartments.length > 0).length;
                const nextDrawer = nextNumber(entry.drawers.map((drawer) => drawer.drawerNumber));
                return (
                  <section key={entry.id} className={`${invCard} flex w-max max-w-full flex-col gap-2.5 p-3.5`} aria-label={`棚${entry.shelfNumber}`}>
                    <div className="flex items-center gap-2.5">
                      <button type="button" className={invButtonSmGhost} aria-label={`棚${entry.shelfNumber}を削除`} disabled={pending || entry.drawers.length > 0} onClick={() => removeShelf(entry)}>削除</button>
                      {entry.drawers.length > 0 ? <span className="text-xs text-inv-faint">引き出しあり</span> : null}
                      <h3 className="text-[17px] font-black">棚 {entry.shelfNumber}</h3>
                      <span className="text-xs tabular-nums text-inv-faint">{used}/{entry.drawers.length} 使用</span>
                      <span className="min-w-6 flex-1" />
                      <button
                        type="button"
                        className={invButtonSmGhost}
                        aria-label={`棚${entry.shelfNumber}に引き出し${nextDrawer}を追加`}
                        disabled={pending}
                        onClick={() => void run(() => mutations.createDrawer.mutateAsync({ shelfId: entry.id, drawerNumber: nextDrawer }), `棚${entry.shelfNumber} に 引き出し${nextDrawer} を追加しました`, undefined, entry.id)}
                      >
                        <PlusIcon />引き出し
                      </button>
                    </div>
                    {localError(entry.id)}
                    {entry.drawers.length > 0 ? (
                      <ul className="grid grid-cols-[repeat(5,200px)] gap-2">
                        {entry.drawers.filter((drawer) => !deleted.includes(drawer.id)).map((drawer) => {
                          const name = drawer.compartments[0]?.item.name;
                          return (
                            <li key={drawer.id} className={`flex h-[152px] min-w-11 flex-col justify-between rounded-[10px] px-2.5 py-2 ${name ? 'border border-inv-line bg-inv-s2' : 'border border-dashed border-inv-line2'}`}>
                              <span className="text-xs tabular-nums text-inv-faint">引き出し {drawer.drawerNumber}</span>
                              <span className={`line-clamp-2 break-all text-[13px] ${name ? 'font-bold' : 'text-inv-faint'}`}>{name ?? '空き'}</span>
                              <div className="flex items-center gap-2">
                                <button type="button" className={invButtonSmGhost} aria-label={`棚${entry.shelfNumber}の引き出し${drawer.drawerNumber}を削除`} disabled={pending || drawer.compartments.length > 0} onClick={() => removeDrawer(entry, drawer)}>削除</button>
                                {drawer.compartments.length > 0 ? <span className="text-xs text-inv-faint">使用中</span> : null}
                              </div>
                              {localError(drawer.id)}
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="text-sm text-inv-faint">引き出しはまだありません</p>}
                  </section>
                );
              })}
            </>
          ) : editor !== 'new' ? <p className="text-inv-muted">まだ棚がありません。「＋ 新しいエリア」から作ってください。</p> : null}
        </div>
      </div>
    </div>
  );
}
