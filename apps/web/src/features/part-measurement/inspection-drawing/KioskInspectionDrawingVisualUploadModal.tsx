import { useCallback, useEffect, useState } from 'react';

import { createPartMeasurementVisualTemplate } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import {
  PART_MEASUREMENT_DRAWING_FILE_ACCEPT,
  PART_MEASUREMENT_DRAWING_FILE_LABEL
} from '../partMeasurementDrawingFileInput';
import { partMeasurementDrawingPreviewConvertingLabel } from '../partMeasurementDrawingLocalPreview';
import { usePartMeasurementDrawingLocalPreview } from '../usePartMeasurementDrawingLocalPreview';

import { defaultVisualNameFromFileName } from './inspectionDrawingVisualLibraryHelpers';

import type { PartMeasurementVisualTemplateDto } from '../types';

type Props = {
  isOpen: boolean;
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

export function KioskInspectionDrawingVisualUploadModal({
  isOpen,
  clientKey,
  onClose,
  onSuccess
}: Props) {
  const [visualName, setVisualName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    localPreviewUrl,
    saveFile,
    previewResolving,
    previewError,
    pendingPreviewFile,
    hasLocalRenderablePreview,
    hasPendingLocalSelection,
    selectFile,
    reset: resetPreview
  } = usePartMeasurementDrawingLocalPreview(clientKey);

  const resetForm = useCallback(() => {
    setVisualName('');
    setNameTouched(false);
    setSubmitting(false);
    setError(null);
    resetPreview();
  }, [resetPreview]);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetPreview();
    onClose();
  }, [onClose, resetPreview, submitting]);

  const handleFileChange = (file: File | null) => {
    setError(null);
    if (!file) {
      selectFile(null);
      if (!nameTouched) {
        setVisualName('');
      }
      return;
    }
    if (!nameTouched) {
      setVisualName(defaultVisualNameFromFileName(file.name));
    }
    selectFile(file);
  };

  const registerBlocked =
    submitting ||
    previewResolving ||
    Boolean(previewError) ||
    !saveFile ||
    !hasLocalRenderablePreview ||
    (hasPendingLocalSelection && !saveFile);

  const handleRegister = async () => {
    if (registerBlocked || !saveFile) return;
    const name = visualName.trim() || defaultVisualNameFromFileName(saveFile.name);
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPartMeasurementVisualTemplate(name, saveFile, clientKey);
      onSuccess(result.visualTemplate);
      resetForm();
    } catch (e: unknown) {
      setError(readApiErrorMessage(e, '図面の登録に失敗しました。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="図面を登録"
      description="業務テンプレートに紐づけず、図面だけをライブラリへ保存します。後から新規作成で再利用できます。"
      size="lg"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
    >
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          図面名
          <Input
            value={visualName}
            onChange={(e) => {
              setNameTouched(true);
              setVisualName(e.target.value);
            }}
            placeholder="検索しやすい名前"
            disabled={submitting}
          />
        </label>

        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          {PART_MEASUREMENT_DRAWING_FILE_LABEL}
          <input
            type="file"
            accept={PART_MEASUREMENT_DRAWING_FILE_ACCEPT}
            className="text-sm"
            disabled={submitting}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
        </label>

        {previewResolving ? (
          <p className="text-sm text-slate-600">
            {partMeasurementDrawingPreviewConvertingLabel(pendingPreviewFile)}
          </p>
        ) : null}
        {previewError ? <p className="text-sm font-semibold text-red-600">{previewError}</p> : null}
        {localPreviewUrl ? (
          <div className="overflow-hidden rounded border border-slate-200 bg-slate-50 p-2">
            <img
              src={localPreviewUrl}
              alt="選択中の図面プレビュー"
              className="mx-auto max-h-48 w-auto object-contain"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            キャンセル
          </Button>
          <Button type="button" variant="primary" disabled={registerBlocked} onClick={() => void handleRegister()}>
            {submitting ? '登録中…' : '図面を登録'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
