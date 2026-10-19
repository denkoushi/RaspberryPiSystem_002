import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { useProtectedImageBlobUrl } from '../../../hooks/useProtectedImageBlobUrl';
import { KioskSopLauncher } from '../../kiosk-sop';
import { AssemblyProcedureStoryboard } from '../AssemblyProcedureStoryboard';
import { kioskAssemblyTemplateNewPath } from '../assemblyRoutes';
import { formatAssemblyEditorName } from '../assemblyTemplateGuidePresentation';
import { AssemblyTemplateProcedurePane } from '../AssemblyTemplateProcedurePane';

import { useAssemblyTemplateEditor, useAssemblyTemplateEditorNavigation } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorHeader } from './AssemblyTemplateEditorHeader';

export function AssemblyTemplateEditorLeftPane() {
  const {
    addArea,
    areas,
    busy,
    changeModelCode,
    changeProcedurePattern,
    changeTemplateName,
    dispatchProcedureItems,
    dispatchSteps: dispatchProcedureSteps,
    displayProcedureItems,
    expandedAreaDetails,
    focusItem: focusProcedureItem,
    focusProcedureStep,
    incompleteAreaIds,
    leftPaneTab,
    machineNameSelectionRequired,
    markerProjectionByStepId,
    modelCode,
    moveArea,
    pageOptions,
    procedurePattern,
    procedureSteps,
    readOnly,
    removeProcedureItem,
    removeProcedureStep,
    requestDeleteArea,
    restoreSuggestedTemplateName,
    selectedArea,
    selectedAreaId,
    selectedDocumentId,
    selectedPageKey,
    selectedStep,
    selectArea,
    setAreaPatch,
    setDocumentLibraryOpen,
    setLeftPaneTab,
    setMachineNamePickerOpen,
    templateName,
    loadedTemplate,
    visibleCheckItems,
    setSelectedPageKey,
    templateNameAutomatic,
    templateId,
    toggleAreaDetails
  } = useAssemblyTemplateEditor();
  const nameRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = nameRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
  }, [templateName]);
  const { renderLink } = useAssemblyTemplateEditorNavigation();
  const procedurePane = (
    <div className="min-w-0">
      <AssemblyTemplateProcedurePane
        items={displayProcedureItems}
        selectedPageKey={selectedPageKey}
        selectedDocumentId={selectedDocumentId}
        areas={areas}
        incompleteAreaIds={incompleteAreaIds}
        selectedArea={selectedArea}
        selectedAreaId={selectedAreaId}
        expandedAreaDetails={expandedAreaDetails}
        onToggleAreaDetails={toggleAreaDetails}
        hideTemplateName
        templateName={templateName}
        modelCode={modelCode}
        machineNameSelectionRequired={machineNameSelectionRequired}
        identityLocked={Boolean(templateId)}
        procedurePattern={procedurePattern}
        templateNameAutomatic={templateNameAutomatic}
        busy={busy}
        readOnly={readOnly}
        onOpenDocumentLibrary={() => setDocumentLibraryOpen(true)}
        onFocusItem={focusProcedureItem}
        onRemoveItem={removeProcedureItem}
        onLabelChange={(localId, label) =>
          dispatchProcedureItems({ type: 'set_label', localId, label })
        }
        onTemplateNameChange={changeTemplateName}
        onRestoreSuggestedTemplateName={restoreSuggestedTemplateName}
        onModelCodeChange={changeModelCode}
        onOpenMachineNamePicker={() => setMachineNamePickerOpen(true)}
        onProcedurePatternChange={changeProcedurePattern}
        onSelectArea={selectArea}
        onAddArea={addArea}
        onMoveArea={moveArea}
        onDeleteArea={requestDeleteArea}
        onAreaPatch={setAreaPatch}
      />
    </div>
  );
  const storyboard = (
    <AssemblyProcedureStoryboard
      steps={procedureSteps}
      pages={pageOptions}
      selectedLocalId={selectedStep?.localId ?? null}
      readOnly={readOnly}
      onSelect={(localId) => {
        const step = procedureSteps.find((item) => item.localId === localId);
        if (step) focusProcedureStep(step);
      }}
      onMove={(localId, delta) =>
        dispatchProcedureSteps({ type: 'move', localId, delta })
      }
      onMoveTo={(localId, targetIndex) =>
        dispatchProcedureSteps({ type: 'move_to', localId, targetIndex })
      }
      onDuplicate={(localId) =>
        dispatchProcedureSteps({ type: 'duplicate', localId })
      }
      onRemove={removeProcedureStep}
      markerProjectionByStepId={markerProjectionByStepId}
    />
  );
  return (
    <aside data-testid="assembly-template-editor-left-pane" className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-r border-[#27313b] bg-[#161c22] p-3.5">
      <div className="flex shrink-0 flex-col gap-3">
        <AssemblyTemplateEditorHeader />
        <label className="grid gap-2 text-base font-bold tracking-wider text-[#9fb0c0]">
          テンプレート名
          <textarea ref={nameRef} rows={2} id="assembly-template-name" data-kiosk-sop-target="assembly-editor-template-name" className="min-h-[4.5rem] min-w-0 w-full resize-none whitespace-pre-wrap break-all overflow-hidden rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-xl leading-6 text-slate-900 focus:border-emerald-500 focus:outline-none" value={templateName} title={templateName} maxLength={200} disabled={busy || readOnly} onChange={(event) => changeTemplateName(event.target.value)} />
        </label>
        {!templateNameAutomatic ? <button type="button" className="text-right text-xs text-cyan-200 disabled:opacity-40" disabled={busy || readOnly} onClick={restoreSuggestedTemplateName}>自動提案に戻す</button> : null}
      </div>
      <div role="tablist" aria-label="左ペインの表示" className="grid shrink-0 grid-cols-3 gap-1">
        {([['areas', '工程'], ['documents', '文書'], ['steps', '手順']] as const).map(([tab, label]) => (
          <Button
            key={tab}
            type="button"
            role="tab"
            id={`assembly-left-tab-${tab}`}
            aria-selected={leftPaneTab === tab}
            aria-controls={`assembly-left-panel-${tab}`}
            data-kiosk-sop-target={tab === 'documents' ? 'assembly-editor-help' : undefined}
            variant={leftPaneTab === tab ? 'primary' : 'ghostOnDark'}
            className="h-11 min-h-11 !px-1 !py-0 text-xs"
            onClick={() => setLeftPaneTab(tab)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`assembly-left-panel-${leftPaneTab}`}
        aria-labelledby={`assembly-left-tab-${leftPaneTab}`}
        className={`flex min-w-0 flex-1 shrink-0 flex-col ${leftPaneTab === 'steps' ? 'min-h-[16rem]' : ''}`}
      >
        {leftPaneTab === 'areas' ? <div className="grid gap-3">
          <section aria-label="工程" className="grid gap-2">
            <h2 className="text-base font-bold tracking-wider text-[#9fb0c0]">工程</h2>
            <div className="grid gap-1.5">
              {areas.map((area, index) => <button key={area.id} type="button" aria-current={area.id === selectedAreaId ? 'true' : undefined} className="grid min-h-14 content-center gap-0.5 rounded-lg border border-[#344252] px-3 py-1.5 text-left aria-[current=true]:border-white aria-[current=true]:bg-[#27313b]" onClick={() => selectArea(area.id)}>
                <span className="truncate text-xl font-bold">{formatAssemblyEditorName([area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-') || area.areaName.trim() || `工程 ${index + 1}`)}</span>
                <span className="font-mono text-[15px] text-[#9fb0c0]">締付 <b className="font-normal text-[#f6b93b]">{area.bolts.length}</b>{visibleCheckItems.length > 0 ? ` · チェック ${visibleCheckItems.length}` : ''}</span>
              </button>)}
              <button type="button" data-kiosk-sop-target="assembly-editor-area-add" className="min-h-11 rounded-lg border border-dashed border-[#344252] text-lg text-[#9fb0c0] disabled:opacity-40" disabled={busy || readOnly} onClick={addArea}>＋ 工程</button>
            </div>
          </section>
          <section aria-label="ページ" className="grid gap-2">
            <h2 className="text-base font-bold tracking-wider text-[#9fb0c0]">ページ</h2>
            <div className="grid grid-cols-2 gap-2">
              {pageOptions.map((page) => <button key={page.key} type="button" aria-label={page.label} aria-current={page.key === selectedPageKey ? 'true' : undefined} className="relative aspect-[1/1.414] overflow-hidden rounded border-2 border-transparent bg-white aria-[current=true]:border-[#5ec4ff]" onClick={() => setSelectedPageKey(page.key)}>
                <PageThumbnail path={page.imageRelativePath} />
                <span className="absolute bottom-1 left-1.5 bg-white/90 px-1 font-mono text-sm text-[#333]">{page.pageIndex + 1}</span>
              </button>)}
            </div>
          </section>
        </div> : leftPaneTab === 'documents' ? procedurePane : storyboard}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 pt-3 text-xs text-[#9fb0c0]">
        <KioskSopLauncher manualId="assembly-procedure-template" initialSheetId={templateId ? 'assembly-revision' : 'assembly-template-auth-basics'} className="!min-h-8 !border-0 !bg-transparent !px-0 !text-xs" />
        {loadedTemplate ? renderLink({ to: kioskAssemblyTemplateNewPath({ sourceTemplateId: loadedTemplate.id }), className: 'text-xs', children: '複製して新規' }) : null}
      </div>
    </aside>
  );
}

function PageThumbnail({ path }: { path: string }) {
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const thumbnail = thumbnailRef.current;
    if (!thumbnail || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      setRequested(entries.some((entry) => entry.isIntersecting));
    }, { root: thumbnail.closest('[data-testid="assembly-template-editor-left-pane"]'), rootMargin: '200px' });
    observer.observe(thumbnail);
    return () => observer.disconnect();
  }, []);
  return <div ref={thumbnailRef} className="h-full w-full">{requested ? <PageThumbnailImage path={path} /> : null}</div>;
}

function PageThumbnailImage({ path }: { path: string }) {
  const { blobUrl } = useProtectedImageBlobUrl(path);
  return blobUrl ? <img src={blobUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : null;
}
