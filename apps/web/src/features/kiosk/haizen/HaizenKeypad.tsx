import { invButtonPrimary, invKey, invKeyUtil } from '../inventory/inventoryUi';

const LETTER_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '-'];

type Props = {
  ariaLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmDisabled?: boolean;
  disabled?: boolean;
  onKey: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
};

export function HaizenKeypad({ ariaLabel, onConfirm, onClose, confirmDisabled = false, disabled = false, onKey, onBackspace, onClear }: Props) {
  return (
    <div role="group" aria-label={ariaLabel} className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {LETTER_KEYS.map(key => (
          <button key={key} type="button" disabled={disabled} className={`${invKey} h-11 min-w-11 text-base`} onClick={() => onKey(key)}>{key}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((key, index) => (
          <button key={key} type="button" disabled={disabled} style={{ gridRow: Math.floor(index / 3) + 1, gridColumn: index === 9 ? '1 / 3' : index % 3 + 1 }} className={invKey} onClick={() => onKey(key)}>{key}</button>
        ))}
        <button type="button" disabled={disabled} className={`${invKeyUtil} col-start-4 row-start-1`} onClick={onBackspace}>1字消す</button>
        <button type="button" disabled={disabled} className={`${invKeyUtil} col-start-4 row-start-2`} onClick={onClear}>全部消す</button>
        <button type="button" disabled={disabled || confirmDisabled} className={`${invButtonPrimary} col-start-4 row-start-3 row-span-2 !h-auto`} onClick={onConfirm}>探す</button>
        <button type="button" className={`${invKeyUtil} col-start-3 row-start-4`} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
