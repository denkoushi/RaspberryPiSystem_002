import { useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import {
  InspectionDrawingCanvas,
  InspectionDrawingCanvasZoomControls,
  InspectionDrawingCreateCompactHeader,
  InspectionDrawingCreateToolbar,
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
  const [mode, setMode] = useState<'place' | 'test'>('place');
  const [points, setPoints] = useState<InspectionDrawingPoint[]>(() =>
    INSPECTION_DRAWING_PREVIEW_POINTS.map((p) => ({ ...p }))
  );
  const [selectedPointId, setSelectedPointId] = useState<string | null>(INSPECTION_DRAWING_PREVIEW_POINTS[0]?.id ?? null);
  const { zoom, zoomIn, zoomOut, fitToView, fitGeneration } = useInspectionDrawingZoom();

  const selectedPoint = points.find((p) => p.id === selectedPointId) ?? null;

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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
            onFitToView={fitToView}
          />
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
            returnTo={inspectionReturn.inspectionDrawingReturnTo}
            returnLabel={inspectionReturn.inspectionDrawingReturnLabel}
          />
        }
      />

      <div className={inspectionDrawingCreateWorkspaceClassName}>
        <div className={inspectionDrawingCreateCanvasColumnClassName}>
          <InspectionDrawingCanvas
            imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
            points={points}
            mode={mode}
            zoom={zoom}
            fitGeneration={fitGeneration}
            selectedPointId={selectedPointId}
            onSelectPoint={setSelectedPointId}
            onAddPoint={() => undefined}
          />
        </div>

        <aside className={inspectionDrawingCreateSideAsideClassName}>
          <InspectionDrawingPointSidebar
            mode={mode}
            points={points}
            selectedPoint={selectedPoint}
            contentReadOnly={false}
            onSelectPoint={setSelectedPointId}
            onPointChange={(patch) => {
              if (!selectedPoint) return;
              updatePoint(selectedPoint.id, patch);
            }}
            onRemovePoint={() => undefined}
            onTestValueChange={(v) => {
              if (!selectedPoint) return;
              updatePoint(selectedPoint.id, { testValue: v });
            }}
          />
        </aside>
      </div>
    </KioskInspectionDrawingDevPreviewChrome>
  );
}
