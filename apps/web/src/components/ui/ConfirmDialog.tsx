import { Button } from './Button';
import { Dialog } from './Dialog';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  confirmTarget?: string;
  buttonClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  tone = 'primary',
  confirmTarget,
  buttonClassName,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      description={description}
      size="md"
    >
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className={`flex-1 !text-slate-700 hover:!text-slate-900${buttonClassName ? ` ${buttonClassName}` : ''}`}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          data-kiosk-sop-target={confirmTarget}
          onClick={onConfirm}
          className={`${tone === 'danger' ? 'flex-1 bg-red-600 text-white hover:bg-red-700' : 'flex-1'}${buttonClassName ? ` ${buttonClassName}` : ''}`}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
