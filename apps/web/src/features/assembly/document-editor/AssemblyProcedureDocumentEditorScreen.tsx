import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { countProcedureMaterials, findAssemblyProcedureTextCandidates } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useStoredFlag } from '../../../hooks/useStoredFlag';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { useShelfResources } from '../procedure-manuals/procedure-material-shelf-search';
import { ProcedureMaterialShelfDialog } from '../procedure-manuals/ProcedureMaterialShelfDialog';
import { ProcedureVideoShelfDialog } from '../procedure-manuals/ProcedureVideoShelfDialog';

import { AssemblyProcedureCleanView } from './AssemblyProcedureCleanView';
import { AssemblyProcedureDocumentEditorAuthGate } from './AssemblyProcedureDocumentEditorAuthGate';
import { AssemblyProcedureDocumentEditorCanvas } from './AssemblyProcedureDocumentEditorCanvas';
import { AssemblyProcedureDocumentEditorCanvasToolbar } from './AssemblyProcedureDocumentEditorCanvasToolbar';
import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorInspector } from './AssemblyProcedureDocumentEditorInspector';
import { AssemblyProcedureDocumentEditorPageList } from './AssemblyProcedureDocumentEditorPageList';
import { AssemblyProcedureDocumentEditorPartsPane } from './AssemblyProcedureDocumentEditorPartsPane';
import { AssemblyProcedureDocumentPageDeleteDialog } from './AssemblyProcedureDocumentPageDeleteDialog';
import { AssemblyProcedureDocumentPageImportDialog } from './AssemblyProcedureDocumentPageImportDialog';
import { AssemblyProcedureDocumentPublishDialog } from './AssemblyProcedureDocumentPublishDialog';
import { AssemblyProcedureLayoutSuggestionPanel } from './AssemblyProcedureLayoutSuggestionPanel';
import { AssemblyProcedureOverlayTypeDialog } from './AssemblyProcedureOverlayTypeDialog';
import { AssemblyProcedureTextCandidateDialog } from './AssemblyProcedureTextCandidateDialog';
import { buildCleanSteps } from './cleanViewSteps';
import { DocumentEditorMaterials } from './DocumentEditorMaterials';
import { useMaterialDrag } from './useMaterialDrag';
import { useProcedureLiveMeeting } from './useProcedureLiveMeeting';
import { useProcedureMeetingInput } from './useProcedureVoiceInput';
import { useRotationImagePreload } from './useRotationImagePreload';

import type { AssemblyProcedureDocumentPageDto } from '../types';
import type { AssemblyProcedureImageOverlayElement } from '@raspi-system/shared-types';

const twoPageStorageKey = 'assembly-document-editor-two-page';
const partsPaneStoredValues = { on: 'open', off: 'closed' };

