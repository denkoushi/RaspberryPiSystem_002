import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { replaceMobilePlacementShelfOrder } from '../../../../api/domains/mobile-placement';
import { HaizenHeader } from '../../haizen/HaizenHeader';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';
import { sortShelvesBySetting } from '../../registeredShelves';
import { refreshRegisteredShelvesAfterOrder } from '../../shelfListCache';
import { ShelfPhoto } from '../../shelfPhoto/ShelfPhoto';
import { hp } from '../../ui/haizenPhoneTokens';
import { useRegisteredShelves } from '../../useRegisteredShelves';

import type { RegisteredShelfEntryDto } from '../../registeredShelves';

/** 加工機ごとの塊。先頭に出てきた順を保つ。 */
function groupByMachine(shelves: RegisteredShelfEntryDto[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const shelf of shelves) {
    const key = shelf.machineName ?? '';
    groups.set(key, [...(groups.get(key) ?? []), shelf.shelfCodeRaw]);
  }
  return [...groups.values()];
}

function move<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + dir, 0, item);
  return next;
}

function MoveButtons({ label, index, count, onMove, disabled }: {
  label: string; index: number; count: number; onMove: (dir: -1 | 1) => void; disabled: boolean;
}) {
  const cls = 'h-11 w-12 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] text-lg font-black disabled:opacity-25';
  return <span className="flex shrink-0 gap-1">
    <button type="button" className={cls} aria-label={`${label} を上へ`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>▲</button>
    <button type="button" className={cls} aria-label={`${label} を下へ`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}>▼</button>
  </span>;
}

export function ShelfOrderPhoneSettings({ onClose, onMessage }: { onClose: () => void; onMessage?: (message: string) => void }) {
  const client = useQueryClient();
  const shelves = useRegisteredShelves();
  const all = shelves.data?.shelves ?? [];
  const byCode = new Map(all.map((shelf) => [shelf.shelfCodeRaw, shelf]));
  const saved = groupByMachine(sortShelvesBySetting(all));
  const [draft, setDraft] = useState<string[][] | null>(null);
  const groups = draft ?? saved;
  const flat = (value: string[][]) => value.flat().join('\n');
  const changed = flat(groups) !== flat(saved);
  const save = useMutation({
    networkMode: 'always',
    mutationFn: async (shelfCodes: string[]) => {
      const result = await replaceMobilePlacementShelfOrder(shelfCodes);
      const key = mobilePlacementQueryKeys.registeredShelves;
      await client.cancelQueries({ queryKey: key });
      const current = client.getQueryData<{ shelves: RegisteredShelfEntryDto[] }>(key) ?? { shelves: all };
      client.setQueryData(key, await refreshRegisteredShelvesAfterOrder(current, result.shelfCodes));
    },
    onSuccess: () => { onMessage?.('並び順を保存しました'); onClose(); }
  });
  const label = (code: string) => {
    const shelf = byCode.get(code);
    return shelf?.direction ?? shelf?.displayLabel ?? code;
  };
  const update = (next: string[][]) => { save.reset(); setDraft(next); };
  const busy = save.isPending;
  return <>
    <HaizenHeader title="並び順" onBack={() => { if (!busy) onClose(); }} />
    <div className={hp.list}>
      {shelves.isError && !shelves.data ? <p role="alert">棚を取得できません <button type="button" className={hp.mini} onClick={() => void shelves.refetch()}>再試行</button></p>
        : !shelves.data ? <p role="status">読込中…</p>
        : !groups.length ? <p>棚がありません</p>
        : groups.map((codes, gi) => {
          const name = byCode.get(codes[0])?.machineName ?? 'その他';
          return <section key={name} className="overflow-hidden rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)]">
            <div className="flex items-center gap-2 bg-[var(--hp-panel2)] py-1.5 pl-3 pr-1.5">
              <b className="min-w-0 flex-1 truncate font-mono text-[17px] font-black">{name}</b>
              <MoveButtons label={name} index={gi} count={groups.length} disabled={busy}
                onMove={(dir) => update(move(groups, gi, dir))} />
            </div>
            {codes.map((code, si) => <div key={code} className="flex items-center gap-2.5 border-t border-[var(--hp-line)] py-1.5 pl-3 pr-1.5">
              {byCode.get(code) && <ShelfPhoto shelf={byCode.get(code)!} label={label(code)} className="aspect-[4/3] w-14 shrink-0 rounded-lg" />}
              <b className="min-w-0 flex-1 truncate text-[19px] font-black text-[var(--hp-shelf)]">{label(code)}</b>
              {codes.length > 1 && <MoveButtons label={code} index={si} count={codes.length} disabled={busy}
                onMove={(dir) => update(groups.map((group, index) => index === gi ? move(group, si, dir) : group))} />}
            </div>)}
          </section>;
        })}
    </div>
    {save.isError && <p role="alert" className="px-3.5 text-[var(--hp-ng)]">保存できませんでした</p>}
    <footer className={hp.dock}>
      <button type="button" className={`${hp.segment} !h-14`} disabled={busy || !shelves.data}
        onClick={() => update(groupByMachine(all))}>棚コード順</button>
      <button type="button" className={`${hp.bottomPrimary} bg-[var(--hp-shelf)]`} disabled={busy || !changed}
        onClick={() => save.mutate(groups.flat())}>保存</button>
    </footer>
  </>;
}
