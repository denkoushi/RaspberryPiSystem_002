import { useEffect, useMemo, useState } from 'react';

import { listProcedureMaterials } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { ProcedureMaterialShelfDialog } from '../procedure-manuals/ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from '../procedure-manuals/ProcedureVideoShelfDialog';

import { AssemblyProcedureDocumentEditorAuthGate } from './AssemblyProcedureDocumentEditorAuthGate';
import { AssemblyProcedureDocumentEditorCanvas } from './AssemblyProcedureDocumentEditorCanvas';
import { AssemblyProcedureDocumentEditorCanvasToolbar } from './AssemblyProcedureDocumentEditorCanvasToolbar';
import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';
import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';
import { AssemblyProcedureDocumentEditorPartsPane } from './AssemblyProcedureDocumentEditorPartsPane';
import { AssemblyProcedureDocumentPublishDialog } from './AssemblyProcedureDocumentPublishDialog';
import { AssemblyProcedureOverlayTypeDialog } from './AssemblyProcedureOverlayTypeDialog';
import { AssemblyProcedureTextCandidateDialog } from './AssemblyProcedureTextCandidateDialog';

export function AssemblyProcedureDocumentEditorScreen({ context, onNavigateToDocument }: { context?: import('../types').ProcedureManualEditorContext; onNavigateToDocument: (documentId: string) => void }) {
  const controller = useAssemblyProcedureDocumentEditor();
  const [partsPaneOpen, setPartsPaneOpen] = useState(() => {
    try { return localStorage.getItem('assembly-document-editor-parts-pane') !== 'closed'; }
    catch { return true; }
  });
  const [hiddenOverlayIds, setHiddenOverlayIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setHiddenOverlayIds(new Set());
  }, [controller.selectedPageIndex, controller.document?.id]);
  const togglePartsPane = () => {
    const open = !partsPaneOpen;
    setPartsPaneOpen(open);
    try { localStorage.setItem('assembly-document-editor-parts-pane', open ? 'open' : 'closed'); }
    catch { /* The editor remains usable when local storage is unavailable. */ }
  };
  const toggleHidden = (id: string) => {
    const hidden = hiddenOverlayIds.has(id);
    setHiddenOverlayIds(current => {
      const next = new Set(current);
      if (hidden) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!hidden) controller.setSelectedOverlayId(null);
  };
  const [materialShelfOpen, setMaterialShelfOpen] = useState(false);
  const [materialShelfMode, setMaterialShelfMode] = useState<'place' | 'replace'>('place');
  const [materialCount, setMaterialCount] = useState<number | null>(null);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!controller.accessGranted) return;
    let cancelled = false;
    void listProcedureMaterials({ state: 'unplaced', limit: 500 }).then(rows => { if (!cancelled) setMaterialCount(rows.length); }).catch(() => { if (!cancelled) setMaterialCount(null); });
    return () => { cancelled = true; };
  }, [controller.accessGranted, materialShelfOpen]);
  useEffect(() => {
    setDismissedMessage(null);
    if (!controller.message || controller.messageIsError || controller.conflict || controller.busy) return;
    const timer = window.setTimeout(() => setDismissedMessage(controller.message), 4000);
    return () => window.clearTimeout(timer);
  }, [controller.message, controller.messageIsError, controller.conflict, controller.busy]);
  const [videoLinkOpen, setVideoLinkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [conflictReloadOpen, setConflictReloadOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);

  useEffect(() => {
    if (controller.recoveryPending) setRecoveryOpen(true);
  }, [controller.recoveryPending]);

  const pages = useMemo(
    () => controller.pages.map((page) => ({
      ...page,
      overlays: controller.elements.filter((element) => element.pageIndex === page.pageIndex)
    })),
    [controller.elements, controller.pages]
  );
  const selectedPage = controller.selectedPage;

  if (!controller.accessGranted || controller.loading) {
    return <AssemblyProcedureDocumentEditorAuthGate context={context} />;
  }

  if (!selectedPage) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 p-4 text-white" role="alert">
        手順書ページがありません。
      </main>
    );
  }

  return (
    <main className={`relative grid min-h-0 flex-1 ${partsPaneOpen ? 'grid-cols-[120px_280px_minmax(0,1fr)_64px]' : 'grid-cols-[120px_0_minmax(0,1fr)_64px]'} overflow-hidden bg-[#0a0d10] text-[#eef3f6]`} data-testid="assembly-document-editor-layout">
      {controller.document?.status === 'draft' && (!controller.editLeaseMine || controller.editLeaseUnavailable) ? (
        <div className="absolute bottom-16 left-[136px] z-50 flex max-w-[calc(100%-216px)] flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-[#161c22] px-3 py-2" role="status">
          <p className="text-sm font-semibold text-amber-100">
            {controller.editLeaseUnavailable
              ? '編集の予約を取れていません(他端末と同時編集に注意)'
              : controller.editLease
              ? `${controller.editLease.holderLabel}が編集中(${new Date(controller.editLease.acquiredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜)`
              : controller.editLeasePending ? '編集の予約を確認中…' : '編集の予約を取得できていません。'}
          </p>
          <Button type="button" variant="ghostOnDark" className="min-h-11" disabled={controller.editLeasePending || controller.busy} onClick={() => controller.editLease && !controller.editLeaseUnavailable ? setTakeoverOpen(true) : void controller.retryEditLease()}>
            {controller.editLease && !controller.editLeaseUnavailable ? '引き継ぐ' : '予約を再取得'}
          </Button>
        </div>
      ) : null}
      {videoLinkOpen && controller.document ? <ProcedureVideoShelfDialog key={`${controller.document.id}:${selectedPage.pageIndex}`} link={{ documentId: controller.document.id, pageIndex: selectedPage.pageIndex, accessPassword: controller.passwordInput, holderToken: controller.editLeaseToken }} onError={controller.onEditLeaseError} onClose={() => setVideoLinkOpen(false)} /> : null}
        <AssemblyProcedureDocumentEditorPageList
          pages={pages}
          assets={controller.document?.assets}
          selectedPageIndex={selectedPage.pageIndex}
          onSelect={controller.setSelectedPageIndex}
          onAddBlankPage={() => void controller.addBlankPage()}
          disabled={controller.readOnly || controller.busy || controller.conflict}
        />
        {partsPaneOpen ? <AssemblyProcedureDocumentEditorPartsPane
          elements={controller.elements}
          pageIndex={selectedPage.pageIndex}
          onDuplicate={controller.duplicateOverlayToCurrentPage}
          assets={controller.document?.assets}
          selectedOverlayId={controller.selectedOverlayId}
          hiddenOverlayIds={hiddenOverlayIds}
          onSelect={controller.setSelectedOverlayId}
          onBringForward={controller.bringForward}
          onSendBackward={controller.sendBackward}
          onToggleHidden={toggleHidden}
          readOnly={controller.readOnly}
          busy={controller.busy}
        /> : null}
        <button type="button" aria-label={partsPaneOpen ? '部品を閉じる' : '部品を開く'} onClick={togglePartsPane} className={`absolute top-1/2 z-50 grid h-[72px] w-[22px] -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-[#344252] bg-[#161c22] text-[#9fadb9] ${partsPaneOpen ? 'left-[400px]' : 'left-[120px]'}`}>
          <span aria-hidden="true">{partsPaneOpen ? '<' : '>'}</span>
        </button>
        <section className={`relative col-start-3 min-h-0 min-w-0 overflow-hidden p-4 ${controller.selectedElement ? 'pr-[372px]' : ''}`} aria-label="手順書キャンバス">
          <AssemblyProcedureDocumentEditorCanvas
            pageUrl={selectedPage.imageRelativePath}
            pageIndex={selectedPage.pageIndex}
            elements={controller.selectedPageElements.filter(element => !hiddenOverlayIds.has(element.id))}
            selectionMode={controller.selectionMode}
            editable={!controller.readOnly}
            selectedOverlayId={controller.selectedOverlayId}
            onSelectOverlay={controller.setSelectedOverlayId}
            onNudgeOverlay={controller.nudgeElement}
            onUpdateOverlayBBox={controller.updateElementBBox}
            onInteractionStart={controller.beginOverlayDrag}
            onInteractionEnd={controller.endOverlayDrag}
            onRangeSelected={controller.handleRangeSelected}
            assets={controller.document?.assets}
            className="h-full w-full !bg-[#0a0d10]"
          />
          <div className="absolute left-4 top-3 z-40 flex h-9 max-w-[70%] items-center gap-2.5 rounded-lg border border-[#344252] bg-[#161c22d9] px-3 text-lg text-[#9fadb9]">
            <b className="truncate text-[#eef3f6]">{context ? [context.modelCode, context.processName, controller.document?.name ?? '要領書'].filter(Boolean).join(' › ') : controller.document?.name ?? '手順書'}</b>
            {context ? <span className={`inline-flex h-[26px] shrink-0 items-center rounded-full border px-2.5 text-[15px] font-bold ${context.mode === 'make' ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'}`}>
              {context.mode === 'make' ? '作る' : '直す'} · {controller.document?.supersedesDocumentId ? '改版の下書き' : '下書き'} 第{controller.document?.revisionNumber ?? 1}版
            </span> : null}
          </div>
          {controller.document?.lastApproval ? <p className="absolute bottom-16 left-4 rounded bg-[#161c22eb] px-3 py-1 text-xs text-[#9fadb9]">
            承認: {controller.document.lastApproval.employeeName}{controller.document.lastApproval.positionName ? `(${controller.document.lastApproval.positionName})` : ''} {new Date(controller.document.lastApproval.approvedAt).toLocaleString('ja-JP')}
          </p> : null}
          {controller.message && controller.message !== dismissedMessage ? (
            <div className={`absolute bottom-4 left-4 z-40 flex min-h-11 ${controller.selectedElement ? 'max-w-[calc(100%-404px)]' : 'max-w-[calc(100%-32px)]'} flex-col justify-center rounded-lg border px-3.5 py-2 text-lg ${controller.messageIsError || controller.conflict ? 'border-[#e5484d] bg-[#161c22eb] text-[#e5484d]' : 'border-[#344252] bg-[#161c22eb]'}`} role={controller.messageIsError || controller.conflict ? 'alert' : 'status'}>
              <p className="flex items-center gap-2.5"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${controller.messageIsError || controller.conflict ? 'bg-[#e5484d]' : 'bg-[#3ba776]'}`} />{controller.message}</p>
              {controller.conflict ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" data-kiosk-sop-target="assembly-document-editor-conflict-reload" variant="ghostOnDark" className="min-h-11 !px-2 text-xs" disabled={controller.busy} onClick={() => setConflictReloadOpen(true)}>
                    最新を再読込（保持内容を破棄）
                  </Button>
                  <Button type="button" data-kiosk-sop-target="assembly-document-editor-conflict-retry" variant="primary" className="min-h-11 !px-2 text-xs" disabled={controller.busy || controller.conflictEditVersion == null} onClick={() => void controller.retryConflictSave()}>
                    保持内容を再保存
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <AssemblyProcedureDocumentEditorCanvasToolbar controller={controller} workshop={Boolean(context)} materialCount={materialCount} materialOpen={materialShelfOpen} videoOpen={videoLinkOpen}
          onMaterial={() => { setMaterialShelfMode('place'); setMaterialShelfOpen(true); }} onVideo={() => setVideoLinkOpen(true)} onPublish={() => setPublishOpen(true)} onDelete={() => setDeleteOpen(true)} onDiscard={() => setDiscardOpen(true)} />
        {controller.selectedElement ? <div className="absolute right-20 top-4 z-50 max-h-[calc(100%-32px)] w-[340px] overflow-auto rounded-[14px] border border-[#344252] bg-[#161c22f5] p-4">
        <AssemblyProcedureDocumentEditorInspector
          element={controller.selectedElement}
          onClose={() => controller.setSelectedOverlayId(null)}
          onDuplicate={controller.duplicateSelectedOverlay}
          onUpdate={controller.updateElement}
          onDelete={controller.deleteSelectedOverlay}
          onBringForward={controller.bringForward}
          onSendBackward={controller.sendBackward}
          onBringToFront={controller.bringToFront}
          onSendToBack={controller.sendToBack}
          onReplaceImage={() => { setMaterialShelfMode('replace'); setMaterialShelfOpen(true); }}
          onRefetchTextCandidates={() => void controller.refetchTextCandidates()}
          readOnly={controller.readOnly}
          busy={controller.busy}
        />
        </div> : null}

      {materialShelfOpen ? <ProcedureMaterialShelfDialog mode={materialShelfMode} onClose={() => setMaterialShelfOpen(false)} onSelect={materialShelfMode === 'replace' ? controller.replaceSelectedImageMaterial : controller.placeMaterial} onCreatedDocument={(documentId) => {
        setMaterialShelfOpen(false);
        if (controller.confirmNavigation()) onNavigateToDocument(documentId);
      }} /> : null}
      <AssemblyProcedureOverlayTypeDialog
        isOpen={controller.pendingRange != null}
        onClose={controller.cancelPendingRange}
        onSelect={controller.createOverlay}
      />
      <AssemblyProcedureTextCandidateDialog
        isOpen={controller.textCandidates.length > 0}
        candidates={controller.textCandidates}
        onSelect={controller.chooseTextCandidate}
        onManual={() => controller.chooseTextCandidate(null)}
        onClose={controller.cancelTextCandidates}
      />
      {publishOpen ? <AssemblyProcedureDocumentPublishDialog
        busy={controller.busy}
        error={controller.message}
        onPublish={controller.publish}
        onClose={() => setPublishOpen(false)}
      /> : null}
      <ConfirmDialog
        isOpen={takeoverOpen}
        title="編集を引き継ぐ"
        description={`${controller.editLease?.holderLabel ?? '他の端末'}の編集予約を引き継ぎます。相手の未保存の内容は相手の端末に保持されます。`}
        confirmLabel="引き継ぐ"
        cancelLabel="戻る"
        onConfirm={() => {
          setTakeoverOpen(false);
          void controller.takeoverEditLease();
        }}
        onCancel={() => setTakeoverOpen(false)}
      />
      <ConfirmDialog
        isOpen={conflictReloadOpen}
        title="最新内容を再読込"
        description="現在保持している未保存内容を破棄し、サーバーの最新内容へ置き換えます。"
        confirmLabel="最新内容へ置換"
        cancelLabel="戻る"
        tone="danger"
        onConfirm={() => {
          setConflictReloadOpen(false);
          void controller.reloadConflict();
        }}
        onCancel={() => setConflictReloadOpen(false)}
      />
      <ConfirmDialog
        isOpen={deleteOpen}
        title="要領書を削除"
        description="この要領書を削除します。元に戻せません"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => { setDeleteOpen(false); void controller.deleteDocument(); }}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        isOpen={discardOpen}
        title="改版を破棄"
        description="この改版下書きを破棄します。保存済みの元版は変更されません。"
        confirmLabel="改版を破棄"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => {
          setDiscardOpen(false);
          void controller.discard();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
      <ConfirmDialog
        isOpen={recoveryOpen && controller.recoveryPending != null}
        title="端末に残った下書き"
        description="前回の編集途中データがあります。復元してから保存できます。"
        confirmLabel="復元"
        cancelLabel="破棄"
        onConfirm={() => {
          setRecoveryOpen(false);
          controller.restoreRecovery();
        }}
        onCancel={() => {
          setRecoveryOpen(false);
          controller.discardRecovery();
        }}
      />
    </main>
  );
}
