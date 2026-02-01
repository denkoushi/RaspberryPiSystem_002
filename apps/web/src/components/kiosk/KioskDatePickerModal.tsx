import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type KioskDatePickerModalProps = {
  isOpen: boolean;
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function KioskDatePickerModal({
  isOpen,
  value,
  onChange,
  onClear,
  onCancel,
  onConfirm
}: KioskDatePickerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">納期日</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="mb-4">
          <label htmlFor="due-date-picker" className="mb-2 block text-sm font-semibold text-slate-700">
            日付を選択
          </label>
          <input
            id="due-date-picker"
            type="date"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onClear}>
            Clear
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm}>
            OK
          </Button>
        </div>
      </Card>
    </div>
  );
}
