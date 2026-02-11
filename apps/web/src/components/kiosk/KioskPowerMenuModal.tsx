import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

type PowerAction = 'reboot' | 'poweroff';

type KioskPowerMenuModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (action: PowerAction) => void;
};

export function KioskPowerMenuModal({ isOpen, onClose, onSelect }: KioskPowerMenuModalProps) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} ariaLabel="電源操作" size="md">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">電源操作</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="text-slate-500 hover:text-slate-700"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => onSelect('reboot')}
          className="flex-1 bg-slate-700 text-white hover:bg-slate-600"
        >
          再起動
        </Button>
        <Button
          type="button"
          onClick={() => onSelect('poweroff')}
          className="flex-1 bg-red-600 text-white hover:bg-red-700"
        >
          シャットダウン
        </Button>
      </div>
    </Dialog>
  );
}
