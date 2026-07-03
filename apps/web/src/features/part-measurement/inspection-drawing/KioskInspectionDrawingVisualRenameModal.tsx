import { useCallback, useEffect, useState } from 'react';

import { updatePartMeasurementVisualTemplateName } from '../../../api/client';
import { Dialog } from '../../../components/ui/Dialog';
import {
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskInputClassName
} from '../../../features/kiosk/kioskTheme';

import {
  inspectionDrawingKioskDialogClassName,
  inspectionDrawingKioskDialogTitleClassName
} from './inspectionDrawingKioskUi';

import type { PartMeasurementVisualTemplateDto } from '../types';

type Props = {
  isOpen: boolean;
  visual: PartMeasurementVisualTemplateDto | null;
  clientKey?: string;
  onClose: () => void;
  onSuccess: (visual: PartMeasurementVisualTemplateDto) => void;
};

function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

export function KioskInspectionDrawingVisualRenameModal({
  isOpen,
  visual,
  clientKey,
  onClose,
  onSuccess
}: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName(visual?.name ?? '');
    setSubmitting(false);
    setError(null);
  }, [visual?.name]);

  useEffect(() => {
    if (isOpen && visual) {
      resetForm();
    }
  }, [isOpen, resetForm, visual]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const saveDisabled = submitting || trimmedName.length === 0 || trimmedName === visual?.name.trim();

  const handleSave = async () => {
    if (!visual || saveDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updatePartMeasurementVisualTemplateName(visual.id, trimmedName, clientKey);
      onSuccess(updated);
    } catch (e: unknown) {
      setError(readApiErrorMessage(e, '図面名の変更に失敗しました。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="図面名を変更"
      description="図面ファイルは変更しません。この図面を参照している既存テンプレートの表示名にも反映されます。"
      size="md"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
      className={inspectionDrawingKioskDialogClassName}
      titleClassName={inspectionDrawingKioskDialogTitleClassName}
    >
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-semibold text-white/80">
          図面名
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="検索しやすい名前"
            disabled={submitting}
            maxLength={200}
            className={kioskInputClassName}
          />
        </label>

        {error ? <p className="text-sm font-semibold text-red-300">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={kioskButtonSecondaryClassName}
            disabled={submitting}
            onClick={handleClose}
          >
            キャンセル
          </button>
          <button
            type="button"
            className={kioskButtonPrimaryClassName}
            disabled={saveDisabled}
            onClick={() => void handleSave()}
          >
            {submitting ? '保存中…' : '名称を保存'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
