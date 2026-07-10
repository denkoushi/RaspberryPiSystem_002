import { useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import {
  InspectionDrawingCanvas,
  InspectionDrawingCanvasZoomControls,
  InspectionDrawingCreateCompactHeader,
  InspectionDrawingCreateToolbar,
  useInspectionDrawingGuidedTrial,
  useInspectionDrawingZoom,
  InspectionDrawingPointSidebar,
  inspectionDrawingCreateCanvasColumnClassName,
  inspectionDrawingCreatePageRootClassName,
  inspectionDrawingCreateSideAsideClassName,
  inspectionDrawingCreateWorkspaceClassName
} from '../../features/part-measurement/inspection-drawing';
import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_POINTS
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';

import {
  getInspectionDrawingCreatePreviewScenarioConfig,
  parseInspectionDrawingCreatePreviewScenario,
  toPreviewMetadataRowProps
} from './inspectionDrawingCreatePreviewScenarios';
import { KioskInspectionDrawingDevPreviewChrome } from './KioskInspectionDrawingDevPreviewChrome';
import { parseDevInspectionDrawingReturnFromLocation } from './kioskInspectionDrawingDevReturnNavigation';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

/** 開発専用 — KioskInspectionDrawingCreatePage と同じコンポーネント構成で UI プレビュー */
export function KioskInspectionDrawingCreatePreviewPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const scenario = parseInspectionDrawingCreatePreviewScenario(searchParams.get('scenario'));
  const scenarioConfig = useMemo(
    () => getInspectionDrawingCreatePreviewScenarioConfig(scenario),
    [scenario]
  );
  const inspectionReturn = useMemo(
    () => parseDevInspectionDrawingReturnFromLocation(location.state),
    [location.state]
  );
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>(scenarioConfig.processGroup);
  const [mode, setMode] = useState<'place' | 'callout' | 'test' | 'guidedTrial'>('place');
  const [points, setPoints] = useState<InspectionDrawingPoint[]>(() =>
    INSPECTION_DRAWING_PREVIEW_POINTS.map((p) => ({ ...p }))
  );
  const [selectedPointId, setSelectedPointId] = useState<string | null>(INSPECTION_DRAWING_PREVIEW_POINTS[0]?.id ?? null);
  const { zoom, zoomIn, zoomOut, fitToView, resetZoom, fitGeneration, setZoomLevel } = useInspectionDrawingZoom();

  const guidedTrial = useInspectionDrawingGuidedTrial({
    enabled: mode === 'guidedTrial',
    points,
    onPointsChange: setPoints,
    selectedPointId,
    onSelectPointId: setSelectedPointId,
    hasDrawingReady: true,
    onZoomLevel: setZoomLevel,
    canvasZoom: zoom
  });

  const selectedPoint = points.find((p) => p.id === selectedPointId) ?? null;

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleSelectPoint = (id: string) => {
    if (mode === 'guidedTrial') {
      guidedTrial.handleManualSelect(id);
      return;
    }
    setSelectedPointId(id);
  };

  return (
    <KioskInspectionDrawingDevPreviewChrome
      productionPath="/kiosk/part-measurement/inspection/create"
      rootClassName={inspectionDrawingCreatePageRootClassName}
      simulateKioskContentWidth
      footnote={`scenario=${scenario} · 1280px・長い資源名で wrap 確認 · 下部 DEV バーは本番に無し`}
    >
      <InspectionDrawingCreateCompactHeader
        centerSlot={
          <InspectionDrawingCanvasZoomControls
            enabled
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
            onFitToView={fitToView}
          />
        }
        drawingSourceControl={
          <span data-testid="inspection-drawing-create-visual-source">図面（プレビュー）</span>
        }
        metadata={{
          ...toPreviewMetadataRowProps(scenarioConfig),
          onFhincdChange: () => undefined,
          onResourceCdChange: () => undefined,
          resourceNameMap: {},
          onTemplateNameChange: () => undefined,
          onSelfInspectionModeChange: () => undefined,
          onSelfInspectionFixedCountChange: () => undefined,
          contentReadOnly: true,
          onDrawingFileChange: () => undefined
        }}
        toolbar={
          <InspectionDrawingCreateToolbar
            processGroup={processGroup}
            onProcessGroupChange={setProcessGroup}
            showProcessGroup={scenarioConfig.showProcessGroupInToolbar}
            mode={mode}
            onModeChange={setMode}
            hasDrawingImage
            hasMeasurementPoints={points.length > 0}
            saveDisabled
            saveStatus="blocked"
            returnTo={inspectionReturn.inspectionDrawingReturnTo}
            returnLabel={inspectionReturn.inspectionDrawingReturnLabel}
          />
        }
      />

      {mode === 'guidedTrial' && guidedTrial.hint ? (
        <p className="shrink-0 rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">
          {guidedTrial.hint}
        </p>
      ) : null}

      <div className={inspectionDrawingCreateWorkspaceClassName}>
        <div className={inspectionDrawingCreateCanvasColumnClassName}>
          <InspectionDrawingCanvas
            imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
            points={points}
            mode={mode === 'guidedTrial' ? 'test' : mode}
            zoom={zoom}
            fitGeneration={fitGeneration}
            focusRequest={mode === 'guidedTrial' ? guidedTrial.focusRequest : null}
            selectedPointId={selectedPointId}
            onSelectPoint={handleSelectPoint}
            onAddPoint={() => undefined}
          />
        </div>

        <aside className={inspectionDrawingCreateSideAsideClassName}>
          <InspectionDrawingPointSidebar
            mode={mode}
            onModeChange={setMode}
            hasDrawingImage
            hasMeasurementPoints={points.length > 0}
            points={points}
            selectedPoint={selectedPoint}
            contentReadOnly={false}
            onSelectPoint={handleSelectPoint}
            onPointChange={(patch) => {
              if (!selectedPoint) return;
              updatePoint(selectedPoint.id, patch);
            }}
            onRemovePoint={() => undefined}
            onRemoveAllPoints={() => {
              setPoints([]);
              setSelectedPointId(null);
              guidedTrial.resetTrialState();
            }}
            onTestValueChange={(v) => {
              if (!selectedPoint) return;
              updatePoint(selectedPoint.id, { testValue: v });
            }}
            onCommitTestValue={
              mode === 'guidedTrial'
                ? (payload) => guidedTrial.handleCommitValue(payload)
                : undefined
            }
            guidedTrialHint={mode === 'guidedTrial' ? guidedTrial.hint : null}
            onResumeGuidedTrial={mode === 'guidedTrial' ? guidedTrial.resumeTrial : undefined}
          />
        </aside>
      </div>
    </KioskInspectionDrawingDevPreviewChrome>
  );
}
