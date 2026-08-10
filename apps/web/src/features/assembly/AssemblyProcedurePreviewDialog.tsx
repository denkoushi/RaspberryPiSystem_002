import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import { assemblyProcedureDocumentPages } from './assemblyTemplateDraft';
import { assemblyProcedureStatusLabel } from './assemblyUiHelpers';
import { KioskDocumentPageImage } from './KioskDocumentPageImage';

import type { AssemblyProcedureDocumentDto } from './types';

type Props = {
  document: AssemblyProcedureDocumentDto | null;
  isOpen: boolean;
  onClose: () => void;
  onPublish?: (document: AssemblyProcedureDocumentDto) => Promise<AssemblyProcedureDocumentDto>;
  onCreateTemplate?: (document: AssemblyProcedureDocumentDto) => void;
};

export function AssemblyProcedurePreviewDialog({
  document,
  isOpen,
  onClose,
  onPublish,
  onCreateTemplate
}: Props) {
  const [currentDocument, setCurrentDocument] = useState<AssemblyProcedureDocumentDto | null>(document);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentDocument(document);
    setError(null);
  }, [document, isOpen]);

  if (!currentDocument) return null;
  const pages = assemblyProcedureDocumentPages(currentDocument);
  const isDraft = currentDocument.status === 'draft';

  const handlePublish = async () => {
    if (!onPublish || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCurrentDocument(await onPublish(currentDocument));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '手順書の公開に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={busy ? () => undefined : onClose}
      title={`手順書の内容確認 — ${currentDocument.name}`}
      description={`${assemblyProcedureStatusLabel(currentDocument.status)}・${pages.length}ページ。全ページを確認してから次へ進んでください。`}
      size="full"
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
    >
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200 bg-slate-100 p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            {pages.map((page) => (
              <figure key={page.pageIndex} className="rounded border border-slate-300 bg-white p-2 shadow-sm">
                <figcaption className="mb-2 text-sm font-bold text-slate-700">{page.pageIndex + 1}ページ目</figcaption>
                <KioskDocumentPageImage
                  pageUrl={page.imageRelativePath}
                  alt={`${currentDocument.name} ${page.pageIndex + 1}ページ目`}
                  className="max-h-[62vh] w-full object-contain"
                  loadingFallback={<p className="p-6 text-center text-sm text-slate-500">画像を読み込み中…</p>}
                  errorFallback={<p className="p-6 text-center text-sm text-red-600">画像を読み込めません。</p>}
                />
              </figure>
            ))}
          </div>
        </div>
        {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {isDraft && onPublish ? (
            <Button data-kiosk-sop-target="assembly-procedure-publish" type="button" variant="primary" className="min-h-11" disabled={busy} onClick={() => void handlePublish()}>
              {busy ? '公開中…' : '確認して公開'}
            </Button>
          ) : null}
          {!isDraft && onCreateTemplate ? (
            <Button data-kiosk-sop-target="assembly-template-create-from-procedure" type="button" variant="primary" className="min-h-11" onClick={() => onCreateTemplate(currentDocument)}>
              この手順書でテンプレートを新規作成
            </Button>
          ) : null}
          <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
