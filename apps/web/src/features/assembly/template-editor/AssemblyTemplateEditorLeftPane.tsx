import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { AssemblyProcedureStoryboard } from '../AssemblyProcedureStoryboard';
import { AssemblyTemplateProcedurePane } from '../AssemblyTemplateProcedurePane';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorLeftPane() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1280
  );
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 1280);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
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
    procedurePaneOpen,
    procedurePattern,
    procedureSteps,
    procedureSearchResetToken,
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
    templateNameAutomatic,
    templateId,
    toggleAreaDetails
  } = useAssemblyTemplateEditor();
  const procedurePane = (
    <div className="min-h-0 min-w-0 overflow-auto border-b border-white/10 xl:max-h-[52%] xl:shrink-0">
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
      searchResetToken={procedureSearchResetToken}
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
  return procedurePaneOpen ? (
    <aside
      data-testid="assembly-template-editor-left-pane"
      className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0"
    >
      <div className="hidden shrink-0 items-center gap-1 border-b border-white/10 p-1 xl:flex">
        <Button
          type="button"
          variant={leftPaneTab === 'documents' ? 'primary' : 'ghostOnDark'}
          className="min-h-10 flex-1 !px-1 text-xs"
          aria-expanded={leftPaneTab === 'documents'}
          aria-controls="assembly-procedure-pane"
          aria-label="文書・工程"
          onClick={() => setLeftPaneTab(leftPaneTab === 'documents' ? 'steps' : 'documents')}
        >
          文書・工程 {leftPaneTab === 'documents' ? 'を閉じる' : 'を開く'}
        </Button>
        <Button
          type="button"
          variant={leftPaneTab === 'steps' ? 'primary' : 'ghostOnDark'}
          className="min-h-10 flex-1 !px-1 text-xs"
          aria-controls="assembly-step-storyboard"
          onClick={() => setLeftPaneTab('steps')}
        >
          手順
        </Button>
      </div>
      {!isDesktop ? <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-white/10 p-1">
          <Button
            type="button"
            variant={leftPaneTab === 'steps' ? 'primary' : 'ghostOnDark'}
            className="min-h-10 !px-1 text-xs"
            onClick={() => setLeftPaneTab('steps')}
          >
            手順
          </Button>
          <Button
            type="button"
            variant={leftPaneTab === 'documents' ? 'primary' : 'ghostOnDark'}
            className="min-h-10 !px-1 text-xs"
            onClick={() => setLeftPaneTab('documents')}
          >
            文書・工程
          </Button>
        </div>
        {leftPaneTab === 'steps' ? storyboard : <div className="min-h-0 flex-1 overflow-auto">{procedurePane}</div>}
      </div> : null}
      {isDesktop ? <div className="flex min-h-0 flex-1 flex-col">
        {leftPaneTab === 'documents' ? procedurePane : null}
        {storyboard}
      </div> : null}
    </aside>
  ) : null;
}
