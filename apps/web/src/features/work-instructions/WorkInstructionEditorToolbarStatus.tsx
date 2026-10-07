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

export function WorkInstructionEditorToolbarStatus({ controller, onReview }: { controller: WorkInstructionEditorController; onReview?: () => void }) {
  const statusLabel = controller.busy ? '処理中…' : controller.isDirty ? '未保存' : '保存済み';
  const reviewCount = controller.reviewCount ?? overlayReviewCount(controller) + memoReviewCount(controller);
  return <div className="flex max-w-full flex-wrap items-center gap-2 text-[15px] xl:shrink-0 xl:flex-nowrap" data-testid="work-instruction-editor-toolbar-status"><span role="status" aria-live="polite" className={`flex h-11 items-center rounded-lg border border-[#344252] bg-[#161c22eb] px-3 ${controller.busy ? 'text-[#9fadb9]' : controller.isDirty ? 'text-[#f6b93b]' : 'text-[#3ba776]'}`}>{statusLabel}</span>{reviewCount > 0 ? <button type="button" aria-label="次の要確認へ" title="次の要確認へ" onClick={onReview ?? controller.nextReview} className="h-11 rounded-lg border border-[#344252] bg-[#161c22eb] px-3 text-[#f6b93b] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#5fc3e8]">要確認 {reviewCount}</button> : null}</div>;
}
