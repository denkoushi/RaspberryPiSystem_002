import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Dialog } from '../../components/ui/Dialog';
import { useWorkInstructionEditorController } from '../../features/work-instructions/useWorkInstructionEditorController';
import { WorkInstructionEditorCanvas } from '../../features/work-instructions/WorkInstructionEditorCanvas';
import {
  WorkInstructionEditorButton as Button,
  WorkInstructionEditorConfirmDialog as ConfirmDialog,
  WorkInstructionEditorIcon,
  WorkInstructionEditorPanelHeading
} from '../../features/work-instructions/WorkInstructionEditorControls';
import { WorkInstructionEditorInspector } from '../../features/work-instructions/WorkInstructionEditorInspector';
import { WorkInstructionEditorRowsPane, WorkInstructionEditorStepsPane } from '../../features/work-instructions/WorkInstructionEditorNavigation';
import { WorkInstructionEditorToolbarStatus } from '../../features/work-instructions/WorkInstructionEditorToolbarStatus';
import { WorkInstructionMemoEditor } from '../../features/work-instructions/WorkInstructionMemoEditor';
import { WorkInstructionMemoReviewList } from '../../features/work-instructions/WorkInstructionMemoReviewList';
import { WorkInstructionOverlayTypeDialog } from '../../features/work-instructions/WorkInstructionOverlayTypeDialog';
import { WorkInstructionTextCandidateDialog } from '../../features/work-instructions/WorkInstructionTextCandidateDialog';
import { WorkInstructionVersionComparison } from '../../features/work-instructions/WorkInstructionVersionComparison';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { WorkInstructionEditorController } from '../../features/work-instructions/useWorkInstructionEditorController';

const wideEditorQuery = '(min-width: 1280px)';

