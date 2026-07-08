import { useCallback, useEffect, useState } from 'react';

import { uploadAssemblyProcedureDocument } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';

import { assemblyProcedureDocumentPages } from './assemblyTemplateDraft';
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
  const [importedDocument, setImportedDocument] = useState<AssemblyProcedureDocumentDto | null>(null);

  const resetForm = useCallback(() => {
    setName('組立手順書');
    setFile(null);
    setSubmitting(false);
    setError(null);
    setImportedDocument(null);
  }, []);

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, resetForm]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    if (importedDocument) {
      onSuccess(importedDocument);
      return;
    }
    onClose();
  }, [importedDocument, onClose, onSuccess, submitting]);

  const trimmedName = name.trim();
  const disabled = submitting || trimmedName.length === 0 || file == null;

  const handleSubmit = async () => {
    if (!file || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const document = await uploadAssemblyProcedureDocument({ name: trimmedName, file });
      setImportedDocument(document);
    } catch (e: unknown) {
      setError(readAssemblyApiErrorMessage(e, '手順書の登録に失敗しました。'));
    } finally {
      setSubmitting(false);
    }
  };

  const importedPages = importedDocument ? assemblyProcedureDocumentPages(importedDocument) : [];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={importedDocument ? 'インポート完了' : '手順書を登録'}
      description={
        importedDocument
          ? '下書きとして保存しました。ライブラリから公開すると使用開始できます。'
          : 'PDF・画像・TIFFをインポートします（最大40ページ）。登録後は下書きです。'
      }
      size="md"
      closeOnEsc={!submitting}
      closeOnBackdrop={!submitting}
    >
      {importedDocument ? (
        <div className="mt-4 grid gap-4">
          <p className="text-sm font-semibold text-slate-800">
            「{importedDocument.name}」を {importedPages.length} ページ登録しました（下書き）。
          </p>
          {importedPages.length > 1 ? (
            <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
              <p className="mb-2 text-xs font-semibold text-slate-600">インポートページ一覧</p>
              <ul className="grid gap-1 text-sm text-slate-800">
                {importedPages.map((page) => (
                  <li key={page.pageIndex} className="rounded bg-white px-2 py-1">
                    {page.pageIndex + 1}ページ目
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-sm text-slate-600">次のステップ: ライブラリで「公開」→ テンプレートまたは表示順設定で使用</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="primary" onClick={handleClose}>
              ライブラリへ
            </Button>
          </div>
        </div>
      ) : (
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
              {submitting ? '登録中…' : 'インポート'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
