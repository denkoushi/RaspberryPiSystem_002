import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';

export function WorkInstructionEditorToolbarStatus({ controller }: { controller: WorkInstructionEditorController }) {
  const statusLabel = controller.busy ? '処理中…' : controller.isDirty ? '未保存' : '保存済み';
  const statusClass = controller.busy
    ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
    : controller.isDirty
      ? 'border-amber-300/50 bg-amber-300/10 text-amber-100'
      : 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100';
  const reviewCount = (controller.group?.migration.needsReview ?? 0)
    + (controller.group?.migration.memo?.needsReview ?? 0);

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 text-xs" role="status" aria-live="polite" data-testid="work-instruction-editor-toolbar-status">
      <span className={`rounded border px-2 py-1 font-bold ${statusClass}`}>{statusLabel}</span>
      {reviewCount > 0 ? <span className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-amber-100">要確認 {reviewCount}</span> : null}
      {!controller.conflict && controller.message ? (
        <span
          className="max-w-[28rem] truncate text-white/80"
          data-testid="work-instruction-editor-toolbar-message"
          title={controller.message}
        >
          {controller.message}
        </span>
      ) : null}
    </div>
  );
}