function subscribeEditorWidth(onChange: () => void) {
  const query = window.matchMedia(wideEditorQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isWideEditor() {
  return window.matchMedia(wideEditorQuery).matches;
}

function editorMessage(message: string | null): string {
  return (message ?? '').replace(/オーバーレイ|注記/g, '注釈').replace(/memo/gi, 'メモ').replace(/移植/g, '確認').replace(/asset(?: ID)?/gi, '画像').replace(/fingerprint/gi, '原本の情報').replace(/USE_SOURCE/g, '原本を使う').replace(/KEEP/g, '維持').replace(/\bitem\b/gi, '原本').replace(/比率/g, '割合');
}

function backPath(partNumber: string, shootingTarget: string): string {
  return `/kiosk/part-measurement/self-inspection?${new URLSearchParams({ partNumber, shootingTarget }).toString()}`;
}

function EditorAuthGate({ controller }: { controller: WorkInstructionEditorController }) {
  return <main className="relative -m-4 grid min-h-0 flex-1 place-items-center bg-[#0a0d10] text-[#eef3f6]"><Button className="absolute right-6 top-4" onClick={controller.navigateBack}>戻る</Button><section className="text-center" data-testid="work-instruction-editor-nfc-gate"><WorkInstructionEditorIcon name="nfc" className={`mx-auto mb-8 h-40 w-40 text-[#5fc3e8] ${controller.busy ? 'motion-safe:animate-pulse' : ''}`} />{!controller.busy && (controller.errorMessage || controller.message) ? <p role="alert" className="mb-4 max-w-[calc(100vw-48px)] truncate whitespace-nowrap text-lg text-[#e5484d]">{editorMessage(controller.errorMessage ?? controller.message)}</p> : null}<h1 className="text-[28px] font-bold tracking-[.12em]" role={controller.busy ? 'status' : undefined}>{controller.busy ? '確認中…' : '社員タグ'}</h1></section></main>;
}

function changeCount(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  const counts = entries.flatMap(([key, entry]) => {
    if (['added', 'changed', 'updated', 'removed', 'deleted'].includes(key) && Array.isArray(entry)) return [entry.length];
    const nested = changeCount(entry);
    return nested == null ? [] : [nested];
  });
  return counts.length > 0 ? counts.reduce((total, count) => total + count, 0) : null;
}

function EditorHistorySection({ controller, onRequestDelete }: { controller: WorkInstructionEditorController; onRequestDelete: (id: string) => void }) {
  const labels: Record<string, string> = { DRAFT_CREATED: '下書きを作成', SAVED: '下書きを保存', PUBLISHED: '公開', DISCARDED: '下書きを捨てる', ASSET_UPLOADED: '画像を追加', REGION_CREATED: '範囲から画像を追加', SOURCE_IMAGE_DELETED: '旧画像を削除' };
  const history = controller.group?.history ?? controller.activeRow?.history ?? [];
  const audit = [...controller.auditItems].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return <div className="min-h-0 overflow-y-auto text-[#eef3f6]" data-testid="work-instruction-editor-history-pane"><h3 className="mb-5 mt-6 text-sm font-bold">操作</h3><ol data-testid="work-instruction-editor-audit-list">{audit.map((item) => {
    const count = changeCount(item.changeSet);
    return <li key={item.id} className="relative ml-1 border-l border-[#344252] pb-6 pl-6 before:absolute before:-left-1 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-[#3ba776]"><strong className="mb-2 block text-base">{labels[item.action] ?? '操作'}</strong><div className="flex gap-3 text-xs text-[#9fadb9]"><span>{item.employeeNameSnapshot ?? '社員'}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ja-JP')}</time></div><p className="mt-1 text-xs text-[#9fadb9]">端末: {item.clientDeviceNameSnapshot ?? item.clientDeviceIdSnapshot ?? '不明'}</p>{count != null ? <p className="mt-1 text-sm text-[#9fadb9]">変更 {count} 件</p> : null}</li>;
  })}</ol><h3 className="mb-5 mt-6 text-sm font-bold">版と旧画像</h3>{history.map((item) => <article key={`${item.rowId}:${item.sourceVersionId}:${item.revisionNumber}`} className="mb-3 rounded-lg border border-[#344252] p-3"><div className="flex justify-between"><strong>版 {item.revisionNumber}</strong><span className="text-sm text-[#9fadb9]">{item.isPublished ? '公開中' : item.status === 'draft' ? '下書き' : '旧版'}</span></div><p className="mt-2 text-xs text-[#9fadb9]">{new Date(item.sourceModified).toLocaleString('ja-JP')} · 画像 {item.imageCount} 件</p>{item.imageDeletedAt && !item.canDeleteImage ? <p className="mt-2 text-sm text-[#9fadb9]">画像削除済み</p> : item.canDeleteImage ? <Button className="mt-3 text-[#e5484d]" disabled={controller.busy} onClick={() => onRequestDelete(item.sourceVersionId)}>旧画像を削除</Button> : null}</article>)}</div>;
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
        title="加工要領書を公開"
        description={`下書き ${controller.rows.filter((row) => row.draft).length} 件を公開します。要確認 ${controller.reviewCount} 件を含みます。`}
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
        title="下書きを捨てる"
        description="この下書きを捨てて、公開中の内容に戻します。"
        confirmLabel="下書きを捨てる"
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
        description="現在の未保存内容を破棄し、最新内容へ置き換えます。"
        confirmLabel="最新内容へ置換"
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
        description="前回の編集途中データを復元してから保存できます。"
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
        description="選んだ旧画像を削除します。"
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
  const controller = useWorkInstructionEditorController({ partNumber, shootingTarget, onNavigateBack: () => navigate(backPath(partNumber, shootingTarget)) });
  const { accessGranted, authenticate, busy } = controller;
  const nfcEvent = useNfcStream(Boolean(partNumber && shootingTarget && !accessGranted && !busy));
  const lastNfcKeyRef = useRef<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [deleteSourceVersionId, setDeleteSourceVersionId] = useState<string | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState<boolean | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuFirstRef = useRef<HTMLButtonElement>(null);
  const wideEditor = useSyncExternalStore(subscribeEditorWidth, isWideEditor, () => false);
  const showComparison = comparisonOpen ?? (wideEditor && controller.hasUpdate);
  const showInspector = Boolean(controller.selectedElement || memoOpen);
  const panelMargin = wideEditor ? (showInspector ? 356 : 0) + (showComparison ? 396 : 0) : 0;
  const showToast = Boolean(controller.message && (controller.conflict || controller.message !== dismissedMessage));

  useEffect(() => {
    if (!nfcEvent || accessGranted || busy) return;
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastNfcKeyRef.current === eventKey) return;
    lastNfcKeyRef.current = eventKey;
    void authenticate(nfcEvent.uid);
  }, [accessGranted, authenticate, busy, nfcEvent]);

  useEffect(() => {
    setDismissedMessage(null);
    if (!controller.message || controller.conflict || busy) return;
    const timer = window.setTimeout(() => setDismissedMessage(controller.message), 4000);
    return () => window.clearTimeout(timer);
  }, [controller.message, controller.conflict, busy]);

  useEffect(() => {
    if (!moreOpen) return;
    menuFirstRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node) && !moreButtonRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);

  const closeInspector = () => { controller.setSelectedOverlayId(null); setMemoOpen(false); };
  const openMenuAction = (action: () => void) => { setMoreOpen(false); moreButtonRef.current?.focus(); action(); };
  if (!partNumber || !shootingTarget) return <main className="-m-4 flex min-h-0 flex-1 items-center justify-center bg-[#0a0d10] text-[#eef3f6]"><section><p>品番と対象が指定されていません。</p><Button className="mt-3" onClick={() => navigate('/kiosk/part-measurement/self-inspection')}>戻る</Button></section></main>;
  if (controller.loading && !controller.group) return <main className="-m-4 flex min-h-0 flex-1 items-center justify-center bg-[#0a0d10] text-[#eef3f6]" role="status">読み込み中…</main>;
  if (!accessGranted) return <EditorAuthGate controller={controller} />;

  return <>
    <main className="relative -m-4 grid min-h-0 flex-1 grid-cols-[76px_minmax(0,1fr)_64px] xl:grid-cols-[120px_minmax(0,1fr)_64px] overflow-hidden bg-[#0a0d10] text-[#eef3f6]" data-testid="work-instruction-editor-layout" onKeyDown={(event) => {
      if (event.key === 'Escape' && !moreOpen && !historyOpen && !publishOpen && !discardOpen && !conflictOpen && !controller.pendingRange && !controller.textCandidates.length && !controller.recoveryPending && !deleteSourceVersionId) { closeInspector(); controller.setSelectionMode(false); }
    }}>
      <WorkInstructionEditorStepsPane controller={controller} />
      <section className="relative min-h-0 min-w-0 overflow-hidden px-4 pb-4 pt-[112px] xl:pt-[60px]" aria-label="加工要領書キャンバス" data-testid={showComparison ? 'work-instruction-editor-comparison-layout' : undefined}>
        <div className="flex h-full min-h-0 min-w-0" style={{ marginRight: panelMargin, paddingBottom: showToast ? 52 : 0 }} data-testid="work-instruction-editor-target-pane">
          <WorkInstructionEditorCanvas step={controller.activeStep} elements={controller.activeStepElements} selectedOverlayId={controller.selectedOverlayId} selectionMode={controller.selectionMode} editable={!busy && Boolean(controller.activeRevision)} onSelectOverlay={(id) => { setMemoOpen(false); controller.setSelectionMode(false); controller.setSelectedOverlayId(id); }} onNudgeOverlay={controller.nudgeElement} onUpdateOverlayBBox={controller.updateElementBBox} onRangeSelected={controller.setPendingRange} onDeselect={closeInspector} assets={controller.activeAssets} className="h-full w-full !bg-[#0a0d10]" />
        </div>
        <div className="absolute left-4 right-4 top-2 z-[140] flex flex-wrap items-center gap-2 whitespace-nowrap xl:flex-nowrap">
          <div className="flex h-11 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg xl:w-auto xl:overflow-visible border border-[#344252] bg-[#161c22eb] px-3 text-lg"><h1 aria-label="加工要領書を編集" className="min-w-[80px] max-w-[50%] shrink-0 truncate font-bold xl:max-w-none xl:shrink">{partNumber}</h1><span className="text-[#9fadb9]">›</span><span className="min-w-0 truncate text-[#9fadb9]">{shootingTarget}</span><WorkInstructionEditorRowsPane controller={controller} /><span className="flex h-[26px] shrink-0 items-center rounded-full border border-[#3ba776] px-2.5 text-[15px] font-bold text-[#3ba776]">下書き 第{controller.activeRevision?.revisionNumber ?? controller.activeRow?.published.revisionNumber ?? 1}版</span></div>
          <WorkInstructionEditorToolbarStatus controller={controller} onReview={() => { const next = controller.nextReview(); if (next) setMemoOpen(next.memo); }} />
          {controller.hasUpdate ? <span className="flex h-11 shrink-0 items-center rounded-lg border border-[#344252] bg-[#161c22eb] px-3 text-[15px] text-[#f6b93b]">新しい原本あり</span> : null}
        </div>
        {controller.selectionMode ? <p className="absolute left-4 top-[116px] xl:top-[64px] z-50 rounded-lg bg-[#161c22eb] px-3 py-2 text-sm text-[#5fc3e8]">なぞって範囲を選ぶ</p> : null}
        {showToast ? <div className="absolute bottom-4 left-4 z-[150] flex h-11 max-w-[calc(100%-32px)] items-center gap-2.5 rounded-lg border border-[#344252] bg-[#161c22eb] px-3.5 text-lg" role={controller.conflict ? 'alert' : 'status'} aria-live="polite" style={{ maxWidth: `calc(100% - ${32 + panelMargin}px)` }}><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${controller.conflict ? 'bg-[#f6b93b]' : 'bg-[#3ba776]'}`} /><p className="truncate" data-testid="work-instruction-editor-toolbar-message" title={editorMessage(controller.message)}>{editorMessage(controller.message)}</p>{controller.conflict ? <><Button className="shrink-0" disabled={busy} onClick={() => setConflictOpen(true)}>最新を再読込</Button><Button className="shrink-0 !border-[#3ba776] bg-[#3ba776] text-[#0b1a12]" disabled={busy || controller.conflict.currentEditVersion == null} onClick={() => void controller.retryConflictSave()}>保持内容を再保存</Button></> : null}</div> : null}
        {showComparison ? <aside className="absolute bottom-4 top-[116px] z-[120] grid w-[380px] max-w-[calc(100%-32px)] xl:top-16 grid-rows-[44px_minmax(0,1fr)] gap-3" style={{ right: wideEditor && showInspector ? 372 : 16 }} aria-label="原本の比較" data-testid="work-instruction-editor-comparison-pane"><WorkInstructionEditorPanelHeading title="原本の比較" onClose={() => setComparisonOpen(false)} /><WorkInstructionVersionComparison row={controller.activeRow} selectedStepKey={controller.selectedStepKey} assets={controller.activeAssets} /></aside> : null}
        {showInspector ? <div className="absolute right-4 top-[116px] z-[160] max-h-[calc(100%-132px)] w-[340px] max-w-[calc(100%-32px)] overflow-y-auto xl:top-16 xl:max-h-none xl:overflow-visible rounded-[14px] border border-[#344252] bg-[#161c22f5] p-4">
          {controller.selectedElement ? <WorkInstructionEditorInspector element={controller.selectedElement} onClose={closeInspector} onDuplicate={controller.duplicateSelectedOverlay} steps={controller.activeSteps} onAssignStep={controller.assignOverlayStep} onUpdate={controller.updateElement} onDelete={controller.deleteSelectedOverlay} onBringForward={controller.bringForward} onSendBackward={controller.sendBackward} onUploadImage={controller.uploadImage} onRefetchTextCandidates={() => void controller.refetchTextCandidates()} readOnly={busy} busy={busy} /> : <aside className="grid gap-2" aria-label="作業メモ"><WorkInstructionEditorPanelHeading title="作業メモ" onClose={closeInspector} /><WorkInstructionMemoEditor step={controller.activeStep} value={controller.activeMemo} override={controller.activeMemoOverride} disabled={busy} onChange={(value) => { if (controller.selectedStepKey) controller.updateMemo(controller.selectedStepKey, value); }} onReset={() => { if (controller.selectedStepKey) controller.resetMemo(controller.selectedStepKey); }} onKeep={() => { if (controller.selectedStepKey) controller.keepMemo(controller.selectedStepKey); }} /><WorkInstructionMemoReviewList steps={controller.activeSteps} overrides={controller.activeMemoOverridesArray} disabled={busy} onAssignAndKeep={controller.assignMemoAndKeep} onUseSource={controller.useSourceMemo} /></aside>}
        </div> : null}
      </section>
      <nav className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-l border-[#27313b] bg-[#161c22] pb-[84px] pt-2.5" aria-label="エディタ操作">
        <Button aria-label="保存" title="保存" className="grid h-12 w-12 shrink-0 place-items-center !rounded-[10px] !border-[#3ba776] bg-[#3ba776] !p-0 text-[#0b1a12]" disabled={!controller.canSave || busy} onClick={() => void controller.save()}><WorkInstructionEditorIcon name="save" /></Button>
        <Button aria-label="公開" title="公開" className="grid h-12 w-12 shrink-0 place-items-center !rounded-[10px] !border-[#f6b93b] !p-0 text-[#f6b93b]" disabled={!controller.canPublish} onClick={() => setPublishOpen(true)}><WorkInstructionEditorIcon name="publish" /></Button>
        <span className="my-1 h-px w-9 shrink-0 bg-[#344252]" />
        {([['TEXT', '文字', 'text'], ['SHAPE', '図形', 'shape']] as const).map(([kind, label, icon]) => <Button key={kind} aria-label={label} title={label} aria-pressed={controller.selectedElement?.kind === kind} className="grid h-12 w-12 shrink-0 place-items-center !rounded-[10px] !p-0 aria-pressed:bg-[#27313b]" disabled={busy || !controller.activeStep || !controller.activeRevision} onClick={() => { setMemoOpen(false); controller.addDefaultOverlay(kind); }}><WorkInstructionEditorIcon name={icon} /></Button>)}
        <Button aria-label="範囲" title="範囲" aria-pressed={controller.selectionMode} className="grid h-12 w-12 shrink-0 place-items-center !rounded-[10px] !p-0 aria-pressed:bg-[#27313b]" disabled={busy || !controller.activeStep || !controller.activeRevision} onClick={() => { closeInspector(); controller.setPendingRange(null); controller.setSelectionMode(!controller.selectionMode); }}><WorkInstructionEditorIcon name="range" /></Button>
        <span className="my-1 h-px w-9 shrink-0 bg-[#344252]" />
        <button ref={moreButtonRef} type="button" aria-label="その他" title="その他" aria-expanded={moreOpen} aria-controls="work-instruction-editor-more-menu" onClick={() => setMoreOpen(!moreOpen)} className="relative grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] hover:bg-[#27313b] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#5fc3e8]"><WorkInstructionEditorIcon name="more" />{controller.unassignedMemoCount > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f6b93b] px-1 text-[13px] font-black text-[#0b1a12]">{controller.unassignedMemoCount}</span> : null}</button>
        <span className="flex-1" /><Button aria-label="戻る" title="戻る" className="grid h-12 w-12 shrink-0 place-items-center !rounded-[10px] !border-transparent !p-0 text-[#9fadb9]" onClick={controller.navigateBack}><WorkInstructionEditorIcon name="back" /></Button>
      </nav>
      {moreOpen ? <div ref={moreRef} id="work-instruction-editor-more-menu" className="absolute right-20 top-[324px] z-[180] w-[280px] rounded-[10px] border border-[#344252] bg-[#161c22] p-2" aria-label="その他"><button ref={menuFirstRef} type="button" className="flex h-12 w-full items-center gap-2.5 rounded-md px-3 hover:bg-[#27313b] focus-visible:outline focus-visible:outline-[#5fc3e8]" onClick={() => openMenuAction(() => { controller.setSelectedOverlayId(null); controller.setSelectionMode(false); controller.setPendingRange(null); setMemoOpen(!memoOpen); })}><WorkInstructionEditorIcon name="memo" />メモ</button>{([['比較', 'compare', () => setComparisonOpen(!showComparison)], ['履歴', 'history', () => setHistoryOpen(true)], ['下書きを捨てる', 'trash', () => setDiscardOpen(true)]] as const).map(([label, icon, action]) => <button key={label} type="button" disabled={icon === 'trash' && !controller.canDiscard} className={`flex h-12 w-full items-center gap-2.5 rounded-md px-3 hover:bg-[#27313b] disabled:opacity-40 focus-visible:outline focus-visible:outline-[#5fc3e8] ${icon === 'trash' ? 'text-[#e5484d]' : ''}`} onClick={() => openMenuAction(action)}><WorkInstructionEditorIcon name={icon} />{label}</button>)}</div> : null}
    </main>
    <Dialog isOpen={historyOpen} onClose={() => setHistoryOpen(false)} ariaLabel="履歴" size="full" overlayZIndex={250} className="!fixed !bottom-0 !right-0 !top-0 !m-0 flex !h-dvh !max-h-none !w-[440px] !max-w-full flex-col !rounded-none !border-0 !border-l !border-[#344252] !bg-[#161c22] !p-6 !text-[#eef3f6]"><WorkInstructionEditorPanelHeading title="履歴" onClose={() => setHistoryOpen(false)} /><EditorHistorySection controller={controller} onRequestDelete={setDeleteSourceVersionId} /></Dialog>
    <EditorDialogs controller={controller} publishOpen={publishOpen} discardOpen={discardOpen} recoveryOpen={false} conflictOpen={conflictOpen} deleteSourceVersionId={deleteSourceVersionId} onClosePublish={() => setPublishOpen(false)} onCloseDiscard={() => setDiscardOpen(false)} onCloseRecovery={() => undefined} onCloseConflict={() => setConflictOpen(false)} onCloseDelete={() => setDeleteSourceVersionId(null)} onConfirmDelete={() => { const id = deleteSourceVersionId; setDeleteSourceVersionId(null); if (id) void controller.deleteSourceImage(id); }} />
  </>;
}

export { KioskWorkInstructionEditorPage as WorkInstructionEditorPage };
