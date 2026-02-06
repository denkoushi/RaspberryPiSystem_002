import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type PowerAction = 'reboot' | 'poweroff';

type KioskPowerConfirmModalProps = {
  isOpen: boolean;
  action: PowerAction;
  isProcessing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const actionCopy: Record<PowerAction, { title: string; description: string; confirmLabel: string }> = {
  reboot: {
    title: '端末を再起動しますか？',
    description: '再起動すると、しばらく画面が表示されません。',
    confirmLabel: '再起動'
  },
  poweroff: {
    title: '端末をシャットダウンしますか？',
    description: 'シャットダウンすると、電源を入れるまで画面は戻りません。',
    confirmLabel: 'シャットダウン'
  }
};

export function KioskPowerConfirmModal({
  isOpen,
  action,
  isProcessing,
  onCancel,
  onConfirm
}: KioskPowerConfirmModalProps) {
  if (!isOpen) return null;

  const copy = actionCopy[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-900">{copy.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{copy.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1 !text-slate-700 hover:!text-slate-900"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
          >
            {isProcessing ? '実行中...' : copy.confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
