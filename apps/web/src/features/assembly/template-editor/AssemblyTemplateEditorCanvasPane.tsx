import { clampImageMarkerRatio } from '../../kiosk/image-canvas';
import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import {
  AssemblyProcedureMarkerLayer,
  type AssemblyProcedureMarkerPoint
} from '../AssemblyProcedureMarkerLayer';
import { assemblyProcedureViewPointToSourcePoint } from '../assemblyProcedureMarkerProjection';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

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
    setCheckItemPatch,
    setBoltPatch,
    selectBolt,
    selectCheckItem,
    showSelectedCrop,
    visibleBolts,
    visibleCheckItems
  } = useAssemblyTemplateEditor();
  const selectedProcedurePage =
    selectedPage?.source === 'assembly_procedure_document' &&
    selectedPage.documentId === selectedDocument?.id
      ? selectedDocument.pages.find((page) => page.pageIndex === selectedPage.pageIndex)
      : null;
  const procedureOverlay = selectedProcedurePage?.overlays ?? [];
  const moveBoltOnFullPage = readOnly
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => {
        setBoltPatch(id, point);
      };
  const moveBoltInCrop = readOnly || !selectedStep?.crop
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => {
        const sourcePoint = assemblyProcedureViewPointToSourcePoint(point, selectedStep.crop);
        setBoltPatch(id, {
          xRatio: clampImageMarkerRatio(sourcePoint.xRatio),
          yRatio: clampImageMarkerRatio(sourcePoint.yRatio)
        });
      };
  const moveCheckItemOnFullPage = readOnly
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => {
        setCheckItemPatch(id, point);
      };
  const moveCheckItemInCrop = readOnly || !selectedStep?.crop
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => {
        const sourcePoint = assemblyProcedureViewPointToSourcePoint(point, selectedStep.crop);
        setCheckItemPatch(id, {
          xRatio: clampImageMarkerRatio(sourcePoint.xRatio),
          yRatio: clampImageMarkerRatio(sourcePoint.yRatio)
        });
      };
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
              <>
                <AssemblyProcedureOverlayLayer
                  elements={procedureOverlay}
                  crop={selectedStep.crop}
                  assets={selectedDocument?.assets}
                />
                <AssemblyProcedureMarkerLayer
                  bolts={cropVisibleBolts}
                  checkItems={cropVisibleCheckItems}
                  selectedBoltId={selectedBoltId}
                  selectedCheckItemId={selectedCheckItemId}
                  onSelectBolt={selectBolt}
                  onMoveBolt={moveBoltInCrop}
                  onMoveCheckItem={moveCheckItemInCrop}
                  onSelectCheckItem={selectCheckItem}
                />
              </>
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
        onMoveBolt={moveBoltOnFullPage}
        onMoveCheckItem={moveCheckItemOnFullPage}
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
        overlay={
          <AssemblyProcedureOverlayLayer
            elements={procedureOverlay}
            assets={selectedDocument?.assets}
          />
        }
        zoom={canvasZoom.zoom}
        fitGeneration={canvasZoom.fitGeneration}
        className="h-full"
      />
      )}
    </div>
  </section>
  );
}
