import { useMemo, useState } from 'react';

import { useInventoryImports, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { EditIcon, PinIcon, PlusIcon } from '../InventoryIcons';
import { invButtonSm, invButtonSmGhost, invCard, invError, invEyebrow, invSegAdd, invSuccess } from '../inventoryUi';

import { AreaNameEditor } from './AreaNameEditor';

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
  const [editor, setEditor] = useState<'rename' | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = mutations.createShelf.isPending || mutations.createDrawer.isPending || mutations.renameArea.isPending;

  const area = areaName && areas.includes(areaName) ? areaName : areas[0] ?? null;
  const areaShelves = shelves.filter((shelf) => shelf.area === area).sort((a, b) => a.shelfNumber - b.shelfNumber);

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
    void run(() => mutations.createShelf.mutateAsync({ area: targetArea, shelfNumber }), `${targetArea} に 棚${shelfNumber} を追加しました`, () => { setAreaName(targetArea); setEditor(null); });
  };

  const drawerCount = (target: string) => shelves.filter((entry) => entry.area === target).reduce((sum, entry) => sum + entry.drawers.length, 0);
  const shelfCount = (target: string) => shelves.filter((entry) => entry.area === target).length;
  const nextShelf = nextNumber(areaShelves.map((entry) => entry.shelfNumber));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
      <div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden">
        {done ? <p className={`rounded-xl border px-3 py-2 text-base font-bold ${invSuccess}`} role="status">{done}</p> : null}
        {error ? <p className={`rounded-xl border px-3 py-2 text-base ${invError}`} role="alert">{error}</p> : null}
      </div>

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
              <span className="min-w-0 flex-1 truncate">{entry}</span>
              <span className="shrink-0 text-xs font-normal tabular-nums text-inv-faint">棚{shelfCount(entry)}・{drawerCount(entry)}</span>
            </button>
          ))}
          <button type="button" className={`${invSegAdd} h-12 shrink-0 justify-start px-3.5`} disabled={pending} onClick={() => setEditor('new')}>＋ 新しいエリア</button>
        </section>

        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
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
          {area ? (
            <>
              <div className="flex items-center gap-3">
                <h2 className="text-[22px] font-black">{area}</h2>
                <button type="button" className={invButtonSmGhost} disabled={pending} onClick={() => setEditor('rename')}><EditIcon />名前を変える</button>
                <span className="flex-1" />
                <button type="button" className={invButtonSm} aria-label={`棚${nextShelf}を追加`} disabled={pending} onClick={() => addShelf(area)}><PlusIcon />棚{nextShelf}を追加</button>
              </div>
              {editor === 'rename' ? (
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
              {areaShelves.map((entry) => {
                const used = entry.drawers.filter((drawer) => drawer.compartments.length > 0).length;
                const nextDrawer = nextNumber(entry.drawers.map((drawer) => drawer.drawerNumber));
                return (
                  <section key={entry.id} className={`${invCard} flex w-max max-w-full flex-col gap-2.5 p-3.5`} aria-label={`棚${entry.shelfNumber}`}>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-[17px] font-black">棚 {entry.shelfNumber}</h3>
                      <span className="text-xs tabular-nums text-inv-faint">{used}/{entry.drawers.length} 使用</span>
                      <span className="min-w-6 flex-1" />
                      <button
                        type="button"
                        className={invButtonSmGhost}
                        aria-label={`棚${entry.shelfNumber}に引出し${nextDrawer}を追加`}
                        disabled={pending}
                        onClick={() => void run(() => mutations.createDrawer.mutateAsync({ shelfId: entry.id, drawerNumber: nextDrawer }), `棚${entry.shelfNumber} に 引出し${nextDrawer} を追加しました`)}
                      >
                        <PlusIcon />引出し
                      </button>
                    </div>
                    {entry.drawers.length > 0 ? (
                      <ul className="grid grid-cols-[repeat(5,200px)] gap-2">
                        {entry.drawers.map((drawer) => {
                          const name = drawer.compartments[0]?.item.name;
                          return (
                            <li key={drawer.id} className={`flex h-[78px] flex-col justify-between rounded-[10px] px-2.5 py-2 ${name ? 'border border-inv-line bg-inv-s2' : 'border border-dashed border-inv-line2'}`}>
                              <span className="text-xs tabular-nums text-inv-faint">引出し {drawer.drawerNumber}</span>
                              <span className={`truncate text-[13px] ${name ? 'font-bold' : 'text-inv-faint'}`}>{name ?? '空き'}</span>
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
