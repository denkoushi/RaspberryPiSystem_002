import { useState } from 'react';

import { Dialog } from '../../../components/ui/Dialog';

import { LoadBalancingNamedSettings } from './LoadBalancingNamedSettings';

import type { ProductionScheduleLoadBalancingWorkspaceRow, OutsourceCondition, OutsourceSettings, OutsourceVendor } from '../../../api/client';

const labels = { due: '納期の余裕', minutes: '工数', vendor: '業者の順位' };
const inputClass = 'rounded-md border border-white/20 bg-slate-800 px-2 py-2 text-white';
const buttonClass = 'rounded-lg bg-slate-800 px-3 py-2 font-bold disabled:opacity-30';
const emptyCondition = (): OutsourceCondition => ({ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null });
const swap = <T,>(items: T[], index: number, delta: number): T[] => {
  const next = [...items];
  [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
  return next;
};

const normalizePriorities = (settings: OutsourceSettings): OutsourceSettings => ({
  ...settings, vendors: settings.vendors.map((item, index) => ({ ...item, priority: index + 1 }))
});

export function LoadBalancingOutsourceSettings({ settings, resources, rows = [], months = [], today = '', saving, error, onSave, onClose }: {
  settings: OutsourceSettings;
  resources: string[];
  rows?: ProductionScheduleLoadBalancingWorkspaceRow[];
  months?: string[];
  today?: string;
  saving: boolean;
  error: string | null;
  onSave: (settings: OutsourceSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<OutsourceSettings>(() => ({ ...structuredClone(settings), namedTargets: structuredClone(settings.namedTargets ?? []), vendors: [...structuredClone(settings.vendors)].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)) }));
  const [initial] = useState(() => normalizePriorities(draft));
  const [selected, setSelected] = useState(settings.vendors[0]?.id ?? '');
  const [tab, setTab] = useState<'vendor' | 'named'>('vendor');
  const [invalid, setInvalid] = useState<string | null>(null);
  const vendor = draft.vendors.find((item) => item.id === selected) ?? draft.vendors[0];
  const updateVendor = (update: (current: OutsourceVendor) => OutsourceVendor) => setDraft((current) => ({ ...current, vendors: current.vendors.map((item) => item.id === vendor?.id ? update(item) : item) }));
  const updateCondition = (index: number, change: Partial<OutsourceCondition>) => updateVendor((current) => ({ ...current, conditions: current.conditions.map((condition, i) => i === index ? { ...condition, ...change } : condition) }));
  const identity = (value: OutsourceSettings) => JSON.stringify({ ...value, namedTargets: [...value.namedTargets ?? []].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)) });
  const close = () => {
    if (saving) return;
    const normalized = normalizePriorities(draft);
    if (identity(normalized) === identity(initial)) { onClose(); return; }
    if (draft.vendors.some((item) => !item.name.trim())) { setInvalid('名前を入力してください'); return; }
    if (draft.vendors.some((item) => [item.monthlyCapacityMinutes, ...item.conditions.map((condition) => condition.maxMinutes)].some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000_000)))) {
      setInvalid('上限は0以上の数値で入力してください'); return;
    }
    setInvalid(null);
    onSave(normalized);
  };
  const tabs = <div className="flex shrink-0 gap-1 rounded-lg bg-slate-800 p-1">{(['vendor', 'named'] as const).map((value) => <button type="button" key={value} disabled={saving} aria-pressed={tab === value} className={`h-10 rounded-md px-3 font-bold ${tab === value ? 'bg-sky-600' : ''}`} onClick={() => setTab(value)}>{value === 'vendor' ? '業者' : '名指し'}<b className="ml-2 text-xs opacity-70">{value === 'vendor' ? draft.vendors.length : draft.namedTargets?.length ?? 0}</b></button>)}</div>;
  const closeButton = <><span role={invalid || error ? 'alert' : undefined} className="text-rose-300">{invalid ?? error}</span><button type="button" className={`${buttonClass} !bg-emerald-600`} onClick={close} disabled={saving}>{saving ? '保存中' : '閉じる'}</button></>;
  return <Dialog isOpen onClose={close} ariaLabel="業者の設定" size="full" closeOnBackdrop={false}
    className="!m-0 flex !h-dvh !max-h-none !w-screen !max-w-none flex-col !rounded-none !border-0 !bg-slate-900 !p-0 !text-white" overlayClassName="!p-0">
    {tab === 'named' ? <LoadBalancingNamedSettings settings={draft} rows={rows} months={months} today={today} selected={selected} onSelect={setSelected} onChange={(namedTargets) => setDraft({ ...draft, namedTargets })} tabs={tabs} closeButton={closeButton} saving={saving} /> : <>
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/15 px-5">{tabs}<div className="flex-1" />{closeButton}</header>
    <fieldset disabled={saving} className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] border-0 p-0">
      <div className="min-h-0 overflow-auto border-r border-white/15 p-3">
        {draft.vendors.map((item, index) => <div key={item.id} className={`mb-2 flex items-center gap-2 rounded-lg border p-2 ${vendor?.id === item.id ? 'border-sky-400 bg-sky-950' : 'border-white/10'}`}>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelected(item.id)} aria-pressed={vendor?.id === item.id}>
            <span className="text-white/40">{index + 1}</span><span className="min-w-0 flex-1 truncate font-bold">{item.name || '（名前なし）'}</span><small className="whitespace-nowrap text-white/55">{item.monthlyCapacityMinutes === null ? '上限なし' : `${item.monthlyCapacityMinutes / 60}H/月`}</small>
          </button><span className="flex flex-col text-xs">
            <button type="button" aria-label={`${item.name} の順位を上げる`} disabled={index === 0} className="disabled:opacity-20" onClick={() => setDraft({ ...draft, vendors: swap(draft.vendors, index, -1) })}>▲</button>
            <button type="button" aria-label={`${item.name} の順位を下げる`} disabled={index === draft.vendors.length - 1} className="disabled:opacity-20" onClick={() => setDraft({ ...draft, vendors: swap(draft.vendors, index, 1) })}>▼</button>
          </span>
        </div>)}
        <button type="button" className={`${buttonClass} w-full`} onClick={() => {
          const id = globalThis.crypto?.randomUUID?.() ?? `vendor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          setDraft({ ...draft, vendors: [...draft.vendors, { id, name: '', priority: draft.vendors.length + 1, monthlyCapacityMinutes: null, conditions: [emptyCondition()] }] });
          setSelected(id);
        }}>＋ 業者</button>
      </div>
      <div className="min-h-0 overflow-auto p-6">
        {vendor ? <>
          <div className="mb-5 flex items-center gap-4"><label htmlFor="vendor-name" className="w-28 shrink-0 font-bold">名前</label><input id="vendor-name" className={`${inputClass} w-80`} value={vendor.name} maxLength={120} onChange={(event) => updateVendor((item) => ({ ...item, name: event.target.value }))} />
            <button type="button" className="ml-auto text-rose-300" onClick={() => setDraft({ ...draft, vendors: draft.vendors.filter((item) => item.id !== vendor.id), namedTargets: draft.namedTargets?.filter((target) => target.vendorId !== vendor.id) })}>業者を削除</button>
          </div>
          <div className="mb-5 flex items-center gap-4"><label htmlFor="vendor-capacity" className="w-28 shrink-0 font-bold">月の上限</label><HoursInput id="vendor-capacity" value={vendor.monthlyCapacityMinutes} onChange={(value) => updateVendor((item) => ({ ...item, monthlyCapacityMinutes: value }))} /><span className="text-white/55">H</span></div>
          <div className="flex items-start gap-4"><span className="w-28 shrink-0 pt-9 font-bold">加工できるもの</span><div className="min-w-0 flex-1 overflow-auto">
            <table className="w-full border-separate border-spacing-y-2 text-sm"><thead className="text-left text-white/55"><tr><th>資源CD</th><th>品番の頭</th><th>品名の言葉</th><th>1件の上限</th><th /></tr></thead><tbody>
              {vendor.conditions.map((condition, index) => <tr key={index}>
                <td className="min-w-36 max-w-64 pr-2"><div className="flex flex-wrap gap-1">{[...new Set([...resources, ...condition.resourceCds])].sort().map((code) => <button type="button" key={code} className={`rounded border px-2 py-1 font-mono ${condition.resourceCds.includes(code) ? 'border-sky-300 bg-sky-700' : 'border-white/15 bg-slate-800'}`} aria-label={`条件${index + 1} 資源${code}`} aria-pressed={condition.resourceCds.includes(code)} onClick={() => updateCondition(index, { resourceCds: condition.resourceCds.includes(code) ? condition.resourceCds.filter((cd) => cd !== code) : [...condition.resourceCds, code] })}>{code}</button>)}</div></td>
                <td className="pr-2"><input aria-label={`条件${index + 1} 品番の頭`} className={`${inputClass} w-28`} maxLength={200} value={condition.partPrefix} onChange={(event) => updateCondition(index, { partPrefix: event.target.value })} /></td>
                <td className="pr-2"><input aria-label={`条件${index + 1} 品名の言葉`} className={`${inputClass} w-40`} maxLength={200} value={condition.partName} onChange={(event) => updateCondition(index, { partName: event.target.value })} /></td>
                <td className="whitespace-nowrap pr-2"><HoursInput label={`条件${index + 1} 1件の上限`} value={condition.maxMinutes} onChange={(value) => updateCondition(index, { maxMinutes: value })} /> H</td>
                <td><button type="button" aria-label={`条件${index + 1} を削除`} className="text-rose-300" onClick={() => updateVendor((item) => ({ ...item, conditions: item.conditions.filter((_, i) => i !== index) }))}>削除</button></td>
              </tr>)}
            </tbody></table>
            <button type="button" className={`${buttonClass} mt-2`} onClick={() => updateVendor((item) => ({ ...item, conditions: [...item.conditions, emptyCondition()] }))}>＋ 条件</button>
          </div></div>
        </> : null}
      </div>
    </fieldset>
    <footer className="flex h-24 shrink-0 items-center gap-8 border-t border-white/15 px-5">
      <div className="flex items-center gap-4"><span className="font-bold">出し方</span><div className="flex gap-1 rounded-lg bg-slate-800 p-1">{(['process', 'part'] as const).map((mode) => <button type="button" key={mode} disabled={saving} aria-pressed={draft.mode === mode} className={`rounded-md px-4 py-2 font-bold ${draft.mode === mode ? 'bg-sky-600' : ''}`} onClick={() => setDraft({ ...draft, mode })}>{mode === 'process' ? '工程ごと' : '部品ごと'}</button>)}</div></div>
      <div className="flex items-center gap-3"><span className="font-bold">候補の順番</span>{draft.order.map((key, index) => <span key={key} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2"><small className="text-white/40">{index + 1}</small>{labels[key]}
        <button type="button" aria-label={`${labels[key]} を前へ`} className="disabled:opacity-20" disabled={saving || index === 0} onClick={() => setDraft({ ...draft, order: swap(draft.order, index, -1) })}>◀</button>
        <button type="button" aria-label={`${labels[key]} を後ろへ`} className="disabled:opacity-20" disabled={saving || index === 2} onClick={() => setDraft({ ...draft, order: swap(draft.order, index, 1) })}>▶</button>
      </span>)}</div>
    </footer>
    </>}
  </Dialog>;
}

function HoursInput({ id, label, value, onChange }: { id?: string; label?: string; value: number | null; onChange: (value: number | null) => void }) {
  return <input id={id} aria-label={label} type="number" min="0" step="any" className={`${inputClass} w-24 text-right tabular-nums`} value={value === null ? '' : Number((value / 60).toFixed(8))} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value) * 60)} />;
}
