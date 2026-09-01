import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkInstructionEditorController } from '../../features/work-instructions/useWorkInstructionEditorController';
import { WorkInstructionEditorCanvas } from '../../features/work-instructions/WorkInstructionEditorCanvas';
import { WorkInstructionEditorInspector } from '../../features/work-instructions/WorkInstructionEditorInspector';
import { effectiveWorkInstructionMemo } from '../../features/work-instructions/workInstructionEditorMemo';
import { WorkInstructionEditorToolbarStatus } from '../../features/work-instructions/WorkInstructionEditorToolbarStatus';
import { WorkInstructionOverlayTypeDialog } from '../../features/work-instructions/WorkInstructionOverlayTypeDialog';
import { WorkInstructionTextCandidateDialog } from '../../features/work-instructions/WorkInstructionTextCandidateDialog';
import { WorkInstructionVersionComparison } from '../../features/work-instructions/WorkInstructionVersionComparison';

import type { WorkInstructionRevisionHistoryItemDto } from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionEditorController } from '../../features/work-instructions/useWorkInstructionEditorController';

function backPath(partNumber: string, shootingTarget: string): string {
  const params = new URLSearchParams({ partNumber, shootingTarget });
  return `/kiosk/part-measurement/self-inspection?${params.toString()}`;
}

