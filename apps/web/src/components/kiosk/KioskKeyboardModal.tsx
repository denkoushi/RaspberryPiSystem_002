import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type KioskKeyboardModalProps = {
  isOpen: boolean;
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const LETTER_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z']
];
const MAX_LENGTH = 100;

export function KioskKeyboardModal({
  isOpen,
  value,
  onChange,
  onCancel,
  onConfirm
}: KioskKeyboardModalProps) {
  if (!isOpen) return null;

  const appendKey = (key: string) => {
    if (value.length >= MAX_LENGTH) return;
    onChange(`${value}${key}`.slice(0, MAX_LENGTH));
  };

  const handleBackspace = () => {
    if (value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const handleClear = () => {
    onChange('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">キーボード入力</h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900">
          {value || ' '}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-10 gap-2">
            {NUMBER_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="rounded-md border border-slate-300 bg-white py-2 text-center text-base font-semibold text-slate-900 hover:bg-slate-100"
                onClick={() => appendKey(key)}
              >
                {key}
              </button>
            ))}
          </div>

          {LETTER_ROWS.map((row, index) => (
            <div key={`row-${index}`} className="grid grid-cols-10 gap-2">
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="rounded-md border border-slate-300 bg-white py-2 text-center text-base font-semibold text-slate-900 hover:bg-slate-100"
                  onClick={() => appendKey(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleBackspace}>
            Backspace
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear}>
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
