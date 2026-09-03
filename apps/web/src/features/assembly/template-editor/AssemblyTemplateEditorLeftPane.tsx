import { Button } from '../../../components/ui/Button';
import { AssemblyProcedureStoryboard } from '../AssemblyProcedureStoryboard';
import { AssemblyTemplateProcedurePane } from '../AssemblyTemplateProcedurePane';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

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
  return procedurePaneOpen ? (
    <aside className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
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
      {leftPaneTab === 'steps' ? (
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
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
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
      )}
    </aside>
  ) : null;
}
