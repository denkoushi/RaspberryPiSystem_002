import { Button, buttonClassName } from '../../../components/ui/Button';

export function AssemblyProcedureDocumentEditorCanvasToolbar({
  documentName,
  pageIndex,
  pageCount,
  selectionMode,
  dirty,
  busy,
  readOnly,
  canSave,
  canPublish,
  canDiscard,
  onBack,
  onToggleSelection,
  onSave,
  onPublish,
  onDiscard
}: {
  documentName: string;
  pageIndex: number;
  pageCount: number;
  selectionMode: boolean;
  dirty: boolean;
  busy: boolean;
  readOnly: boolean;
  canSave: boolean;
  canPublish: boolean;
  canDiscard: boolean;
  onBack: () => void;
  onToggleSelection: () => void;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
}) {
  return (
    <header className="grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/10 bg-slate-900/90 px-2 py-1 xl:min-h-14 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{documentName}</p>
        <p className="truncate text-xs text-white/55">
          {pageIndex + 1}/{pageCount}ページ · {dirty ? '未保存あり' : '保存済み'}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <Button
          type="button"
          data-kiosk-sop-target="assembly-document-editor-range-add"
          variant={selectionMode ? 'primary' : 'ghostOnDark'}
          className="min-h-11 !px-2 text-xs"
          disabled={readOnly || busy}
          aria-pressed={selectionMode}
          onClick={onToggleSelection}
        >
          {selectionMode ? '範囲選択中' : '範囲を追加'}
        </Button>
        <Button
          type="button"
          data-kiosk-sop-target="assembly-document-editor-save"
          variant="primary"
          className="min-h-11 !px-2 text-xs"
          disabled={readOnly || busy || !canSave}
          onClick={onSave}
        >
          {busy ? '処理中…' : '保存'}
        </Button>
        <Button
          type="button"
          data-kiosk-sop-target="assembly-document-editor-publish"
          variant="primary"
          className="min-h-11 !px-2 text-xs"
          disabled={readOnly || busy || !canPublish}
          onClick={onPublish}
        >
          公開
        </Button>
      </div>
      <div className="flex justify-end gap-1 xl:col-auto">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 !px-2 text-xs"
          disabled={readOnly || busy || !canDiscard}
          onClick={onDiscard}
        >
          改版を破棄
        </Button>
        <Button type="button" variant="ghostOnDark" className={buttonClassName('ghostOnDark', 'min-h-11 !px-2 text-xs')} onClick={onBack}>
          一覧へ
        </Button>
      </div>
    </header>
  );
}
