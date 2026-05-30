import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { createInspectionDrawingEvaluationTemplate, getResolvedClientKey } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  drawingPointToTemplateItemInput,
  kioskPartMeasurementInspectionEditPath,
  InspectionDrawingCanvas,
  InspectionDrawingCreateHeaderBand,
  InspectionDrawingCreateToolbar,
  InspectionDrawingValuePanel,
  inspectionDrawingCanvasColumnClassName,
  inspectionDrawingMetadataFileInputClass,
  inspectionDrawingMetadataInputClass,
  inspectionDrawingMetadataLabelClassName,
  inspectionDrawingPointSettingInputClassName,
  inspectionDrawingPointSettingPanelClassName,
  inspectionDrawingSideAsideClassName
} from '../../features/part-measurement/inspection-drawing';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

function newPoint(xRatio: number, yRatio: number, index: number): InspectionDrawingPoint {
  return {
    id: crypto.randomUUID(),
    name: `測定点${index}`,
    xRatio,
    yRatio,
    nominal: 0,
    lower: 0,
    upper: 0,
    testValue: ''
  };
}

export function KioskInspectionDrawingCreatePage() {
  const clientKey = getResolvedClientKey();

  const [processGroup, setProcessGroup] = useState<PartMeasurementProcessGroup>('cutting');
  const [fhincd, setFhincd] = useState('');
  const [resourceCd, setResourceCd] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [points, setPoints] = useState<InspectionDrawingPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [mode, setMode] = useState<'place' | 'test'>('place');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(null);
  const [savedSheetId, setSavedSheetId] = useState<string | null>(null);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) ?? null,
    [points, selectedPointId]
  );

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const handleFile = (file: File | null) => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
    setPoints([]);
    setSelectedPointId(null);
    setSavedTemplateId(null);
    setSavedSheetId(null);
  };

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeSelected = () => {
    if (!selectedPointId) return;
    setPoints((prev) => prev.filter((p) => p.id !== selectedPointId));
    setSelectedPointId(null);
  };

  const handleSave = async () => {
    const f = fhincd.trim();
    const r = resourceCd.trim();
    const name = templateName.trim() || `検査図面 ${f}`;
    if (!imageFile) {
      setMessage('図面画像（PNG/JPEG/WebP）を選択してください。');
      return;
    }
    if (!f || !r) {
      setMessage('品番と資源CDを入力してください。');
      return;
    }
    if (points.length === 0) {
      setMessage('図面上に測定点を1つ以上置いてください。');
      return;
    }
    for (const pt of points) {
      if (!pt.name.trim()) {
        setMessage('すべての測定点に名称を入れてください。');
        return;
      }
      if (pt.lower > pt.upper) {
        setMessage(`「${pt.name}」の下限が上限より大きいです。`);
        return;
      }
    }

    setBusy(true);
    setMessage(null);
    try {
      const { template, sheet } = await createInspectionDrawingEvaluationTemplate(
        {
          referenceFhincd: f,
          referenceResourceCd: r,
          referenceProcessGroup: processGroup,
          name,
          file: imageFile,
          items: points.map((pt, idx) => drawingPointToTemplateItemInput(pt, idx))
        },
        clientKey
      );
      setSavedTemplateId(template.id);
      setSavedSheetId(sheet.id);
      setMessage(
        '評価用テンプレートと下書き記録表を作成しました。この画面の「テスト入力」または「図面入力へ」で続けられます（本番の日程照会・order入力には未接続）。'
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 text-white">
      <p className="text-xs text-white/60">
        Phase1: この画面内で図面・測定点・テスト入力まで。保存は評価用バケットのみ（入力した品番・資源CDで本番テンプレは差し替えません）。本番導線は未接続。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white/80">検査図面作成（MVP・評価用）</span>
      </div>

      <InspectionDrawingCreateHeaderBand
        metadata={
          <>
            <label className={inspectionDrawingMetadataLabelClassName}>
              品番（評価用ラベル）
              <Input
                value={fhincd}
                onChange={(e) => setFhincd(e.target.value)}
                className={inspectionDrawingMetadataInputClass}
              />
            </label>
            <label className={inspectionDrawingMetadataLabelClassName}>
              資源CD（評価用ラベル）
              <Input
                value={resourceCd}
                onChange={(e) => setResourceCd(e.target.value)}
                className={inspectionDrawingMetadataInputClass}
              />
            </label>
            <label className={inspectionDrawingMetadataLabelClassName}>
              テンプレ名
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className={inspectionDrawingMetadataInputClass}
              />
            </label>
            <label className={inspectionDrawingMetadataLabelClassName}>
              図面（PNG/JPEG/WebP）
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={inspectionDrawingMetadataFileInputClass}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        }
        toolbar={
          <InspectionDrawingCreateToolbar
            processGroup={processGroup}
            onProcessGroupChange={setProcessGroup}
            mode={mode}
            onModeChange={setMode}
            hasDrawingImage={Boolean(imagePreviewUrl)}
            hasMeasurementPoints={points.length > 0}
            onSave={() => void handleSave()}
            saveBusy={busy}
          />
        }
      />

      {message ? <p className="text-sm font-semibold text-amber-200">{message}</p> : null}
      {savedSheetId ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={kioskPartMeasurementInspectionEditPath(savedSheetId)}
            className="inline-flex rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            図面入力へ
          </Link>
          <p className="text-xs text-white/50">
            評価用テンプレ: {savedTemplateId} / 記録表: {savedSheetId}
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className={inspectionDrawingCanvasColumnClassName}>
          {imagePreviewUrl ? (
            <InspectionDrawingCanvas
              imageUrl={imagePreviewUrl}
              points={points}
              mode={mode}
              selectedPointId={selectedPointId}
              onSelectPoint={setSelectedPointId}
              onAddPoint={(x, y) => {
                const pt = newPoint(x, y, points.length + 1);
                setPoints((prev) => [...prev, pt]);
                setSelectedPointId(pt.id);
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/30 text-sm text-white/60">
              図面ファイルを選ぶとここに表示されます
            </div>
          )}
        </div>

        <aside className={inspectionDrawingSideAsideClassName}>
          {mode === 'place' && selectedPoint ? (
            <div className={inspectionDrawingPointSettingPanelClassName}>
              <p className="text-sm font-bold">測定点の設定</p>
              <label className="grid gap-1 text-xs font-semibold">
                名称
                <Input
                  value={selectedPoint.name}
                  onChange={(e) => updatePoint(selectedPoint.id, { name: e.target.value })}
                  className={inspectionDrawingPointSettingInputClassName}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold">
                基準値
                <Input
                  type="number"
                  inputMode="decimal"
                  value={selectedPoint.nominal}
                  onChange={(e) =>
                    updatePoint(selectedPoint.id, { nominal: parseFloat(e.target.value) || 0 })
                  }
                  className={inspectionDrawingPointSettingInputClassName}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold">
                下限
                <Input
                  type="number"
                  inputMode="decimal"
                  value={selectedPoint.lower}
                  onChange={(e) => updatePoint(selectedPoint.id, { lower: parseFloat(e.target.value) || 0 })}
                  className={inspectionDrawingPointSettingInputClassName}
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold">
                上限
                <Input
                  type="number"
                  inputMode="decimal"
                  value={selectedPoint.upper}
                  onChange={(e) => updatePoint(selectedPoint.id, { upper: parseFloat(e.target.value) || 0 })}
                  className={inspectionDrawingPointSettingInputClassName}
                />
              </label>
              <Button type="button" variant="secondary" onClick={removeSelected}>
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
            <p className="text-xs text-white/50">
              {mode === 'place'
                ? '図面をタップして点を追加。点を選んで名称と上下限を設定します。'
                : null}
            </p>
          )}

        </aside>
      </div>
    </div>
  );
}
