import { clampImageMarkerRatio, setImageMarkerCalloutTip } from '../../kiosk/image-canvas';
import { tintAssemblyBoltsByCondition, formatAssemblyBoltConditionSpec } from '../assemblyBoltConditionPalette';
import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import {
  AssemblyProcedureMarkerLayer,
  type AssemblyProcedureMarkerPoint
} from '../AssemblyProcedureMarkerLayer';
import { assemblyProcedureViewPointToSourcePoint } from '../assemblyProcedureMarkerProjection';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';
import { assemblyEditorPageName, formatAssemblyEditorName } from '../assemblyTemplateGuidePresentation';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorCanvasPane() {
  const {
    activeBoltConditionKey,
    pageOptions,
    setBoltConditionPaneOpen,
    addBoltAt,
    addCheckItemAt,
    addCurrentCropStep,
    areas,
    boltConditionPalette,
    canvasZoom,
    cropVisibleBolts,
    cropVisibleCheckItems,
    markerMode,
    patchProcedureStep,
    placementAction,
    placeOnSelectedCropAt,
    readOnly,
    selectedAreaId,
    selectedBoltId,
    selectedCheckItemId,
    selectedDocument,
    selectedPage,
    selectedStep,
    selectedStepPage,
    setCheckItemPatch,
    setBoltPatch,
    selectArea,
    selectBolt,
    selectCheckItem,
    showSelectedCrop,
    visibleBolts,
    visibleCheckItems
  } = useAssemblyTemplateEditor();
  const documentPageCount = pageOptions.filter((page) => page.documentId === selectedPage?.documentId && page.source === selectedPage?.source).length;
  const condition = (boltConditionPalette.find((entry) => entry.key === activeBoltConditionKey) ?? boltConditionPalette[0])?.condition;
  const selectedProcedurePage =
    selectedPage?.source === 'assembly_procedure_document' &&
    selectedPage.documentId === selectedDocument?.id
      ? selectedDocument.pages.find((page) => page.pageIndex === selectedPage.pageIndex)
      : null;
  const procedureOverlay = selectedProcedurePage?.overlays ?? [];
  // 取っ手のドラッグ先を矢視の先端にする。矩形表示では元ページの座標へ戻す。
  const calloutPatch = (point: AssemblyProcedureMarkerPoint) => {
    const source = showSelectedCrop && selectedStep?.crop
      ? assemblyProcedureViewPointToSourcePoint(point, selectedStep.crop)
      : point;
    return setImageMarkerCalloutTip(clampImageMarkerRatio(source.xRatio), clampImageMarkerRatio(source.yRatio));
  };
  const moveBoltCallout = readOnly
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => setBoltPatch(id, calloutPatch(point));
  const moveCheckItemCallout = readOnly
    ? undefined
    : (id: string, point: AssemblyProcedureMarkerPoint) => setCheckItemPatch(id, calloutPatch(point));
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
    className="relative min-h-0 min-w-0 overflow-hidden bg-[#0a0d10]"
  >
    <div className="pointer-events-none absolute left-4 right-4 top-3 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 overflow-x-auto" data-testid="assembly-template-page-heading">
        <span className="flex h-9 min-w-0 max-w-[60%] shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[#344252] bg-[#161c22]/90 px-3 text-[17px] text-[#9fb0c0]">
          <b className="min-w-0 truncate text-[#eef3f6]">{selectedPage ? assemblyEditorPageName(selectedPage.label, selectedPage.pageIndex) : '手順書を選択'}</b>
          {selectedPage ? ` · ${selectedPage.pageIndex + 1} / ${documentPageCount} ページ` : null}
        </span>
        {areas.map((area, index) => <button key={area.id} type="button" aria-pressed={area.id === selectedAreaId} className="h-9 shrink-0 rounded-lg border border-[#344252] bg-[#161c22]/90 px-3 text-[17px] aria-pressed:border-white" onClick={() => selectArea(area.id)}>
          {formatAssemblyEditorName([area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-') || area.areaName.trim() || `工程 ${index + 1}`)}
        </button>)}
      </div>
      <button type="button" className="pointer-events-auto flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[#344252] bg-[#161c22]/90 px-3 text-[17px] text-[#9fb0c0]" onClick={() => setBoltConditionPaneOpen(true)}>
        締付条件 <b className="text-[#f6b93b]">{condition ? `${formatAssemblyBoltConditionSpec(condition)} ${condition.nominalTorque ?? '-'} ${condition.unit}` : '未設定'}</b>
      </button>
    </div>
    <div className="h-full min-h-0 p-4">
      {showSelectedCrop && selectedStep?.crop && selectedPage ? (
        <div className="relative h-full w-full bg-slate-950">
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
                  bolts={tintAssemblyBoltsByCondition(cropVisibleBolts, areas, boltConditionPalette)}
                  checkItems={cropVisibleCheckItems}
                  selectedBoltId={selectedBoltId}
                  selectedCheckItemId={selectedCheckItemId}
                  onSelectBolt={selectBolt}
                  onMoveBolt={moveBoltInCrop}
                  onMoveCheckItem={moveCheckItemInCrop}
                  onMoveBoltCallout={moveBoltCallout}
                  onMoveCheckItemCallout={moveCheckItemCallout}
                  onSelectCheckItem={selectCheckItem}
                />
              </>
            }
            onPlacementClick={readOnly ? undefined : placeOnSelectedCropAt}
          />
        </div>
      ) : (
      <AssemblyProcedureCanvas
        imageRelativePath={selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath}
        bolts={tintAssemblyBoltsByCondition(visibleBolts, areas, boltConditionPalette)}
        checkItems={visibleCheckItems}
        selectedBoltId={selectedBoltId}
        selectedCheckItemId={selectedCheckItemId}
        onSelectBolt={selectBolt}
        onSelectCheckItem={selectCheckItem}
        onMoveBolt={moveBoltOnFullPage}
        onMoveCheckItem={moveCheckItemOnFullPage}
        onMoveBoltCallout={moveBoltCallout}
        onMoveCheckItemCallout={moveCheckItemCallout}
        onAddBolt={readOnly || markerMode !== 'bolt' || placementAction !== 'place' ? undefined : addBoltAt}
        onAddCheckItem={readOnly || markerMode !== 'check' || placementAction !== 'place' ? undefined : addCheckItemAt}
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
