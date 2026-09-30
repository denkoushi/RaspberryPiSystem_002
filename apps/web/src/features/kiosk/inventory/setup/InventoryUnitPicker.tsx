import { useState } from 'react';

import { useInventoryMutations, useInventoryUnits } from '../../../../api/hooks';
import { PlusIcon } from '../InventoryIcons';
import { invButtonSm, invField, invSeg, invSegAdd } from '../inventoryUi';

type Props = {
  /** Current unit name; null means 個. */
  value: string | null;
  onChange: (unit: string) => void;
  accessPassword: string;
  disabled?: boolean;
};


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
        <button key={unit.id} type="button" aria-pressed={unit.name === current} className={invSeg(unit.name === current)} disabled={disabled} onClick={() => onChange(unit.name)}>{unit.name}</button>
      ))}
      {adding ? (
        <span className="flex items-center gap-1.5">
          <input aria-label="新しい単位" placeholder="例: 箱" maxLength={20} className={`${invField} w-28`} value={name} onChange={(event) => setName(event.target.value)} />
          <button type="button" className={invButtonSm} disabled={!name.trim() || mutations.createUnit.isPending} onClick={() => void add()}>追加</button>
          <button type="button" className="text-[13px] text-inv-muted underline underline-offset-2" onClick={() => { setAdding(false); setName(''); setError(null); }}>やめる</button>
        </span>
      ) : (
        <button type="button" className={invSegAdd} disabled={disabled} onClick={() => setAdding(true)}><PlusIcon />新しい単位</button>
      )}
      {error ? <span className="text-sm text-[#ffb3b3]" role="alert">{error}</span> : null}
    </div>
  );
}