function EditorAuthGate({
  controller,
  onBack
}: {
  controller: WorkInstructionEditorController;
  onBack: () => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-slate-800 p-3 text-white">
      <section className="rounded border border-white/15 bg-slate-900/75 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">加工要領書オーバーレイ編集</h1>
            <p className="mt-1 text-sm font-semibold text-white/65">
              編集する前に管理パスワードを入力してください。公開中の原本はこの画面から変更されません。
            </p>
          </div>
          <Button type="button" variant="ghostOnDark" className="min-h-11" onClick={onBack}>
            戻る
          </Button>
        </div>

        <div className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-2">
          <Input
            data-testid="work-instruction-editor-password"
            value={controller.accessPassword}
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="パスワード"
            className="min-h-12 text-lg"
            disabled={controller.busy}
            onChange={(event) => controller.setAccessPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void controller.authenticate();
            }}
          />
          <Button
            type="button"
            data-testid="work-instruction-editor-authenticate"
            variant="primary"
            className="min-h-12"
            disabled={!controller.accessPassword || controller.busy}
            onClick={() => void controller.authenticate()}
          >
            {controller.busy ? '準備中…' : '認証して編集'}
          </Button>
        </div>

        {controller.message ? (
          <p
            className="mt-3 rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100"
            role="alert"
          >
            {controller.message}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function EditorToolbar({
  controller,
  partNumber,
  shootingTarget,
  showComparison,
  onToggleComparison,
  showHistory,
  onToggleHistory,
  onOpenPublish,
  onOpenDiscard
}: {
  controller: WorkInstructionEditorController;
  partNumber: string;
  shootingTarget: string;
  showComparison: boolean;
  onToggleComparison: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  onOpenPublish: () => void;
  onOpenDiscard: () => void;
}) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-white/15 bg-slate-900 px-3 py-2">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold">加工要領書を編集</h1>
        <p className="truncate text-sm text-white/60">
          {partNumber} ・ {shootingTarget}
        </p>
      </div>
      {controller.hasUpdate ? (
        <span
          className="rounded border border-amber-300/50 bg-amber-300/15 px-2 py-1 text-xs font-bold text-amber-100"
          role="status"
        >
          新しい原本を移植中
        </span>
      ) : null}
      <WorkInstructionEditorToolbarStatus controller={controller} />
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-11"
        aria-pressed={showComparison}
        onClick={onToggleComparison}
      >
        {showComparison ? '比較を隠す' : '公開版と比較'}
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-11"
        aria-pressed={showHistory}
        onClick={onToggleHistory}
      >
        {showHistory ? '履歴を隠す' : '履歴を表示'}
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-11"
        aria-pressed={controller.selectionMode}
        disabled={!controller.activeStep || controller.busy}
        onClick={() => controller.setSelectionMode((current) => !current)}
      >
        {controller.selectionMode ? '範囲選択を終了' : '注記範囲を選択'}
      </Button>
      <Button type="button" variant="ghostOnDark" className="min-h-11" onClick={controller.navigateBack}>
        戻る
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        disabled={!controller.canSave || controller.busy}
        onClick={() => void controller.save()}
      >
        保存
      </Button>
      <Button
        type="button"
        variant="primary"
        className="min-h-11"
        disabled={!controller.canPublish}
        onClick={onOpenPublish}
      >
        一括公開
      </Button>
      <Button
        type="button"
        variant="danger"
        className="min-h-11"
        disabled={!controller.canDiscard}
        onClick={onOpenDiscard}
      >
        下書きを破棄
      </Button>
    </header>
  );
}

function EditorRowsPane({ controller }: { controller: WorkInstructionEditorController }) {
  return (
    <aside
      className="min-h-0 overflow-auto border-b border-white/10 bg-slate-900/70 p-2 xl:border-b-0 xl:border-r"
      aria-label="要領書の原本行"
    >
      <h2 className="mb-2 text-xs font-bold text-white/70">原本行</h2>
      <div className="grid gap-1">
        {controller.rows.map((row) => (
          <button
            key={row.rowId}
            type="button"
            className={`rounded border px-2 py-2 text-left text-xs ${
              row.rowId === controller.selectedRowId
                ? 'border-cyan-300 bg-cyan-300/15 text-white'
                : 'border-white/10 text-white/75 hover:bg-white/10'
            }`}
            onClick={() => controller.selectRow(row.rowId)}
          >
            <span className="block font-bold">
              {row.source.system} / {row.source.list}
            </span>
            <span className="block text-white/60">item {row.source.itemId}</span>
            {row.updateAvailable ? <span className="mt-1 block text-amber-200">新原本あり</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded border border-white/10 p-2 text-xs text-white/75">
        <p className="font-bold text-white">移植集計</p>
        <p>総数 {controller.group?.migration.total ?? 0}</p>
        <p>移植済み {controller.group?.migration.migrated ?? 0}</p>
        <p className="text-amber-100">要確認 {controller.group?.migration.needsReview ?? 0}</p>
        <p>未割当 {controller.group?.migration.unassigned ?? 0}</p>
      </div>
    </aside>
  );
}

function EditorStepsPane({ controller }: { controller: WorkInstructionEditorController }) {
  return (
    <aside
      className="min-h-0 overflow-auto border-b border-white/10 bg-slate-900/50 p-2 xl:border-b-0 xl:border-r"
      aria-label="手順一覧"
    >
      <h2 className="mb-2 text-xs font-bold text-white/70">手順</h2>
      <div className="grid gap-1">
        {controller.activeSteps.map((step, index) => {
          const key = step.stepKey || `${step.sourceSystem}:${step.sourceList}:${step.sourceItemId}:${step.step}`;
          return (
            <button
              key={key}
              type="button"
              className={`rounded border px-2 py-2 text-left text-xs ${
                key === controller.selectedStepKey
                  ? 'border-emerald-300 bg-emerald-300/15 text-white'
                  : 'border-white/10 text-white/75 hover:bg-white/10'
              }`}
              onClick={() => controller.selectStep(key)}
            >
              <span className="font-bold">手順 {step.step || index + 1}</span>
              <span className="mt-1 block truncate text-white/60">{effectiveWorkInstructionMemo(step, controller.activeMemoOverrides)}</span>
              <span className="mt-1 block text-white/50">
                注記 {controller.activeElements.filter((element) => element.stepKey === key).length}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function EditorWorkSurface({
  controller,
  onOpenConflict
}: {
  controller: WorkInstructionEditorController;
  onOpenConflict: () => void;
}) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <WorkInstructionEditorCanvas
        step={controller.activeStep}
        elements={controller.activeStepElements}
        selectedOverlayId={controller.selectedOverlayId}
        selectionMode={controller.selectionMode}
        editable={!controller.busy}
        onSelectOverlay={controller.setSelectedOverlayId}
        onNudgeOverlay={controller.nudgeElement}
        onUpdateOverlayBBox={controller.updateElementBBox}
        onRangeSelected={(bbox) => controller.setPendingRange(bbox)}
        assets={controller.activeAssets}
        className="h-full w-full"
      />
      {controller.selectionMode ? (
        <p className="pointer-events-none absolute left-4 top-4 z-50 rounded bg-amber-300 px-2 py-1 text-xs font-bold text-slate-900">
          画像上で範囲をドラッグしてください
        </p>
      ) : null}
      {controller.conflict && controller.message ? (
        <div
          className="absolute bottom-3 left-3 right-3 z-50 rounded border border-white/20 bg-slate-950/90 px-3 py-2 text-sm font-semibold text-amber-100"
          role="alert"
        >
          <p>{controller.message}</p>
          {controller.conflict ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-11 !px-2 text-xs"
                onClick={onOpenConflict}
              >
                最新を再読込
              </Button>
              <Button
                type="button"
                variant="primary"
                className="min-h-11 !px-2 text-xs"
                disabled={controller.conflict.currentEditVersion == null}
                onClick={() => void controller.retryConflictSave()}
              >
                保持内容を再保存
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditorCanvasPane({
  controller,
  showComparison,
  onOpenConflict
}: {
  controller: WorkInstructionEditorController;
  showComparison: boolean;
  onOpenConflict: () => void;
}) {
  return (
    <section className="relative flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-slate-950 p-2" aria-label="加工要領書編集キャンバス">
      {showComparison ? (
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-2" data-testid="work-instruction-editor-comparison-layout">
          <div className="relative min-h-0 min-w-0 overflow-hidden rounded border border-white/10" data-testid="work-instruction-editor-target-pane">
            <EditorWorkSurface controller={controller} onOpenConflict={onOpenConflict} />
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden rounded border border-white/10 p-1" data-testid="work-instruction-editor-comparison-pane">
            <WorkInstructionVersionComparison
              row={controller.activeRow}
              selectedStepKey={controller.selectedStepKey}
              assets={controller.activeAssets}
            />
          </div>
        </div>
      ) : (
        <EditorWorkSurface controller={controller} onOpenConflict={onOpenConflict} />
      )}
    </section>
  );
}

function EditorHistorySection({
  history,
  canDeleteOldImages,
  busy,
  onRequestDelete
}: {
  history: WorkInstructionRevisionHistoryItemDto[];
  canDeleteOldImages: boolean;
  busy: boolean;
  onRequestDelete: (sourceVersionId: string) => void;
}) {
  return (
    <section
      className="max-h-44 shrink-0 overflow-auto border-t border-white/10 bg-slate-900/80 px-3 py-2"
      aria-label="旧画像の履歴"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">版履歴と旧画像</h2>
        <span className="text-xs text-white/60">
          新版公開後も旧画像は手動削除するまで保持されます。
          {canDeleteOldImages ? '' : '旧画像の削除はADMINのみ実行できます。'}
        </span>
      </div>
      {history.length === 0 ? (
        <p className="mt-1 text-xs text-white/50">履歴はありません。</p>
      ) : (
        <div className="mt-2 grid gap-1">
          {history.map((item) => (
            <div
              key={`${item.rowId ?? ''}:${item.sourceVersionId}:${item.revisionNumber}`}
              className="flex flex-wrap items-center gap-2 rounded border border-white/10 px-2 py-1 text-xs"
            >
              <span className="font-semibold">版 {item.revisionNumber}</span>
              <span className="text-white/60">{item.status}</span>
              <span className="text-white/50">
                {new Date(item.sourceModified).toLocaleString('ja-JP')}
              </span>
              <span className="text-white/50">
                画像 {item.eligibleImageCount ?? item.imageCount}件
              </span>
              <span className="ml-auto">
                {item.imageDeletedAt && !item.canDeleteImage ? (
                  '画像削除済み'
                ) : item.canDeleteImage && canDeleteOldImages ? (
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-9 !px-2 text-xs"
                    disabled={busy}
                    onClick={() => onRequestDelete(item.sourceVersionId)}
                  >
                    旧画像を一括削除
                  </Button>
                ) : item.canDeleteImage ? (
                  'ADMINのみ削除可'
                ) : (
                  '削除不可'
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EditorDialogs({
  controller,
  publishOpen,
  discardOpen,
  recoveryOpen,
  conflictOpen,
  deleteSourceVersionId,
  onClosePublish,
  onCloseDiscard,
  onCloseRecovery,
  onCloseConflict,
  onCloseDelete,
  onConfirmDelete
}: {
  controller: WorkInstructionEditorController;
  publishOpen: boolean;
  discardOpen: boolean;
  recoveryOpen: boolean;
  conflictOpen: boolean;
  deleteSourceVersionId: string | null;
  onClosePublish: () => void;
  onCloseDiscard: () => void;
  onCloseRecovery: () => void;
  onCloseConflict: () => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <WorkInstructionOverlayTypeDialog
        isOpen={controller.pendingRange != null}
        onClose={() => controller.setPendingRange(null)}
        onSelect={(kind) => void controller.createOverlay(kind)}
      />
      <WorkInstructionTextCandidateDialog
        isOpen={controller.textCandidates.length > 0}
        candidates={controller.textCandidates}
        onSelect={controller.chooseTextCandidate}
        onManual={() => controller.chooseTextCandidate(null)}
        onClose={controller.cancelTextCandidates}
      />
      <ConfirmDialog
        isOpen={publishOpen}
        title="加工要領書を一括公開"
        description="各原本行の下書きを1回の公開操作で切り替えます。公開中の注記と新版画像が使用側に反映されます。要確認・未割当の注記も現在の配置で確定します。"
        confirmLabel="公開する"
        cancelLabel="キャンセル"
        onConfirm={() => {
          onClosePublish();
          void controller.publish((controller.group?.migration.unassigned ?? 0) > 0);
        }}
        onCancel={onClosePublish}
      />
      <ConfirmDialog
        isOpen={discardOpen}
        title="下書きを破棄"
        description="すべての原本行の編集下書きを破棄します。公開中の注記は変更されません。"
        confirmLabel="破棄する"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => {
          onCloseDiscard();
          void controller.discard();
        }}
        onCancel={onCloseDiscard}
      />
      <ConfirmDialog
        isOpen={conflictOpen}
        title="最新内容を再読込"
        description="保持中の未保存内容を破棄し、サーバーの最新原本と下書きを読み込みます。"
        confirmLabel="再読込"
        cancelLabel="戻る"
        tone="danger"
        onConfirm={() => {
          onCloseConflict();
          void controller.reloadConflict();
        }}
        onCancel={onCloseConflict}
      />
      <ConfirmDialog
        isOpen={recoveryOpen || controller.recoveryPending != null}
        title="端末に残った下書き"
        description="前回の編集途中データがあります。復元してから保存できます。"
        confirmLabel="復元"
        cancelLabel="破棄"
        onConfirm={() => {
          onCloseRecovery();
          controller.restoreRecovery();
        }}
        onCancel={() => {
          onCloseRecovery();
          controller.discardRecovery();
        }}
      />
      <ConfirmDialog
        isOpen={deleteSourceVersionId != null}
        title="旧画像を削除"
        description="選択した旧原本画像のbytesとasset参照を削除します。版履歴・注記・削除監査は残ります。公開中の版は削除できません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={onConfirmDelete}
        onCancel={onCloseDelete}
      />
    </>
  );
}

export function KioskWorkInstructionEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const partNumber = searchParams.get('partNumber')?.trim() ?? '';
  const shootingTarget = searchParams.get('shootingTarget')?.trim() ?? '';
  const controller = useWorkInstructionEditorController({
    partNumber,
    shootingTarget,
    onNavigateBack: () => navigate(backPath(partNumber, shootingTarget))
  });
  const { user } = useAuth();
  const canDeleteOldImages = user?.role === 'ADMIN';
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [deleteSourceVersionId, setDeleteSourceVersionId] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  if (!partNumber || !shootingTarget) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 p-4 text-white">
        <section className="rounded border border-rose-300/30 bg-slate-900 p-4">
          <p>部品番号と対象が指定されていません。</p>
          <Button
            type="button"
            className="mt-3 min-h-11"
            onClick={() => navigate('/kiosk/part-measurement/self-inspection')}
          >
            自主検査へ戻る
          </Button>
        </section>
      </main>
    );
  }

  if (controller.loading && !controller.group) {
    return (
      <main
        className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white"
        role="status"
      >
        加工要領書を読み込み中…
      </main>
    );
  }

  if (!controller.accessGranted) {
    return <EditorAuthGate controller={controller} onBack={controller.navigateBack} />;
  }

  const activeRow = controller.activeRow;
  const history = controller.group?.history ?? activeRow?.history ?? [];

  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-800 text-white">
        <EditorToolbar
          controller={controller}
          partNumber={partNumber}
          shootingTarget={shootingTarget}
          showComparison={showComparison}
          onToggleComparison={() => setShowComparison((current) => !current)}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory((current) => !current)}
          onOpenPublish={() => setPublishOpen(true)}
          onOpenDiscard={() => setDiscardOpen(true)}
        />
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(16rem,1fr)_minmax(12rem,18rem)] overflow-hidden xl:grid-cols-[14rem_14rem_minmax(0,1fr)_20rem] xl:grid-rows-1">
          <EditorRowsPane controller={controller} />
          <EditorStepsPane controller={controller} />
          <EditorCanvasPane
            controller={controller}
            showComparison={showComparison}
            onOpenConflict={() => setConflictOpen(true)}
          />
          <WorkInstructionEditorInspector
            element={controller.selectedElement}
            step={controller.activeStep}
            memo={controller.activeMemo}
            memoOverride={controller.activeMemoOverride}
            memoOverrides={controller.activeMemoOverridesArray}
            onMemoChange={controller.selectedStepKey ? (value) => controller.updateMemo(controller.selectedStepKey!, value) : undefined}
            onMemoReset={controller.selectedStepKey ? () => controller.resetMemo(controller.selectedStepKey!) : undefined}
            onMemoKeep={controller.selectedStepKey ? () => controller.keepMemo(controller.selectedStepKey!) : undefined}
            onMemoAssignAndKeep={controller.assignMemoAndKeep}
            onMemoUseSource={controller.useSourceMemo}
            steps={controller.activeSteps}
            onAssignStep={controller.assignOverlayStep}
            onUpdate={controller.updateElement}
            onDelete={controller.deleteSelectedOverlay}
            onBringForward={controller.bringForward}
            onSendBackward={controller.sendBackward}
            onUploadImage={controller.uploadImage}
            onRefetchTextCandidates={() => void controller.refetchTextCandidates()}
            readOnly={controller.busy}
            busy={controller.busy}
          />
        </div>
        {showHistory ? (
          <div className="shrink-0 self-start border-t border-white/10 xl:w-[28rem]" data-testid="work-instruction-editor-history-pane">
            <EditorHistorySection
              history={history}
              canDeleteOldImages={canDeleteOldImages}
              busy={controller.busy}
              onRequestDelete={setDeleteSourceVersionId}
            />
          </div>
        ) : null}
      </main>

      <EditorDialogs
        controller={controller}
        publishOpen={publishOpen}
        discardOpen={discardOpen}
        recoveryOpen={recoveryOpen}
        conflictOpen={conflictOpen}
        deleteSourceVersionId={deleteSourceVersionId}
        onClosePublish={() => setPublishOpen(false)}
        onCloseDiscard={() => setDiscardOpen(false)}
        onCloseRecovery={() => setRecoveryOpen(false)}
        onCloseConflict={() => setConflictOpen(false)}
        onCloseDelete={() => setDeleteSourceVersionId(null)}
        onConfirmDelete={() => {
          const sourceVersionId = deleteSourceVersionId;
          setDeleteSourceVersionId(null);
          if (sourceVersionId) void controller.deleteSourceImage(sourceVersionId);
        }}
      />
    </>
  );
}

export { KioskWorkInstructionEditorPage as WorkInstructionEditorPage };
