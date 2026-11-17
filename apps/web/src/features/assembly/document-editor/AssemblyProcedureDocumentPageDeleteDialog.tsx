import { useRef } from 'react';

import { Dialog } from '../../../components/ui/Dialog';

import { AssemblyProcedureDocumentEditorPagePreview } from './AssemblyProcedureDocumentEditorPageList';

import type { AssemblyProcedureDocumentPageDto, AssemblyProcedureOverlayAssetDto } from '../types';

export function AssemblyProcedureDocumentPageDeleteDialog({ page, assets, disabled, onClose, onDelete }: {
  page: AssemblyProcedureDocumentPageDto;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  disabled: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <Dialog isOpen title={`${page.pageIndex + 1}ページ目を削除`} onClose={onClose} initialFocusRef={cancelRef}
    className="!max-w-[520px] !rounded-[14px]" overlayClassName="!items-center">
    <div className="my-5 w-[120px]"><AssemblyProcedureDocumentEditorPagePreview page={page} assets={assets} /></div>
    <div className="flex justify-end gap-3">
      <button ref={cancelRef} type="button" className="rounded-lg border border-slate-300 px-5 py-3 font-semibold" onClick={onClose}>やめる</button>
      <button type="button" disabled={disabled} className="rounded-lg bg-red-600 px-5 py-3 font-bold text-white disabled:opacity-40" onClick={onDelete}>削除する</button>
    </div>
  </Dialog>;
}
