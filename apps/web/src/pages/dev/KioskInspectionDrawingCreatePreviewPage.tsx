import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  InspectionDrawingCanvas,
  InspectionDrawingCreateHeaderBand,
  InspectionDrawingCreateToolbar,
  InspectionDrawingValuePanel,
  inspectionDrawingCanvasColumnClassName,
  inspectionDrawingMetadataControlWidthClass,
  inspectionDrawingMetadataInputClass,
  inspectionDrawingMetadataLabelClassName,
  inspectionDrawingPointSettingInputClassName,
  inspectionDrawingPointSettingPanelClassName,
  inspectionDrawingSideAsideClassName
} from '../../features/part-measurement/inspection-drawing';
import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_POINTS
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

/** 開発専用 — KioskInspectionDrawingCreatePage と同じコンポーネント構成で UI プレビュー */
export function KioskInspectionDrawingCreatePreviewPage() {
  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>('cutting');
  const [mode, setMode] = useState<'place' | 'test'>('place');
  const [points, setPoints] = useState<InspectionDrawingPoint[]>(() =>
    INSPECTION_DRAWING_PREVIEW_POINTS.map((p) => ({ ...p }))
  );
  const [selectedPointId, setSelectedPointId] = useState<string | null>(INSPECTION_DRAWING_PREVIEW_POINTS[0]?.id ?? null);

  const selectedPoint = points.find((p) => p.id === selectedPointId) ?? null;

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-800 text-white">
      <header className="shrink-0 border-b border-amber-500/40 bg-amber-950/40 px-3 py-2 text-center text-sm font-semibold text-amber-100">
        開発プレビュー — 実装コンポーネント（InspectionDrawingCanvas / ValuePanel）· 本番ルート:
        /kiosk/part-measurement/inspection/create
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[1.05rem] font-semibold text-white/85">検査図面作成プレビュー</span>
        </div>

        <InspectionDrawingCreateHeaderBand
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
            />
          }
        />

        <p className="text-[1rem] font-semibold text-amber-200">
          プレビュー: マーカー1=OK（緑）· 2=NG（赤）· 3=未入力（白）。「テスト入力」で右パネルを確認。
        </p>

        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
          <div className={inspectionDrawingCanvasColumnClassName}>
            <InspectionDrawingCanvas
              imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
              points={points}
              mode={mode}
              selectedPointId={selectedPointId}
              onSelectPoint={setSelectedPointId}
              onAddPoint={() => undefined}
            />
          </div>

          <aside className={inspectionDrawingSideAsideClassName}>
            {mode === 'place' && selectedPoint ? (
              <div className={inspectionDrawingPointSettingPanelClassName}>
                <p className="text-[1.02rem] font-bold">測定点の設定</p>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  名称
                  <Input
                    value={selectedPoint.name}
                    onChange={(e) => updatePoint(selectedPoint.id, { name: e.target.value })}
                    className={inspectionDrawingPointSettingInputClassName}
                  />
                </label>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  基準値
                  <Input
                    type="number"
                    value={selectedPoint.nominal}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { nominal: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                  />
                </label>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  下限
                  <Input
                    type="number"
                    value={selectedPoint.lower}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { lower: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                  />
                </label>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  上限
                  <Input
                    type="number"
                    value={selectedPoint.upper}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { upper: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                  />
                </label>
                <Button type="button" variant="secondary">
                  この点を削除
                </Button>
              </div>
            ) : null}

            {mode === 'test' ? (
              <InspectionDrawingValuePanel
                point={selectedPoint}
                onValueChange={(v) => {
                  if (!selectedPoint) return;
                  updatePoint(selectedPoint.id, { testValue: v });
                }}
              />
            ) : (
              <p className="text-[0.98rem] text-white/50">
                図面をタップして点を追加し、右側で設定します。
              </p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
