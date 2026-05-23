import { shelfMasterButtonClass, shelfMasterSelectClass, shelfMasterTheme } from '../theme/shelfMasterTheme';

import type { Zero2wAssignmentFlowGates } from '../flow/zero2wAssignmentFlow';
import type { DraftEntity } from '../model/shelfLayoutTypes';

type Zero2wDevice = {
  id: string;
  name: string;
  shelfCodeRaw: string | null;
};

type Props = {
  gates: Zero2wAssignmentFlowGates;
  devices: Zero2wDevice[];
  shelfEntities: DraftEntity[];
  selectedDeviceId: string;
  selectedShelf: string;
  savePending: boolean;
  onDeviceChange: (id: string, shelfFromDevice: string) => void;
  onShelfPick: (code: string) => void;
  onSave: () => void;
};

export function ShelfZero2wPanel({
  gates,
  devices,
  shelfEntities,
  selectedDeviceId,
  selectedShelf,
  savePending,
  onDeviceChange,
  onShelfPick,
  onSave
}: Props) {
  return (
    <div className={`${shelfMasterTheme.dock} max-w-lg`}>
      <label className="block text-xs font-semibold text-slate-300">Zero2W 端末</label>
      <select
        className={shelfMasterSelectClass(gates.deviceSelect, gates.emphasize === 'device')}
        value={selectedDeviceId}
        disabled={!gates.deviceSelect}
        onChange={(e) => {
          const dev = devices.find((d) => d.id === e.target.value);
          onDeviceChange(e.target.value, dev?.shelfCodeRaw ?? '');
        }}
      >
        <option value="">— 選択 —</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <label className="mt-2 block text-xs font-semibold text-slate-300">担当棚</label>
      <div
        className={
          gates.emphasize === 'shelf' && gates.shelfChips
            ? 'flex flex-wrap gap-2 rounded-lg p-1 ring-2 ring-sky-400/70 ring-offset-1 ring-offset-slate-900'
            : 'flex flex-wrap gap-2'
        }
      >
        {shelfEntities.map((s) => (
          <button
            key={s.shelfCodeRaw}
            type="button"
            disabled={!gates.shelfChips || !s.shelfCodeRaw}
            className={
              selectedShelf === s.shelfCodeRaw
                ? 'rounded-lg border-2 border-amber-500 bg-amber-950 px-2 py-1 text-xs font-bold text-amber-100'
                : `rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs ${!gates.shelfChips ? 'cursor-not-allowed opacity-30' : ''}`
            }
            onClick={() => s.shelfCodeRaw && onShelfPick(s.shelfCodeRaw)}
          >
            <div>{s.displayLabel ?? s.shelfCodeRaw}</div>
            <div className="font-mono text-[10px] text-sky-300">{s.shelfCodeRaw}</div>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={shelfMasterButtonClass(true, {
          enabled: gates.save,
          flow: gates.emphasize === 'save',
          variant: 'primary'
        })}
        disabled={!gates.save || savePending}
        onClick={onSave}
      >
        保存
      </button>
    </div>
  );
}
