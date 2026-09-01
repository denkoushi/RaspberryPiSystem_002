import { memoOverridesToArray } from './workInstructionEditorMemo';

import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';

function overlayReviewCount(controller: WorkInstructionEditorController): number {
  const rows = controller.rows ?? [];
  const hasRowOverlayProjection = rows.some((row) => row.draft?.overlays !== undefined
    || (row.draft?.steps?.some((step) => (step.overlays?.length ?? 0) > 0) ?? false)
    || row.draft?.migration?.needsReview !== undefined
    || row.migration?.needsReview !== undefined);
  if (!hasRowOverlayProjection) return (controller.group?.migration.needsReview ?? 0) + (controller.group?.migration.unassigned ?? 0);

  return rows.reduce((count, row) => {
    const overlays = row.draft?.overlays;
    if (overlays !== undefined) {
      return count + overlays.filter((overlay) => {
        const state = String(overlay.migrationState ?? '').toUpperCase();
        return state === 'NEEDS_REVIEW' || state === 'UNASSIGNED';
      }).length;
    }
    const nestedOverlays = row.draft?.steps?.flatMap((step) => step.overlays ?? []);
    if (nestedOverlays && nestedOverlays.length > 0) {
      return count + nestedOverlays.filter((overlay) => {
        const state = String(overlay.migrationState ?? '').toUpperCase();
        return state === 'NEEDS_REVIEW' || state === 'UNASSIGNED';
      }).length;
    }
    const summary = row.draft?.migration ?? row.migration;
    return count + (summary?.needsReview ?? 0) + (summary?.unassigned ?? 0);
  }, 0);
}

function unresolvedMemoOverride(override: { migrationState?: string; action?: string }): boolean {
  if (override.action === 'USE_SOURCE' || override.action === 'use-source') return false;
  const state = String(override.migrationState ?? '').toUpperCase();
  return state === 'NEEDS_REVIEW' || state === 'UNASSIGNED';
}

function memoReviewCount(controller: WorkInstructionEditorController): number {
  const rows = controller.rows ?? [];
  const currentOverridesByRevision = controller.memoOverridesByRevision ?? {};
  const hasCurrentMemoProjection = rows.some((row) => row.draft && Object.prototype.hasOwnProperty.call(currentOverridesByRevision, row.draft.id));
  const hasRowMemoProjection = hasCurrentMemoProjection || rows.some((row) => row.draft?.memoOverrides !== undefined || row.draft?.migration?.memo !== undefined || row.migration?.memo !== undefined);
  if (!hasRowMemoProjection) {
    return (controller.group?.migration.memo?.needsReview ?? 0) + (controller.group?.migration.memo?.unassigned ?? 0);
  }

  return rows.reduce((count, row) => {
    const currentOverrides = row.draft ? currentOverridesByRevision[row.draft.id] : undefined;
    if (currentOverrides !== undefined) {
      return count + memoOverridesToArray(currentOverrides).filter(unresolvedMemoOverride).length;
    }
    const overrides = row.draft?.memoOverrides;
    if (overrides !== undefined) {
      return count + overrides.filter(unresolvedMemoOverride).length;
    }
    const summary = row.draft?.migration?.memo ?? row.migration?.memo;
    return count + (summary?.needsReview ?? 0) + (summary?.unassigned ?? 0);
  }, 0);
}

export function WorkInstructionEditorToolbarStatus({ controller }: { controller: WorkInstructionEditorController }) {
  const statusLabel = controller.busy ? '処理中…' : controller.isDirty ? '未保存' : '保存済み';
  const statusClass = controller.busy
    ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
    : controller.isDirty
      ? 'border-amber-300/50 bg-amber-300/10 text-amber-100'
      : 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100';
  const reviewCount = overlayReviewCount(controller)
    + memoReviewCount(controller);

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