export function AssemblyProcedureDocumentEditorScreen({ context, onNavigateToDocument }: { context?: import('../types').ProcedureManualEditorContext; onNavigateToDocument: (documentId: string) => void }) {
  const controller = useAssemblyProcedureDocumentEditor();
  const shelfResources = useShelfResources(controller.accessGranted);
  const { setSelectedOverlayId, setErrorMessage, addBlankPage: addControllerBlankPage, pages: controllerPages, placeMaterial: placeControllerMaterial, replaceSelectedImageMaterial: replaceControllerImageMaterial } = controller;
  const { rotateSelectedImage, rotationPreview } = controller;
  const { preload, preloader } = useRotationImagePreload(controller.busy);
  const controllerElements = controller.pagePreviewElements ?? controller.elements;
  const processNames = context?.processName.split(' › ') ?? [];
  const voiceContext = processNames.some(name => name.startsWith('組立')) ? 'procedure-assembly'
    : processNames.some(name => name.startsWith('研削')) ? 'procedure-grinding' : undefined;
  const cleanSteps = useMemo(() => buildCleanSteps(controller.pagePreviewElements
    ? controller.pagePreviewElements.filter(element => element.pageIndex === controller.selectedPageIndex)
    : controller.selectedPageElements), [controller.pagePreviewElements, controller.selectedPageElements, controller.selectedPageIndex]);
  const [cleanViewRequested, setCleanViewRequested] = useState(false);
  const canShowCleanView = cleanSteps.length > 0;
  const cleanView = cleanViewRequested && canShowCleanView;
  useEffect(() => {
    if (!canShowCleanView) setCleanViewRequested(false);
  }, [canShowCleanView]);
  const toggleCleanView = useCallback(() => {
    // Selecting no overlay also commits any active inline edit before the canvas unmounts.
    if (!cleanView) setSelectedOverlayId(null);
    setCleanViewRequested(!cleanView);
  }, [cleanView, setSelectedOverlayId]);
  const [voiceInputEnabled, toggleVoiceInput] = useStoredFlag('assembly-document-editor-voice-input', false);
  const [partsPaneOpen, togglePartsPane] = useStoredFlag('assembly-document-editor-parts-pane', true, partsPaneStoredValues);
  const narrowEditor = useMediaQuery('(max-width: 1099px)');
  const [twoPageEnabled, toggleTwoPageEnabled] = useStoredFlag(twoPageStorageKey, true);
  const [hiddenOverlayIds, setHiddenOverlayIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setHiddenOverlayIds(current => current.size ? new Set() : current);
  }, [controller.selectedPageIndex, controller.document?.id]);
  const toggleHidden = useCallback((id: string) => {
    const hidden = hiddenOverlayIds.has(id);
    setHiddenOverlayIds(current => {
      const next = new Set(current);
      if (hidden) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!hidden) setSelectedOverlayId(null);
  }, [hiddenOverlayIds, setSelectedOverlayId]);
  const [materialShelfOpen, setMaterialShelfOpen] = useState(false);
  const [materialShelfMode, setMaterialShelfMode] = useState<'place' | 'replace'>('place');
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const meeting = useProcedureMeetingInput({
    element: controller.selectedElement?.kind === 'TEXT' ? controller.selectedElement : null,
    enabled: voiceInputEnabled && controller.accessGranted && !cleanView,
    disabled: inlineEditingId === controller.selectedElement?.id,
    busy: controller.busy || controller.saving || controller.readOnly,
    inlineEditingId,
    documentId: controller.document?.id,
    applyTranscript: controller.updateMeetingText,
  });
  const live = useProcedureLiveMeeting({
    element: controller.selectedElement?.kind === 'TEXT' ? controller.selectedElement : null,
    enabled: voiceInputEnabled && controller.accessGranted && !cleanView,
    disabled: inlineEditingId === controller.selectedElement?.id || controller.busy || controller.readOnly,
    onUpdate: controller.updateElement,
    onBegin: controller.beginOverlayDrag,
    onEnd: controller.endOverlayDrag,
    getTerms: () => controller.elements
      .flatMap(item => (item.kind === 'TEXT' && item.id !== controller.selectedElement?.id ? [item.text] : []))
      .join(' '),
  });
  const overlayLayerRef = useRef<HTMLDivElement>(null);
  const adjacentLayerRef = useRef<HTMLDivElement>(null);
  const overlayInteractionActive = useRef(false);
  const canvasSaving = controller.saving || controller.busy || !controller.editLeaseMine;
  const [materialRevision, setMaterialRevision] = useState(0);
  const refreshMaterials = useCallback(() => setMaterialRevision(value => value + 1), []);
  const [materialCount, setMaterialCount] = useState<number | null>(null);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!controller.accessGranted) return;
    let cancelled = false;
    void countProcedureMaterials({ state: 'unplaced' }).then(count => { if (!cancelled) setMaterialCount(count); }).catch(() => { if (!cancelled) setMaterialCount(null); });
    return () => { cancelled = true; };
  }, [controller.accessGranted, controller.materialRevision, materialShelfOpen, materialRevision]);
  useEffect(() => {
    setDismissedMessage(null);
    if (!controller.message || controller.messageIsError || controller.conflict || controller.busy) return;
    const timer = window.setTimeout(() => setDismissedMessage(controller.message), 4000);
    return () => window.clearTimeout(timer);
  }, [controller.message, controller.messageIsError, controller.conflict, controller.busy]);
  const [videoLinkOpen, setVideoLinkOpen] = useState(false);
  const [importPagesOpen, setImportPagesOpen] = useState(false);
  const [deletePageIndex, setDeletePageIndex] = useState<number | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [conflictReloadOpen, setConflictReloadOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);

  useEffect(() => {
    if (controller.recoveryPending) setRecoveryOpen(true);
  }, [controller.recoveryPending]);

  const previousPages = useRef<Map<number, { source: AssemblyProcedureDocumentPageDto; page: AssemblyProcedureDocumentPageDto }>>(new Map());
  const pages = useMemo(() => {
    const grouped = new Map<number, typeof controllerElements>();
    for (const element of controllerElements) {
      const group = grouped.get(element.pageIndex);
      if (group) group.push(element);
      else grouped.set(element.pageIndex, [element]);
    }
    const previous = previousPages.current;
    const cache = new Map<number, { source: AssemblyProcedureDocumentPageDto; page: AssemblyProcedureDocumentPageDto }>();
    const next = controllerPages.map(page => {
      const overlays = grouped.get(page.pageIndex) ?? [];
      const cached = previous.get(page.pageIndex);
      const reused = cached && cached.source === page &&
        cached.page.overlays?.length === overlays.length &&
        cached.page.overlays.every((element, index) => element === overlays[index]) ? cached.page : null;
      const value = reused ?? { ...page, overlays };
      cache.set(page.pageIndex, { source: page, page: value });
      return value;
    });
    previousPages.current = cache;
    return next;
  }, [controllerElements, controllerPages]);
  const selectedPage = controller.selectedPage;
  const documentId = controller.document?.id;
  const pagePosition = pages.findIndex(page => page.pageIndex === selectedPage?.pageIndex);
  const canShowTwoPage = !narrowEditor && !cleanView && pages.length > 1 && pagePosition >= 0;
  const twoPage = canShowTwoPage && twoPageEnabled;
  const [spread, setSpread] = useState({ documentId, start: 0 });
  const keepSpread = twoPage && spread.documentId === documentId && spread.start < pages.length - 1 &&
    (pagePosition === spread.start || pagePosition === spread.start + 1);
  const spreadStart = keepSpread ? spread.start : Math.max(0, Math.min(pagePosition, pages.length - 2));
  const adjacentPage = twoPage ? pages[pagePosition === spreadStart ? spreadStart + 1 : spreadStart] : undefined;
  if (spread.documentId !== documentId || spread.start !== spreadStart) {
    setSpread({ documentId, start: spreadStart });
  }
  const toggleTwoPage = useCallback(() => {
    if (overlayInteractionActive.current) return;
    toggleTwoPageEnabled();
  }, [toggleTwoPageEnabled]);
  const visibleElements = useMemo(() => controller.layoutSuggestions.previewElements ??
    (controller.layoutSuggestions.locked ? controller.selectedPageElements :
      controller.selectedPageElements.filter(element => !hiddenOverlayIds.has(element.id))),
  [controller.layoutSuggestions.previewElements, controller.layoutSuggestions.locked, controller.selectedPageElements, hiddenOverlayIds]);
  const canvasElements = useMemo(() => {
    if (!rotationPreview || controller.layoutSuggestions.locked) return visibleElements;
    const byId = new Map(rotationPreview.elements.map(element => [element.id, element]));
    return visibleElements.map(element => byId.get(element.id) ?? element);
  }, [rotationPreview, controller.layoutSuggestions.locked, visibleElements]);
  const placeMaterial = useCallback(async (...args: Parameters<typeof placeControllerMaterial>) => {
    await placeControllerMaterial(...args);
    refreshMaterials();
  }, [placeControllerMaterial, refreshMaterials]);
  const replaceImageMaterial = useCallback(async (material: Parameters<typeof replaceControllerImageMaterial>[0]) => {
    await replaceControllerImageMaterial(material);
    refreshMaterials();
  }, [replaceControllerImageMaterial, refreshMaterials]);
  const materialDrag = useMaterialDrag({
    layerRef: overlayLayerRef,
    elements: visibleElements,
    adjacentPage: adjacentPage && { layerRef: adjacentLayerRef, pageIndex: adjacentPage.pageIndex, elements: adjacentPage.overlays ?? [] },
    enabled: !cleanView && !controller.readOnly && !controller.busy && !controller.conflict && !controller.layoutSuggestions.locked && controller.editLeaseMine,
    pageIndex: controller.selectedPageIndex,
    place: placeMaterial,
    onError: error => controller.setErrorMessage(readAssemblyApiErrorMessage(error, '素材の配置に失敗しました。'))
  });
  const closeInspector = useCallback(() => setSelectedOverlayId(null), [setSelectedOverlayId]);
  const readPhotoText = useMemo(() => documentId ? (image: AssemblyProcedureImageOverlayElement) => findAssemblyProcedureTextCandidates({
    id: documentId, accessPassword: controller.passwordInput, pageIndex: image.pageIndex, bbox: image.bbox, photoOnly: true,
    overlays: [{ assetId: image.assetId, bbox: image.bbox, zIndex: image.zIndex, objectFit: image.objectFit }]
  }) : undefined, [documentId, controller.passwordInput]);
  const replaceImage = useCallback(() => { setMaterialShelfMode('replace'); setMaterialShelfOpen(true); }, []);
  const rotateImage = useCallback((direction: 'left' | 'right') => {
    const layer = overlayLayerRef.current;
    if (layer?.clientHeight) void rotateSelectedImage(direction, layer.clientWidth / layer.clientHeight, preload);
  }, [preload, rotateSelectedImage]);
  const openMaterial = useCallback(() => { setMaterialShelfMode('place'); setMaterialShelfOpen(true); }, []);
  const openVideo = useCallback(() => setVideoLinkOpen(true), []);
  const openPublish = useCallback(() => setPublishOpen(true), []);
  const addBlankPage = useCallback(() => void addControllerBlankPage(), [addControllerBlankPage]);
  const openPageImport = useCallback(() => { setErrorMessage(null); setImportPagesOpen(true); }, [setErrorMessage]);
  const toolbarController = useMemo(() => ({
    readOnly: controller.readOnly, busy: controller.busy, saving: controller.saving, isDirty: controller.isDirty,
    canSave: controller.canSave, canPublish: controller.canPublish,
    canUndo: controller.canUndo, canRedo: controller.canRedo,
    selectionMode: controller.selectionMode, selectedKind: controller.selectedElement?.kind,
    canTogglePhotoSharpen: controller.canTogglePhotoSharpen, photoSharpened: controller.photoSharpened,
    togglePhotoSharpen: controller.togglePhotoSharpen,
    layoutLocked: controller.layoutSuggestions.locked, canSuggest: controller.layoutSuggestions.canSuggest,
    startLayout: controller.layoutSuggestions.start,
    navigateBack: controller.navigateBack, save: controller.save, addOverlay: controller.addOverlay,
    setSelectionMode: controller.setSelectionMode, undo: controller.undo, redo: controller.redo
  }), [controller.readOnly, controller.busy, controller.saving, controller.isDirty, controller.canSave, controller.canPublish,
    controller.canUndo, controller.canRedo, controller.selectionMode, controller.selectedElement?.kind,
    controller.canTogglePhotoSharpen, controller.photoSharpened, controller.togglePhotoSharpen,
    controller.layoutSuggestions.locked,
    controller.layoutSuggestions.canSuggest, controller.layoutSuggestions.start, controller.navigateBack,
    controller.save, controller.addOverlay, controller.setSelectionMode, controller.undo, controller.redo]);

  const dialogOpen = materialShelfOpen || videoLinkOpen || recoveryOpen || importPagesOpen ||
    publishOpen || conflictReloadOpen || takeoverOpen || controller.pendingRange != null || controller.textCandidates.length > 0;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (cleanView || event.key !== 'Escape' || event.defaultPrevented || event.isComposing ||
        !controller.accessGranted || controller.loading || canvasSaving || overlayInteractionActive.current || controller.layoutSuggestions.locked ||
        dialogOpen || inlineEditingId || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = document.activeElement;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      setSelectedOverlayId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cleanView, controller.accessGranted, controller.loading, canvasSaving, controller.layoutSuggestions.locked, dialogOpen, inlineEditingId, setSelectedOverlayId]);

  if (!controller.accessGranted || controller.loading) {
    return <>{preloader}<AssemblyProcedureDocumentEditorAuthGate context={context} /></>;
  }

  if (!selectedPage) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 p-4 text-white" role="alert">
        {preloader}
        手順書ページがありません。
      </main>
    );
  }

  return (
    <main className={`relative grid min-h-0 flex-1 ${twoPage ? '[--details-width:200px]' : '[--details-width:min(400px,26vw)]'} max-[1099px]:[--details-width:0px] ${partsPaneOpen ? 'grid-cols-[120px_280px_minmax(0,1fr)_var(--details-width)_64px]' : 'grid-cols-[120px_0_minmax(0,1fr)_var(--details-width)_64px]'} overflow-hidden bg-[#0a0d10] text-[#eef3f6]`} data-testid="assembly-document-editor-layout">
      {preloader}
      {controller.document?.status === 'draft' && (!controller.editLeaseMine || controller.editLeaseUnavailable) ? (
        <div className="absolute bottom-16 left-[136px] z-50 flex max-w-[calc(100%-216px-var(--details-width))] flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-[#161c22] px-3 py-2" role="status">
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
      {materialDrag.shadow ? <span aria-hidden="true" data-testid="material-drag-shadow" className="pointer-events-none fixed h-10 w-14 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-blue-400 bg-white/80 shadow-xl" style={{ left: materialDrag.shadow.x, top: materialDrag.shadow.y, zIndex: 1_000_003 }} /> : null}
      {importPagesOpen && controller.document ? <AssemblyProcedureDocumentPageImportDialog
        document={controller.document}
        pages={pages}
        selectedPageIndex={selectedPage.pageIndex}
        context={context}
        disabled={controller.readOnly || controller.conflict}
        busy={controller.busy}
        error={controller.messageIsError ? controller.message : null}
        onClose={() => setImportPagesOpen(false)}
        onImport={async (sourceId, indexes, afterPageIndex) => {
          if (await controller.importPages(sourceId, indexes, afterPageIndex)) setImportPagesOpen(false);
        }}
      /> : null}
      {deletePageIndex !== null && pages.find(page => page.pageIndex === deletePageIndex) ? <AssemblyProcedureDocumentPageDeleteDialog
        page={pages.find(page => page.pageIndex === deletePageIndex)!}
        assets={controller.document?.assets}
        disabled={controller.readOnly || controller.busy || controller.conflict}
        onClose={() => setDeletePageIndex(null)}
        onDelete={() => { setDeletePageIndex(null); void controller.deletePage(deletePageIndex); }}
      /> : null}
      {videoLinkOpen && controller.document ? <ProcedureVideoShelfDialog key={`${controller.document.id}:${selectedPage.pageIndex}`} link={{ documentId: controller.document.id, pageIndex: selectedPage.pageIndex, accessPassword: controller.passwordInput, holderToken: controller.editLeaseToken }} onError={controller.onEditLeaseError} onClose={() => setVideoLinkOpen(false)} /> : null}
        <AssemblyProcedureDocumentEditorPageList
          pages={pages}
          assets={controller.document?.assets}
          selectedPageIndex={selectedPage.pageIndex}
          onSelect={controller.setSelectedPageIndex}
          onAddBlankPage={addBlankPage}
          onImportPages={openPageImport}
          onDeletePage={setDeletePageIndex}
          onMovePage={controller.movePage}
          locked={controller.layoutSuggestions.locked}
          disabled={cleanView || controller.readOnly || controller.busy || controller.conflict}
        />
        {partsPaneOpen ? <AssemblyProcedureDocumentEditorPartsPane
          materials={<DocumentEditorMaterials revision={materialRevision + (controller.materialRevision ?? 0)} disabled={cleanView || controller.readOnly || controller.busy || controller.conflict || !controller.editLeaseMine || controller.layoutSuggestions.locked} drag={materialDrag} />}
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
          readOnly={cleanView || controller.readOnly}
          busy={controller.busy}
          locked={cleanView || controller.layoutSuggestions.locked}
        /> : null}
        <button type="button" disabled={controller.layoutSuggestions.locked} aria-label={partsPaneOpen ? '部品を閉じる' : '部品を開く'} onClick={togglePartsPane} className={`absolute top-1/2 z-50 grid h-[72px] w-[22px] -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-[#344252] bg-[#161c22] text-[#9fadb9] ${partsPaneOpen ? 'left-[400px]' : 'left-[120px]'}`}>
          <span aria-hidden="true">{partsPaneOpen ? '<' : '>'}</span>
        </button>
        <section className="relative col-start-3 min-h-0 min-w-0 overflow-hidden p-2" aria-label="手順書キャンバス"
          onPointerDownCapture={event => {
            if (cleanView || canvasSaving || controller.layoutSuggestions.locked) return;
            const target = event.target as Element;
            const sheet = target.closest<HTMLElement>('[data-editor-spread-page]');
            const adjacentPage = sheet && Number(sheet.dataset.editorSpreadPage) !== selectedPage.pageIndex;
            if (!event.isPrimary || event.button !== 0 || overlayInteractionActive.current) {
              if (adjacentPage) event.stopPropagation();
              return;
            }
            if (target.closest('[data-overlay-id], [data-overlay-resize-handle], textarea, [role="status"], [role="alert"], [data-editor-approval]')) return;
            if (adjacentPage) controller.setSelectedPageIndex(Number(sheet.dataset.editorSpreadPage));
            else if (!controller.selectionMode) setSelectedOverlayId(null);
          }}>
          {cleanView ? <AssemblyProcedureCleanView
            key={`${controller.document?.id}:${selectedPage.pageIndex}`}
            name={controller.document?.name ?? '手順書'}
            pageNumber={selectedPage.pageIndex + 1}
            pageCount={pages.length}
            steps={cleanSteps}
            assets={controller.document?.assets}
          /> : <div className={twoPage ? 'grid h-full grid-cols-2 grid-rows-1 gap-4' : 'contents'}>
            {(twoPage ? pages.slice(spreadStart, spreadStart + 2) : [selectedPage]).map(page => {
              const current = page.pageIndex === selectedPage.pageIndex;
              return <div key={`${documentId}:${page.pageIndex}`}
                data-editor-spread-page={twoPage ? page.pageIndex : undefined}
                className={twoPage ? 'min-h-0 min-w-0 overflow-hidden' : 'contents'}>
                <AssemblyProcedureDocumentEditorCanvas
                  spreadPage={twoPage ? (current ? 'current' : 'adjacent') : undefined}
                  saving={canvasSaving}
                  onUpdateText={current && live.status === 'idle' ? controller.commitInlineText : undefined}
                  registerInlineTextFlush={current ? controller.registerInlineTextFlush : undefined}
                  onInlineEditingChange={current ? setInlineEditingId : undefined}
                  onDraftChange={current ? controller.onInlineDraftChange : undefined}
                  layerRef={current ? overlayLayerRef : adjacentLayerRef}
                  materialPreview={materialDrag.preview?.pageIndex === page.pageIndex ? materialDrag.preview : undefined}
                  pageUrl={page.imageRelativePath}
                  pageIndex={page.pageIndex}
                  elements={current ? canvasElements : (page.overlays ?? [])}
                  imageAngles={current ? rotationPreview?.imageAngles : undefined}
                  selectionMode={current && controller.selectionMode}
                  editable={!controller.readOnly && (current || !controller.selectionMode)}
                  locked={controller.layoutSuggestions.locked}
                  selectedOverlayId={current ? controller.selectedOverlayId : null}
                  onSelectOverlay={current ? controller.setSelectedOverlayId : id => {
                    if (controller.selectionMode) controller.setSelectionMode(false);
                    controller.setSelectedPageIndex(page.pageIndex, id);
                  }}
                  onNudgeOverlay={current ? controller.nudgeElement : undefined}
                  onUpdateOverlayBBox={controller.updateElementBBox}
                  onInteractionStart={() => { overlayInteractionActive.current = true; controller.beginOverlayDrag(); }}
                  onInteractionEnd={() => { overlayInteractionActive.current = false; controller.endOverlayDrag(); }}
                  onRangeSelected={controller.handleRangeSelected}
                  assets={controller.document?.assets}
                  className="h-full w-full !bg-[#0a0d10]"
                />
              </div>;
            })}
          </div>}
          {!cleanView ? <AssemblyProcedureLayoutSuggestionPanel suggestions={controller.layoutSuggestions} /> : null}
          {controller.document?.lastApproval ? <p data-editor-approval className="absolute bottom-16 left-4 max-w-[calc(100%-32px)] rounded bg-[#161c22eb] px-3 py-1 text-xs text-[#9fadb9]">
            承認: {controller.document.lastApproval.employeeName}{controller.document.lastApproval.positionName ? `(${controller.document.lastApproval.positionName})` : ''} {new Date(controller.document.lastApproval.approvedAt).toLocaleString('ja-JP')}
          </p> : null}
          {controller.message && controller.message !== dismissedMessage && !(importPagesOpen && controller.messageIsError) ? (
            <div className={`absolute bottom-4 left-4 z-40 flex min-h-11 max-w-[calc(100%-32px)] flex-col justify-center rounded-lg border px-3.5 py-2 text-lg ${controller.messageIsError || controller.conflict ? 'border-[#e5484d] bg-[#161c22eb] text-[#e5484d]' : 'border-[#344252] bg-[#161c22eb]'}`} role={controller.messageIsError || controller.conflict ? 'alert' : 'status'}>
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
        <aside className={`col-start-4 flex min-h-0 min-w-0 flex-col border-l border-[#27313b] bg-[#161c22] [container:assembly-details/inline-size] max-[1099px]:absolute max-[1099px]:col-auto max-[1099px]:right-20 max-[1099px]:top-4 max-[1099px]:bottom-4 max-[1099px]:z-50 max-[1099px]:w-[340px] max-[1099px]:rounded-[14px] max-[1099px]:border max-[1099px]:bg-[#161c22f5] ${partsPaneOpen ? 'max-[1099px]:max-w-[calc(100%-480px)]' : 'max-[1099px]:max-w-[calc(100%-200px)]'} ${!cleanView && controller.selectedElement ? '' : 'max-[1099px]:hidden'}`} data-testid="assembly-document-editor-details">
          <div className="flex shrink-0 flex-col items-start gap-2 border-b border-[#27313b] px-[14px] py-[10px] text-[17px] text-[#9fadb9]">
            <b className="w-full whitespace-normal break-words text-[#eef3f6]">{context ? [context.processName.startsWith('共通') ? '' : context.modelCode, context.processName, controller.document?.name ?? '要領書'].filter(Boolean).join(' › ') : controller.document?.name ?? '手順書'}</b>
            {context ? <span className={`inline-flex h-[26px] shrink-0 items-center rounded-full border px-2.5 text-[15px] font-bold [@container_assembly-details_(width<300px)]:h-auto [@container_assembly-details_(width<300px)]:min-h-[26px] [@container_assembly-details_(width<300px)]:max-w-full [@container_assembly-details_(width<300px)]:rounded-[13px] [@container_assembly-details_(width<300px)]:py-0.5 ${context.mode === 'make' ? 'border-[#3ba776] text-[#3ba776]' : 'border-[#f6b93b] text-[#f6b93b]'}`}>
              {context.mode === 'make' ? '作る' : '直す'} · {controller.document?.supersedesDocumentId ? '改版の下書き' : '下書き'} 第{controller.document?.revisionNumber ?? 1}版
            </span> : null}
          </div>
        {!cleanView && controller.selectedElement ? <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AssemblyProcedureDocumentEditorInspector
          key={voiceInputEnabled ? `${controller.document?.id}:${controller.selectedElement.id}` : undefined}
          textReadOnly={inlineEditingId === controller.selectedElement.id}
          voiceInputEnabled={voiceInputEnabled}
          voiceContext={voiceContext}
          documentId={controller.document?.id}
          holderToken={controller.editLeaseToken}
          readPhotoText={readPhotoText}
          element={controller.selectedElement}
          onClose={closeInspector}
          onDuplicate={controller.duplicateSelectedOverlay}
          onUpdate={controller.updateElement}
          meeting={meeting}
          live={live}
          onDelete={controller.deleteSelectedOverlay}
          onBringForward={controller.bringForward}
          onSendBackward={controller.sendBackward}
          onBringToFront={controller.bringToFront}
          onSendToBack={controller.sendToBack}
          onReplaceImage={replaceImage}
          onRotateImage={rotateImage}
          canQueueRotation={controller.canQueueRotation}
          onRefetchTextCandidates={controller.refetchTextCandidates}
          readOnly={controller.readOnly}
          busy={controller.busy}
        />
        </div> : null}
        </aside>
        <AssemblyProcedureDocumentEditorCanvasToolbar controller={toolbarController} workshop={Boolean(context)} materialCount={materialCount} materialOpen={materialShelfOpen} videoOpen={videoLinkOpen}
          voiceInputEnabled={voiceInputEnabled} onToggleVoiceInput={toggleVoiceInput}
          cleanView={cleanView} canShowCleanView={canShowCleanView} onToggleCleanView={toggleCleanView}
          twoPage={twoPage} onToggleTwoPage={canShowTwoPage ? toggleTwoPage : undefined}
          onMaterial={openMaterial} onVideo={openVideo} onPublish={openPublish} />

      {materialShelfOpen ? <ProcedureMaterialShelfDialog resources={shelfResources} mode={materialShelfMode} onClose={() => setMaterialShelfOpen(false)} onSelect={materialShelfMode === 'replace' ? replaceImageMaterial : placeMaterial} onCreatedDocument={async (documentId) => {
        setMaterialShelfOpen(false);
        if (await controller.confirmNavigation()) onNavigateToDocument(documentId);
      }} /> : null}
      <AssemblyProcedureOverlayTypeDialog
        isOpen={controller.pendingRange != null}
        onClose={controller.cancelPendingRange}
        onSelect={(kind) => {
          const layer = overlayLayerRef.current;
          const heightToWidth = layer?.clientWidth ? layer.clientHeight / layer.clientWidth : undefined;
          void controller.createOverlay(kind, heightToWidth);
        }}
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
