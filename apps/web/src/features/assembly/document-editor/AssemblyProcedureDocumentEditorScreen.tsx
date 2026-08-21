import { useEffect, useMemo, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

import { AssemblyProcedureDocumentEditorAuthGate } from './AssemblyProcedureDocumentEditorAuthGate';
import { AssemblyProcedureDocumentEditorCanvas } from './AssemblyProcedureDocumentEditorCanvas';
import { AssemblyProcedureDocumentEditorCanvasToolbar } from './AssemblyProcedureDocumentEditorCanvasToolbar';
import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';
import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';
import { AssemblyProcedureOverlayTypeDialog } from './AssemblyProcedureOverlayTypeDialog';
import { AssemblyProcedureTextCandidateDialog } from './AssemblyProcedureTextCandidateDialog';

export function AssemblyProcedureDocumentEditorScreen() {
  const controller = useAssemblyProcedureDocumentEditor();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [conflictReloadOpen, setConflictReloadOpen] = useState(false);

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
    return <AssemblyProcedureDocumentEditorAuthGate />;
  }

  if (!selectedPage) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 p-4 text-white" role="alert">
        手順書ページがありません。
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-800 text-white">
      <AssemblyProcedureDocumentEditorCanvasToolbar
        documentName={controller.document?.name ?? '手順書'}
        pageIndex={selectedPage.pageIndex}
        pageCount={controller.pages.length}
        selectionMode={controller.selectionMode}
        dirty={controller.isDirty}
        busy={controller.busy}
        readOnly={controller.readOnly}
        canSave={controller.canSave}
        canPublish={controller.canPublish}
        canDiscard={controller.canDiscard}
        onBack={controller.navigateBack}
        onToggleSelection={() => controller.setSelectionMode(!controller.selectionMode)}
        onSave={() => void controller.save()}
        onPublish={() => setPublishOpen(true)}
        onDiscard={() => setDiscardOpen(true)}
      />

      <div data-testid="assembly-document-editor-layout" className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[8rem_minmax(16rem,1fr)_minmax(10rem,14rem)] overflow-hidden xl:grid-cols-[13rem_minmax(0,1fr)_20rem] xl:grid-rows-1">
        <AssemblyProcedureDocumentEditorPageList
          pages={pages}
          assets={controller.document?.assets}
          selectedPageIndex={selectedPage.pageIndex}
          onSelect={controller.setSelectedPageIndex}
        />
        <section className="relative min-h-0 min-w-0 overflow-hidden bg-slate-950 p-2" aria-label="手順書キャンバス">
          <AssemblyProcedureDocumentEditorCanvas
            pageUrl={selectedPage.imageRelativePath}
            pageIndex={selectedPage.pageIndex}
            elements={controller.selectedPageElements}
            selectionMode={controller.selectionMode}
            selectedOverlayId={controller.selectedOverlayId}
            onSelectOverlay={controller.setSelectedOverlayId}
            onNudgeOverlay={controller.nudgeElement}
            onRangeSelected={controller.handleRangeSelected}
            assets={controller.document?.assets}
            className="h-full w-full"
          />
          {controller.message ? (
            <div className="absolute bottom-3 left-3 right-3 rounded border border-white/20 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-amber-100" role={controller.conflict ? 'alert' : 'status'}>
              <p>{controller.message}</p>
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
        <AssemblyProcedureDocumentEditorInspector
          element={controller.selectedElement}
          onUpdate={controller.updateElement}
          onDelete={controller.deleteSelectedOverlay}
          onBringForward={controller.bringForward}
          onSendBackward={controller.sendBackward}
          onUploadImage={controller.uploadImage}
          readOnly={controller.readOnly}
        />
      </div>

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
      <ConfirmDialog
        isOpen={publishOpen}
        title="手順書を公開"
        description="公開すると、この内容が使用側に反映され、現在の下書きは編集可能な状態ではなくなります。公開済み文書を編集する場合は、新しい改版を作成します。"
        confirmLabel="公開する"
        confirmTarget="assembly-document-editor-publish-confirm"
        cancelLabel="キャンセル"
        onConfirm={() => {
          setPublishOpen(false);
          void controller.publish();
        }}
        onCancel={() => setPublishOpen(false)}
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
