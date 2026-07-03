import { useCallback, useEffect, useState } from 'react';

import { renameAssemblyProcedureDocument } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';

import { readAssemblyApiErrorMessage } from './assemblyUiHelpers';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentSummaryDto } from './types';

type Props = {
  isOpen: boolean;
  document: AssemblyProcedureDocumentSummaryDto | null;
  onClose: () => void;
  onSuccess: (document: AssemblyProcedureDocumentDto) => void;
};

export function AssemblyProcedureRenameModal({ isOpen, document, onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName(document?.name ?? '');
    setSubmitting(false);
    setError(null);
  }, [document?.name]);

  useEffect(() => {
    if (isOpen && document) resetForm();
  }, [document, isOpen, resetForm]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const disabled = submitting || trimmedName.length === 0 || trimmedName === document?.name.trim();

  const handleSubmit = async () => {
    if (!document || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await renameAssemblyProcedureDocument(document.id, trimmedName);
      onSuccess(updated);
    } catch (e: unknown) {
      setError(readAssemblyApiErrorMessage(e, '手順書名の変更に失敗しました。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="手順書名を変更"
      description="登録済み画像は変更しません。テンプレート上の表示名にも反映されます。"
      size="md"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
    >
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          手順書名
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={submitting} />
        </label>
        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            キャンセル
          </Button>
          <Button type="button" variant="primary" disabled={disabled} onClick={() => void handleSubmit()}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
