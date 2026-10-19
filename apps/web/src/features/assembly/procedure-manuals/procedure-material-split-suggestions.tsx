import { Fragment, useEffect, useRef, useState } from 'react';

import { getProcedureMaterialSplitSuggestions } from '../../../api/client';

import type { MaterialGroup } from './procedure-material-grouping';
import type { ProcedureMaterialDto, ProcedureMaterialSplitSuggestions } from './procedure-material-types';
import type { ReactNode } from 'react';

type Choice = 'split' | 'dismissed';
type Entry = { loading: boolean; boundaries: ProcedureMaterialSplitSuggestions['boundaries']; choices: Record<string, Choice> };
const requestKey = (key: string, items: ProcedureMaterialDto[]) => JSON.stringify([key, items.map(item => item.id)]);

export function useMaterialSplitSuggestions(groups: MaterialGroup<ProcedureMaterialDto>[], openGroups: Map<string, boolean>, enabled: boolean) {
  const [entries, setEntries] = useState<Map<string, Entry>>(() => new Map());
  const requested = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requests = JSON.stringify(enabled ? groups.filter((group, index) => (openGroups.get(group.key) ?? index === 0)
    && group.items.filter(item => item.kind === 'PHOTO').length >= 2)
    .map(group => ({ key: requestKey(group.key, group.items), ids: group.items.map(item => item.id) })) : []);
  useEffect(() => {
    for (const { key, ids } of JSON.parse(requests) as Array<{ key: string; ids: string[] }>) {
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      setEntries(current => new Map(current).set(key, { loading: true, boundaries: [], choices: {} }));
      void (async () => {
        let boundaries: Entry['boundaries'] = [];
        // Overlap one page so bundles larger than the API limit keep every adjacent pair.
        for (let offset = 0; offset < ids.length - 1 && mounted.current; offset += 59) {
          const batch = ids.slice(offset, offset + 60);
          try {
            const result = await getProcedureMaterialSplitSuggestions(batch);
            if (result.status === 'disabled') { boundaries = []; break; }
            if (result.status === 'ok') boundaries.push(...result.boundaries.filter(boundary => {
              const index = batch.indexOf(boundary.beforeId);
              return index > 0 && batch[index - 1] === boundary.afterId && boundary.probability >= 0.5;
            }));
          } catch { /* Optional: retain successful pairs and leave failed pairs unchanged. */ }
        }
        if (mounted.current) setEntries(current => new Map(current).set(key, { loading: false, boundaries, choices: {} }));
      })();
    }
  }, [requests]);
  return {
    get: (key: string, items: ProcedureMaterialDto[]) => entries.get(requestKey(key, items)),
    choose: (key: string, items: ProcedureMaterialDto[], beforeId?: string, choice?: Choice) => {
      const id = requestKey(key, items);
      setEntries(current => {
        const entry = current.get(id);
        if (!entry) return current;
        const choices = { ...entry.choices };
        if (beforeId && choice) choices[beforeId] = choice;
        else for (const boundary of Object.keys(choices)) if (choices[boundary] === 'split') delete choices[boundary];
        return new Map(current).set(id, { ...entry, choices });
      });
    },
  };
}

export function MaterialSplitLoadingChip() {
  return <span role="status" className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-[#344252] px-2.5 py-1 text-sm font-medium text-[#9fadb9]">
    <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e2b44c] motion-reduce:animate-none" />区切りを確認中
  </span>;
}

export function MaterialSplitContents({ items, entry, choose, renderMaterials, onSelect, disabled }: {
  items: ProcedureMaterialDto[]; entry?: Entry; choose: (beforeId?: string, choice?: Choice) => void;
  renderMaterials: (items: ProcedureMaterialDto[]) => ReactNode; onSelect?: (items: ProcedureMaterialDto[]) => void;
  disabled: (item: ProcedureMaterialDto) => boolean;
}) {
  const boundaries = new Map(entry?.boundaries.map(boundary => [boundary.beforeId, boundary]));
  const starts = items.flatMap((item, index) => index === 0 || (boundaries.has(item.id) && entry?.choices[item.id] === 'split') ? [index] : []);
  const split = starts.length > 1;
  const buttonClass = 'min-h-11 rounded-lg border border-[#344252] px-4 text-[19px] font-bold disabled:opacity-40';
  return <>{items.map((item, index) => {
    const sectionIndex = starts.indexOf(index);
    const pages = sectionIndex >= 0 ? items.slice(index, starts[sectionIndex + 1] ?? items.length).filter(page => page.kind === 'PHOTO') : [];
    const selectable = pages.filter(page => !disabled(page));
    return <Fragment key={item.id}>
      {split && sectionIndex >= 0 ? <li className="col-span-full flex flex-wrap items-center gap-3 border-t border-[#344252] pt-3 text-[#eef3f6]">
        <b className="text-xl">書類 {sectionIndex + 1}</b><span className="text-[17px] text-[#9fadb9]">{pages.length} 枚</span>
        {onSelect ? <button type="button" className={`${buttonClass} text-[#3ba776]`} disabled={!selectable.length} onClick={() => onSelect(selectable)}>この {pages.length} 枚を選ぶ</button> : null}
        {sectionIndex === starts.length - 1 ? <button type="button" className={`${buttonClass} ml-auto text-[#9fadb9]`} onClick={() => choose()}>分けるのをやめる</button> : null}
      </li> : null}
      {boundaries.has(item.id) && !entry?.choices[item.id] ? <li className="col-span-full flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[#e2b44c] bg-[#1b222a] px-4 py-3">
        <span aria-hidden="true" className="text-2xl text-[#e2b44c]">✂</span>
        <div className="mr-auto"><b className="text-xl text-[#eef3f6]">ここで分けますか</b><p className="text-[17px] text-[#9fadb9]">次から別の書類のようです</p></div>
        <button type="button" className={`${buttonClass} !border-[#e2b44c] bg-[#e2b44c] text-[#1f1703]`} onClick={() => choose(item.id, 'split')}>分ける</button>
        <button type="button" className={`${buttonClass} text-[#9fadb9]`} onClick={() => choose(item.id, 'dismissed')}>分けない</button>
      </li> : null}
      {renderMaterials([item])}
    </Fragment>;
  })}</>;
}
