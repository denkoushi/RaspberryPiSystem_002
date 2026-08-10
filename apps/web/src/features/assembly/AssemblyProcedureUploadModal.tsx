import { useCallback, useEffect, useState } from 'react';

import { previewAssemblyProcedureDocument, uploadAssemblyProcedureDocument } from '../../api/client';
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
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewedFile, setPreviewedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setNameEdited(false);
    setFile(null);
    setSubmitting(false);
    setPreviewing(false);
    setPreviewUrl(null);
    setPreviewedFile(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm]);

  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const trimmedName = name.trim();
  const previewReady = file != null && previewedFile === file && previewUrl != null;
  const disabled = submitting || previewing || trimmedName.length === 0 || file == null || !previewReady;

  const handleFileChange = (nextFile: File | null) => {
    setFile(nextFile);
    setPreviewedFile(null);
    setPreviewUrl(null);
    setError(null);
    if (!nameEdited && nextFile) {
      setName(nextFile.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handlePreview = async () => {
    if (!file || previewing || submitting) return;
    setPreviewing(true);
    setError(null);
    setPreviewedFile(null);
    setPreviewUrl(null);
    try {
      const blob = await previewAssemblyProcedureDocument(file);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewedFile(file);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '手順書のプレビューに失敗しました。');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    if (!file || !previewReady || disabled) return;
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
      description="PDF・画像・TIFFをインポートします（最大40ページ）。登録前に先頭ページを確認し、登録後は全ページを確認できます。"
      size="md"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
    >
      <div className="mt-4 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-800">
            手順書名
            <Input
              value={name}
              onChange={(e) => {
                setNameEdited(true);
                setName(e.target.value);
              }}
              maxLength={200}
              disabled={submitting || previewing}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-800">
            ファイル
            <input
              className="w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff,image/*,application/pdf"
              disabled={submitting}
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs font-semibold text-slate-600">登録前に先頭ページを確認します。PDFの全ページは登録後に確認できます。</p>
          {previewUrl ? (
            <div className="rounded border border-slate-300 bg-slate-50 p-2">
              <p className="mb-2 text-sm font-bold text-slate-700">先頭ページのプレビュー</p>
              <img src={previewUrl} alt="手順書の先頭ページプレビュー" className="max-h-64 w-full object-contain" />
            </div>
          ) : null}
          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" className="min-h-11" disabled={submitting || previewing} onClick={handleClose}>
              キャンセル
            </Button>
            <Button data-kiosk-sop-target="assembly-procedure-preview-file" type="button" variant="secondary" className="min-h-11" disabled={!file || submitting || previewing} onClick={() => void handlePreview()}>
              {previewing ? '確認中…' : '先頭ページを確認'}
            </Button>
            <Button data-kiosk-sop-target="assembly-procedure-register-draft" type="button" variant="primary" className="min-h-11" disabled={disabled} onClick={() => void handleSubmit()}>
              {submitting ? '登録中…' : '下書きとして登録'}
            </Button>
          </div>
      </div>
    </Dialog>
  );
}
