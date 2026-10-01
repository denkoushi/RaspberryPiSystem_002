import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { listTorqueTrainingPrograms } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import {
  assemblyBoltConditionKey,
  assemblyBoltConditionsFromTrainingPrograms,
  formatAssemblyBoltConditionSpec,
  formatAssemblyBoltConditionTorque
} from './assemblyBoltConditionPalette';

import type { AssemblyBoltCondition, AssemblyBoltConditionPaletteEntry } from './assemblyBoltConditionPalette';

type Props = {
  entries: AssemblyBoltConditionPaletteEntry[];
  activeKey: string | null;
  /** 丸数字を選択中は、条件を押すとその丸数字へ付け替える。 */
  selectedMarkerNo: number | null;
  readOnly: boolean;
  onSelect: (key: string) => void;
  onAdd: (condition: AssemblyBoltCondition) => void;
};

type CatalogState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; conditions: AssemblyBoltCondition[] };

export function AssemblyBoltConditionStrip({ entries, activeKey, selectedMarkerNo, readOnly, onSelect, onAdd }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle' });
  const [catalogGeneration, setCatalogGeneration] = useState(0);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setCatalog({ status: 'loading' });
    void listTorqueTrainingPrograms()
      .then((programs) => {
        if (!cancelled) {
          setCatalog({ status: 'ready', conditions: assemblyBoltConditionsFromTrainingPrograms(programs) });
        }
      })
      .catch(() => {
        if (!cancelled) setCatalog({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, catalogGeneration]);

  const candidates = useMemo(() => {
    if (catalog.status !== 'ready') return [];
    const used = new Set(entries.map((entry) => entry.key));
    return catalog.conditions.filter((condition) => !used.has(assemblyBoltConditionKey(condition)));
  }, [catalog, entries]);

  return (
    <div
      role="group"
      aria-label="締付条件"
      data-testid="assembly-bolt-condition-strip"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <span className="shrink-0 text-xs font-bold text-white/60">締付条件</span>
      {entries.map((entry) => {
        const active = entry.key === activeKey;
        const spec = formatAssemblyBoltConditionSpec(entry.condition);
        return (
          <button
            key={entry.key}
            type="button"
            aria-pressed={active}
            aria-label={
              selectedMarkerNo != null
                ? `丸数字${selectedMarkerNo}を ${spec} にする`
                : `${spec} で置く`
            }
            disabled={readOnly}
            className={clsx(
              'grid min-h-11 grid-cols-[auto_auto] items-center gap-x-2 rounded border px-2 text-left disabled:opacity-60',
              active
                ? 'border-cyan-300 bg-cyan-900/45 text-white'
                : 'border-white/15 bg-slate-950/60 text-white/85 hover:bg-slate-800'
            )}
            onClick={() => onSelect(entry.key)}
          >
            <span className="text-sm font-bold tabular-nums">{spec}</span>
            <span className="row-span-2 text-xs font-bold tabular-nums text-white/60">{entry.markerNos.length}か所</span>
            <span className="text-[0.7rem] tabular-nums text-white/60">
              {formatAssemblyBoltConditionTorque(entry.condition)}
            </span>
          </button>
        );
      })}
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-11 shrink-0 whitespace-nowrap !px-3 text-xs"
        disabled={readOnly}
        onClick={() => setPickerOpen(true)}
      >
        ＋条件
      </Button>

      <Dialog isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="訓練メニューから条件を追加" size="md">
        {catalog.status === 'error' ? (
          <div className="grid gap-2">
            <p className="text-sm text-slate-700">訓練メニューを読み込めませんでした。</p>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setCatalogGeneration((current) => current + 1)}>
              再読込
            </Button>
          </div>
        ) : catalog.status !== 'ready' ? (
          <p className="text-sm text-slate-600">読込中…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-600">追加できる条件はありません。</p>
        ) : (
          <ul className="grid max-h-[60vh] gap-1 overflow-y-auto" aria-label="訓練メニューの締付条件">
            {candidates.map((condition) => (
              <li key={assemblyBoltConditionKey(condition)}>
                <button
                  type="button"
                  className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded border border-slate-300 px-3 text-left hover:bg-slate-100"
                  onClick={() => {
                    onAdd(condition);
                    setPickerOpen(false);
                  }}
                >
                  <span className="truncate text-base font-bold tabular-nums text-slate-900">
                    {formatAssemblyBoltConditionSpec(condition)}
                  </span>
                  <span className="text-sm tabular-nums text-slate-600">{formatAssemblyBoltConditionTorque(condition)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
