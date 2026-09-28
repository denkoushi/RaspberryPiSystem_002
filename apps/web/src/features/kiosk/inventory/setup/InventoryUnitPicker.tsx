import { useState } from 'react';

import { useInventoryMutations, useInventoryUnits } from '../../../../api/hooks';

type Props = {
  /** Current unit name; null means 個. */
  value: string | null;
  onChange: (unit: string) => void;
  accessPassword: string;
  disabled?: boolean;
};

const chipOn = 'h-10 rounded-lg border-2 border-sky-400 bg-sky-950/60 px-3 text-base font-bold text-white';
const chipOff = 'h-10 rounded-lg border border-white/25 bg-slate-800 px-3 text-base text-white/90 hover:bg-slate-700 disabled:opacity-40';

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '追加に失敗しました';
}

/** Choose the unit an item is counted in, or add a new unit (typed on a keyboard). */
export function InventoryUnitPicker({ value, onChange, accessPassword, disabled }: Props) {
  const unitsQuery = useInventoryUnits();
  const mutations = useInventoryMutations(accessPassword);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = value || '個';
  const units = unitsQuery.data ?? [];

  const add = async () => {
    setError(null);
    try {
      const unit = await mutations.createUnit.mutateAsync(name);
      onChange(unit.name);
      setName('');
      setAdding(false);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="単位">
      {units.map((unit) => (
        <button key={unit.id} type="button" aria-pressed={unit.name === current} className={unit.name === current ? chipOn : chipOff} disabled={disabled} onClick={() => onChange(unit.name)}>{unit.name}</button>
      ))}
      {adding ? (
        <span className="flex items-center gap-1.5">
          <input aria-label="新しい単位" placeholder="例: 箱" maxLength={20} className="h-10 w-28 rounded-md border border-white/25 bg-slate-950 px-2.5 text-base text-white focus:border-sky-400 focus:outline-none" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="button" className={chipOff} disabled={!name.trim() || mutations.createUnit.isPending} onClick={() => void add()}>追加</button>
          <button type="button" className="text-sm text-white/60 underline" onClick={() => { setAdding(false); setName(''); setError(null); }}>やめる</button>
        </span>
      ) : (
        <button type="button" className="h-10 rounded-lg border border-dashed border-white/40 px-3 text-sm text-white/85 hover:bg-slate-800 disabled:opacity-40" disabled={disabled} onClick={() => setAdding(true)}>＋ 新しい単位</button>
      )}
      {error ? <span className="text-sm text-red-200" role="alert">{error}</span> : null}
    </div>
  );
}
