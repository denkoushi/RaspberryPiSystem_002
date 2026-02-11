import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

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
  const copy = actionCopy[action];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={copy.title}
      description={copy.description}
      size="md"
    >
      <div className="mt-4 flex gap-2">
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
    </Dialog>
  );
}
