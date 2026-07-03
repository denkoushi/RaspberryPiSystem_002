import { useCallback, useEffect, useState } from 'react';

import { uploadAssemblyProcedureDocument } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';

import { readAssemblyApiErrorMessage } from './assemblyUiHelpers';

import type { AssemblyProcedureDocumentDto } from './types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (document: AssemblyProcedureDocumentDto) => void;
};

export function AssemblyProcedureUploadModal({ isOpen, onClose, onSuccess }: Props) {
  const [name, setName] = useState('組立手順書');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('組立手順書');
    setFile(null);
    setSubmitting(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const disabled = submitting || trimmedName.length === 0 || file == null;

  const handleSubmit = async () => {
    if (!file || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const document = await uploadAssemblyProcedureDocument({ name: trimmedName, file });
      onSuccess(document);
    } catch (e: unknown) {
      setError(readAssemblyApiErrorMessage(e, '手順書の登録に失敗しました。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="手順書を登録"
      description="PDF、画像、TIFFの1ページ目を組立手順書として登録します。"
      size="md"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
    >
      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          手順書名
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={submitting} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          ファイル
          <input
            className="w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff,image/*,application/pdf"
            disabled={submitting}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            キャンセル
          </Button>
          <Button type="button" variant="primary" disabled={disabled} onClick={() => void handleSubmit()}>
            {submitting ? '登録中…' : '登録'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
