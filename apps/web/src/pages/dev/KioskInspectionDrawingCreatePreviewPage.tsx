import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Input } from '../../components/ui/Input';
import {
  InspectionDrawingCanvas,
  InspectionDrawingCanvasZoomControls,
  InspectionDrawingCreateHeaderBand,
  InspectionDrawingCreateToolbar,
  useInspectionDrawingZoom,
  InspectionDrawingPointSidebar,
  inspectionDrawingCreateCanvasColumnClassName,
  inspectionDrawingCreateHeaderBandClassName,
  inspectionDrawingCreatePageRootClassName,
  inspectionDrawingCreateSideAsideClassName,
  inspectionDrawingCreateWorkspaceClassName,
  inspectionDrawingMetadataControlWidthClass,
  inspectionDrawingMetadataInputClass,
  inspectionDrawingMetadataLabelClassName
} from '../../features/part-measurement/inspection-drawing';
import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_POINTS
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';

import { KioskInspectionDrawingDevPreviewChrome } from './KioskInspectionDrawingDevPreviewChrome';
import { parseDevInspectionDrawingReturnFromLocation } from './kioskInspectionDrawingDevReturnNavigation';


import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

/** 開発専用 — KioskInspectionDrawingCreatePage と同じコンポーネント構成で UI プレビュー */
export function KioskInspectionDrawingCreatePreviewPage() {
  const location = useLocation();
  const inspectionReturn = useMemo(
    () =>
      parseDevInspectionDrawingReturnFromLocation(location.state),
    [location.state]
  );
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>('cutting');
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
      footnote="マーカー1=OK·2=NG·3=未入力。下部 DEV バーは本番に無し"
    >
        <InspectionDrawingCreateHeaderBand
          bandClassName={inspectionDrawingCreateHeaderBandClassName}
          centerSlot={
            <InspectionDrawingCanvasZoomControls
              enabled
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onFitToView={fitToView}
            />
          }
          metadata={
            <>
              <label className={inspectionDrawingMetadataLabelClassName}>
                品番
                <Input defaultValue="DEMO-12345" className={inspectionDrawingMetadataInputClass} readOnly />
              </label>
              <label className={inspectionDrawingMetadataLabelClassName}>
                資源
                <Input defaultValue="R001" className={inspectionDrawingMetadataInputClass} readOnly />
              </label>
              <label className={inspectionDrawingMetadataLabelClassName}>
                テンプレ名
                <Input
                  defaultValue="検査図面プレビュー"
                  className={inspectionDrawingMetadataInputClass}
                  readOnly
                />
              </label>
              <label className={inspectionDrawingMetadataLabelClassName}>
                図面
                <span
                  className={`${inspectionDrawingMetadataControlWidthClass} block truncate text-[1rem] text-white/50`}
                >
                  （プレビュー用サンプル SVG）
                </span>
              </label>
            </>
          }
          toolbar={
            <InspectionDrawingCreateToolbar
              processGroup={processGroup}
              onProcessGroupChange={setProcessGroup}
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
              onSelectPoint={(id) => {
                setSelectedPointId(id);
                if (mode !== 'place') setMode('place');
              }}
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
