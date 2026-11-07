import { useMemo, useState } from 'react';

import { normalizeMachineName } from '../productionSchedule/machineName';

import { formatHours } from './loadBalancingFormat';
import { namedTargetKey, namedTargetMatches, resolveNamedTarget } from './loadBalancingNamedTargets';
import { aggregateScenario, isScenarioCandidate } from './loadBalancingScenario';

import type { OutsourceNamedTarget, OutsourceSettings, ProductionScheduleLoadBalancingWorkspaceRow as Row } from '../../../api/client';
import type { ReactNode } from 'react';

const labels = { machine: '機種', seiban: '製番', part: '部品' };
const norm = (value: string) => value.normalize('NFKC').trim().toUpperCase();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const colors = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#fb923c'];
const button = 'h-11 shrink-0 rounded-lg bg-slate-800 px-3 font-bold disabled:opacity-30';

export function LoadBalancingNamedSettings({ settings, rows, months, today, selected, onSelect, onChange, tabs, closeButton, saving }: {
  settings: OutsourceSettings; rows: Row[]; months: string[]; today: string;
  selected: string; onSelect: (id: string) => void; onChange: (targets: OutsourceNamedTarget[]) => void;
  tabs: ReactNode; closeButton: ReactNode; saving: boolean;
}) {
  const [kind, setKind] = useState<OutsourceNamedTarget['kind']>('machine');
  const [query, setQuery] = useState('');
  const targets = useMemo(() => settings.namedTargets ?? [], [settings.namedTargets]);
  const vendor = settings.vendors.find((item) => item.id === selected) ?? settings.vendors[0];
  const candidates = useMemo(() => {
    const groups = new Map<string, { key: string; row: Row; minutes: number; count: number; due: string; prefix: boolean; matches: boolean }>();
    const q = norm(query);
    for (const row of rows) {
      const key = namedTargetKey(kind, row);
      if (!key.trim()) continue;
      const texts = kind === 'part' ? [row.fhincd, row.fhinmei] : [key];
      const positions = texts.map((text) => norm(text).indexOf(q)).filter((position) => position >= 0);
      const previous = groups.get(key);
      const due = row.effectiveDueDate;
      groups.set(key, { key, row: previous?.row ?? row, minutes: (previous?.minutes ?? 0) + row.totalMinutes,
        count: (previous?.count ?? 0) + 1, due: previous?.due && (!due || previous.due < due) ? previous.due : due,
        prefix: previous?.prefix || positions.includes(0), matches: previous?.matches || positions.length > 0 });
    }
    return [...groups.values()].filter((group) => group.matches).sort((a, b) => Number(b.prefix) - Number(a.prefix) || compare(a.due || '9999', b.due || '9999') || compare(a.key, b.key));
  }, [rows, kind, query]);
  const prefixes = [...new Set(rows.map((row) => norm(kind === 'part' ? row.fhincd : namedTargetKey(kind, row)).match(/^[A-Z]+/)?.[0]).filter((value): value is string => Boolean(value)))].sort().slice(0, 7);
  // Demand uses the same winner and calendar-month accounting as selection, before applying caps.
  const demand = useMemo(() => aggregateScenario({ rows, months, today, actions: rows.flatMap((row) => {
    const target = resolveNamedTarget(targets, row);
    return target && isScenarioCandidate(row, { months }) ? [{ rowId: row.rowId, type: 'outsource' as const, vendorId: target.vendorId }] : [];
  }) }).vendorUsage, [rows, months, today, targets]);
  const remove = (target: OutsourceNamedTarget) => onChange(targets.filter((item) => item.kind !== target.kind || item.key !== target.key));
  const label = (targetKind: OutsourceNamedTarget['kind'], key: string, row?: Row) => <>
    <span className="block truncate font-extrabold">{targetKind === 'part' && row ? row.fhinmei : key}</span>
    {row && targetKind !== 'machine' ? <small className="block truncate text-xs text-white/45">{targetKind === 'part' ? `${row.fhincd}\u3000${row.fseiban}\u3000` : ''}{normalizeMachineName(row.machineName, { maxChars: Number.MAX_SAFE_INTEGER })}</small> : null}
  </>;
  return <>
    <header className="flex h-16 shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap border-b border-white/15 px-3">
      {tabs}
      <div className="flex shrink-0 gap-1 border-l border-white/15 pl-2">{(['machine', 'seiban', 'part'] as const).map((value) => <button type="button" key={value} disabled={saving} className={`${button} ${kind === value ? '!bg-sky-600' : ''}`} aria-pressed={kind === value} onClick={() => { setKind(value); setQuery(''); }}>{labels[value]}</button>)}</div>
      <div className="flex h-11 w-[220px] shrink-0 items-center rounded-lg border border-white/15 bg-slate-950 px-2">
        <input className="min-w-0 flex-1 bg-transparent font-mono text-xl font-bold" aria-label="検索" value={query} disabled={saving} onChange={(event) => setQuery(event.target.value)} />
        <span className="px-2 font-mono text-white/40">{candidates.length}</span><button type="button" className="px-1 text-xl" aria-label="検索を消す" disabled={saving || !query} onClick={() => setQuery('')}>✕</button>
      </div>
      <div className="flex shrink-0 gap-1">{prefixes.map((prefix) => <button type="button" key={prefix} disabled={saving} className={`${button} !px-2 min-w-[42px] max-w-14 truncate text-sm ${norm(query).match(/^[A-Z]+/)?.[0] === prefix ? '!bg-sky-600' : ''}`} onClick={() => {
        const current = norm(query).match(/^[A-Z]+/)?.[0] ?? '';
        setQuery((current === prefix ? '' : prefix) + norm(query).slice(current.length));
      }}>{prefix}</button>)}</div>
      <div className="flex shrink-0 gap-1 border-l border-white/15 pl-2">{['1','2','3','4','5','6','7','8','9','0','-','⌫'].map((key) => <button type="button" key={key} disabled={saving} aria-label={key === '⌫' ? '1文字消す' : key} className={`${button} w-11 !px-0 text-xl`} onClick={() => setQuery(key === '⌫' ? query.slice(0, -1) : query + key)}>{key}</button>)}</div>
      <div className="flex-1" />{closeButton}
    </header>
    <fieldset disabled={saving} className="grid min-h-0 flex-1 grid-cols-[minmax(0,600fr)_minmax(0,920fr)_minmax(0,400fr)] border-0 p-0">
      <div className="min-h-0 overflow-auto border-r border-white/15 p-3" aria-label="名指し候補">
        {candidates.length === 0 ? <div className="p-8 text-center text-white/40">—</div> : null}
        {candidates.slice(0, 40).map((candidate) => {
          const assigned = targets.find((target) => target.kind === kind && target.key === candidate.key);
          return <button type="button" key={candidate.key} disabled={!vendor} aria-pressed={Boolean(assigned && assigned.vendorId === vendor?.id)} className={`mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-4 text-left ${assigned?.vendorId === vendor?.id ? 'border-sky-400 bg-sky-950' : 'border-white/10 bg-slate-800/50'}`} onClick={() => {
            if (!vendor) return;
            const rest = targets.filter((target) => target.kind !== kind || target.key !== candidate.key);
            onChange(assigned?.vendorId === vendor.id ? rest : [...rest, { kind, key: candidate.key, vendorId: vendor.id }]);
          }}>
            <span className="min-w-0 flex-1">{label(kind, candidate.key, candidate.row)}</span>
            <span className="shrink-0 text-right"><b>{formatHours(candidate.minutes)}H</b><small className="block text-xs text-white/45">{candidate.count}工程・{candidate.due ? candidate.due.slice(5).replace('-', '/') : '—'}</small></span>
            <span className="max-w-24 truncate rounded border border-white/15 px-2 py-1 text-xs">{settings.vendors.find((item) => item.id === assigned?.vendorId)?.name ?? '＋'}</span>
          </button>;
        })}
      </div>
      <div className="grid min-h-0 auto-rows-[84px] grid-cols-4 content-start gap-2 overflow-auto p-4" aria-label="名指し業者">
        {settings.vendors.map((item, index) => {
          const usage = demand.get(item.id) ?? new Map<string, number>();
          const count = targets.filter((target) => target.vendorId === item.id).length;
          const over = item.monthlyCapacityMinutes !== null && [...usage.values()].some((minutes) => minutes > item.monthlyCapacityMinutes!);
          return <button type="button" key={item.id} aria-label={`名指し業者 ${item.name}`} aria-pressed={vendor?.id === item.id} className={`grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border-l-4 bg-slate-800 px-3 py-2 text-left ${over ? 'ring-2 ring-rose-400' : vendor?.id === item.id ? 'ring-2 ring-sky-400' : ''}`} style={{ borderColor: colors[index % colors.length] }} onClick={() => onSelect(item.id)}>
            <small className="text-white/40">{index + 1}</small><b className="truncate">{item.name}</b><span className={`min-w-6 rounded-full px-2 text-center text-xs ${count ? 'bg-sky-500 font-bold text-slate-950' : ''}`}>{count || ''}</span>
            <span className={`col-span-2 col-start-2 text-sm ${over ? 'text-rose-300' : 'text-white/55'}`}>{formatHours([...usage.values()].reduce((sum, minutes) => sum + minutes, 0))}H{item.monthlyCapacityMinutes === null ? '' : ` / ${formatHours(item.monthlyCapacityMinutes)}H`}</span>
          </button>;
        })}
      </div>
      <div className="min-h-0 overflow-auto border-l border-white/15 p-3" aria-label="選択業者の名指し">
        {vendor ? <><div className="mb-4 flex items-center gap-2 border-b border-white/15 pb-3 font-extrabold"><small className="text-white/40">{settings.vendors.indexOf(vendor) + 1}</small><span className="min-w-0 flex-1 truncate">{vendor.name}</span><span className="shrink-0 text-sm">{formatHours([...(demand.get(vendor.id)?.values() ?? [])].reduce((sum, minutes) => sum + minutes, 0))}H{vendor.monthlyCapacityMinutes === null ? '' : ` / ${formatHours(vendor.monthlyCapacityMinutes)}H`}</span></div>
          {targets.filter((target) => target.vendorId === vendor.id).map((target) => {
            const matching = rows.filter((row) => namedTargetMatches(target, row));
            return <div key={JSON.stringify([target.kind, target.key])} className="mb-2 flex items-center gap-2 rounded-lg bg-slate-800 p-3">
              <small className="shrink-0 text-sky-300">{labels[target.kind]}</small><span className="min-w-0 flex-1">{label(target.kind, target.key, matching[0])}</span>
              <span className="shrink-0 text-sm">{formatHours(matching.reduce((sum, row) => sum + row.totalMinutes, 0))}H</span><button type="button" aria-label={`${labels[target.kind]} ${target.key} を外す`} className="px-2 text-xl text-white/50" onClick={() => remove(target)}>×</button>
            </div>;
          })}</> : null}
      </div>
    </fieldset>
  </>;
}
