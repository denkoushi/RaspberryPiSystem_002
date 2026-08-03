import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import { AssemblyProcedureMarkerLayer } from '../AssemblyProcedureMarkerLayer';

import { AssemblyTemplateEditorCanvasToolbar } from './AssemblyTemplateEditorCanvasToolbar';
import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorCanvasPane() {
  const {
    addBoltAt,
    addCheckItemAt,
    addCurrentCropStep,
    canvasZoom,
    cropVisibleBolts,
    cropVisibleCheckItems,
    markerMode,
    patchProcedureStep,
    placementAction,
    placeOnSelectedCropAt,
    placeSelectedCalloutAt,
    readOnly,
    selectedBolt,
    selectedBoltId,
    selectedCheckItem,
    selectedCheckItemId,
    selectedDocument,
    selectedPage,
    selectedStep,
    selectedStepPage,
    selectBolt,
    selectCheckItem,
    showSelectedCrop,
    visibleBolts,
    visibleCheckItems
  } = useAssemblyTemplateEditor();
  return (
  <section
    data-testid="assembly-unified-editor-canvas-pane"
    className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0"
  >
    <AssemblyTemplateEditorCanvasToolbar />
    <div className="min-h-0 flex-1">
      {showSelectedCrop && selectedStep?.crop && selectedPage ? (
        <div className="relative h-full w-full bg-slate-950 p-2">
          <AssemblyProcedureCropView
            pageUrl={selectedPage.imageRelativePath}
            crop={selectedStep.crop}
            className="h-full w-full"
            overlay={
              <AssemblyProcedureMarkerLayer
                bolts={cropVisibleBolts}
                checkItems={cropVisibleCheckItems}
                selectedBoltId={selectedBoltId}
                selectedCheckItemId={selectedCheckItemId}
              onSelectBolt={selectBolt}
              onSelectCheckItem={selectCheckItem}
              />
            }
            onPlacementClick={
              readOnly ||
              (placementAction === 'callout' &&
                (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem))
                ? undefined
                : placeOnSelectedCropAt
            }
          />
        </div>
      ) : (
      <AssemblyProcedureCanvas
        imageRelativePath={selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath}
        bolts={visibleBolts}
        checkItems={visibleCheckItems}
        selectedBoltId={selectedBoltId}
        selectedCheckItemId={selectedCheckItemId}
          onSelectBolt={selectBolt}
          onSelectCheckItem={selectCheckItem}
        onAddBolt={readOnly || markerMode !== 'bolt' || placementAction !== 'place' ? undefined : addBoltAt}
        onAddCheckItem={readOnly || markerMode !== 'check' || placementAction !== 'place' ? undefined : addCheckItemAt}
        onPlaceCallout={
          readOnly || placementAction !== 'callout' || (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)
            ? undefined
            : placeSelectedCalloutAt
        }
        onCreateCrop={
          readOnly || placementAction !== 'crop' ? undefined : addCurrentCropStep
        }
        cropRect={
          selectedStep?.viewMode === 'crop' &&
          selectedStepPage?.key === selectedPage?.key
            ? selectedStep.crop
            : null
        }
        onCropChange={
          readOnly || selectedStep?.viewMode !== 'crop'
            ? undefined
            : (crop) => patchProcedureStep(selectedStep.localId, { crop })
        }
        placementMode={markerMode}
        placementAction={placementAction}
        zoom={canvasZoom.zoom}
        fitGeneration={canvasZoom.fitGeneration}
        className="h-full"
      />
      )}
    </div>
  </section>
  );
}
