import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  activatePartMeasurementTemplate,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  getKioskInspectionDrawingTemplate,
  getResolvedClientKey,
  reviseKioskInspectionDrawingTemplate
} from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  drawingPointToTemplateItemInput,
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
  inspectionDrawingSideAsideClassName,
  kioskInspectionDrawingTemplateEditPath,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  templateItemToDrawingPoint
} from '../../features/part-measurement/inspection-drawing';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto
} from '../../features/part-measurement/types';

function processGroupDisplayLabel(processGroup: PartMeasurementProcessGroup | null | undefined): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
}

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
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const clientKey = getResolvedClientKey();
  const resourcesQuery = useKioskProductionScheduleResources();
  const isEditing = Boolean(templateId);

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
  const [template, setTemplate] = useState<PartMeasurementTemplateDto | null>(null);

  const lineageLocked = isEditing;
  const readOnly = Boolean(lineageLocked && template && !template.isActive);
  const contentReadOnly = readOnly;

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) ?? null,
    [points, selectedPointId]
  );
  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const resourceOptions = useMemo(() => {
    const unique = new Set(resourcesQuery.data?.resources ?? []);
    if (resourceCd.trim()) unique.add(resourceCd.trim());
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [resourceCd, resourcesQuery.data?.resources]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const applyLoadedTemplate = (loaded: PartMeasurementTemplateDto) => {
    setTemplate(loaded);
    setTemplateName(loaded.name);
    setFhincd(loaded.fhincd);
    setResourceCd(loaded.resourceCd);
    setProcessGroup(loaded.processGroup === 'grinding' ? 'grinding' : 'cutting');
    setPoints(loaded.items.map((item) => templateItemToDrawingPoint(item)));
    setSelectedPointId(loaded.items[0]?.id ?? null);
    setImagePreviewUrl(loaded.visualTemplate?.drawingImageRelativePath ?? null);
    setImageFile(null);
  };

  useEffect(() => {
    if (!templateId) return;
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const loaded = await getKioskInspectionDrawingTemplate(templateId, clientKey);
        applyLoadedTemplate(loaded);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? 'テンプレートの読み込みに失敗しました。');
      } finally {
        setBusy(false);
      }
    })();
  }, [clientKey, templateId]);

  const handleFile = (file: File | null) => {
    if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
    if (!isEditing) {
      setPoints([]);
      setSelectedPointId(null);
    }
  };

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    if (contentReadOnly) return;
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removeSelected = () => {
    if (contentReadOnly || !selectedPointId) return;
    setPoints((prev) => prev.filter((p) => p.id !== selectedPointId));
    setSelectedPointId(null);
  };

  const handleActivate = async () => {
    if (!templateId) return;
    setBusy(true);
    setMessage(null);
    try {
      const activated = await activatePartMeasurementTemplate(templateId, clientKey);
      const loaded = await getKioskInspectionDrawingTemplate(activated.id, clientKey);
      applyLoadedTemplate(loaded);
      setMessage('有効版にしました。編集できます。');
      if (activated.id !== templateId) {
        void navigate(kioskInspectionDrawingTemplateEditPath(activated.id), { replace: true });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '有効化に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (contentReadOnly) {
      setMessage('履歴版は閲覧のみです。編集するには有効化してください。');
      return;
    }
    const f = fhincd.trim();
    const r = resourceCd.trim();
    const name = templateName.trim() || `検査図面 ${f}`;
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

    if (!isEditing) {
      if (!imageFile) {
        setMessage('新規作成には図面画像を選んでください。');
        return;
      }
    } else if (!imageFile && !template?.visualTemplateId?.trim()) {
      setMessage('図面を設定してください。');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      let visualTemplateId = template?.visualTemplateId?.trim() ? template.visualTemplateId : null;
      if (imageFile) {
        const visualTemplate = await createPartMeasurementVisualTemplate(name, imageFile, clientKey);
        visualTemplateId = visualTemplate.id;
      }
      if (!visualTemplateId?.trim()) {
        setMessage('図面の登録に失敗しました。もう一度お試しください。');
        return;
      }

      const items = points.map((pt, idx) => drawingPointToTemplateItemInput(pt, idx));
      if (isEditing && templateId) {
        const saved = await reviseKioskInspectionDrawingTemplate(
          templateId,
          {
            name,
            visualTemplateId,
            items
          },
          clientKey
        );
        setTemplate(saved);
        setMessage('保存しました。履歴から旧版を確認できます。');
        void navigate(kioskInspectionDrawingTemplateEditPath(saved.id), { replace: true });
      } else {
        const created = await createPartMeasurementTemplate(
          {
            templateScope: 'three_key',
            fhincd: f,
            resourceCd: r,
            processGroup,
            name,
            visualTemplateId,
            items
          },
          clientKey
        );
        setTemplate(created);
        setMessage('保存しました。一覧から続けて編集できます。');
        void navigate(kioskInspectionDrawingTemplateEditPath(created.id), { replace: true });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-white">
      <InspectionDrawingCreateHeaderBand
        metadata={
          <>
            {lineageLocked ? (
              <>
                <div className={inspectionDrawingMetadataLabelClassName}>
                  <span>品番</span>
                  <p className={`${inspectionDrawingMetadataInputClass} flex items-center rounded-md border-2 border-slate-600 bg-slate-800/80 px-3 text-white`}>
                    {fhincd}
                  </p>
                </div>
                <div className={inspectionDrawingMetadataLabelClassName}>
                  <span>資源</span>
                  <p className={`${inspectionDrawingMetadataInputClass} flex items-center rounded-md border-2 border-slate-600 bg-slate-800/80 px-3 text-white`}>
                    {formatResourceCdWithJapaneseNames(resourceCd, resourceNameMap)}
                  </p>
                </div>
                <div className={inspectionDrawingMetadataLabelClassName}>
                  <span>工程</span>
                  <p className={`${inspectionDrawingMetadataInputClass} flex items-center rounded-md border-2 border-slate-600 bg-slate-800/80 px-3 text-white`}>
                    {processGroupDisplayLabel(template?.processGroup ?? processGroup)}
                  </p>
                </div>
              </>
            ) : (
              <>
                <label className={inspectionDrawingMetadataLabelClassName}>
                  品番
                  <Input
                    value={fhincd}
                    onChange={(e) => setFhincd(e.target.value)}
                    className={inspectionDrawingMetadataInputClass}
                  />
                </label>
                <label className={inspectionDrawingMetadataLabelClassName}>
                  資源
                  <select
                    value={resourceCd}
                    onChange={(e) => setResourceCd(e.target.value)}
                    className={`${inspectionDrawingMetadataInputClass} rounded-md border-2 border-slate-500 bg-white`}
                  >
                    <option value="">選択してください</option>
                    {resourceOptions.map((cd) => (
                      <option key={cd} value={cd}>
                        {formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className={inspectionDrawingMetadataLabelClassName}>
              テンプレ名
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className={inspectionDrawingMetadataInputClass}
                disabled={contentReadOnly}
              />
            </label>
            <label className={inspectionDrawingMetadataLabelClassName}>
              図面
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={inspectionDrawingMetadataFileInputClass}
                disabled={contentReadOnly}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        }
        toolbar={
          <InspectionDrawingCreateToolbar
            processGroup={processGroup}
            onProcessGroupChange={setProcessGroup}
            showProcessGroup={!lineageLocked}
            mode={mode}
            onModeChange={setMode}
            hasDrawingImage={Boolean(imagePreviewUrl)}
            hasMeasurementPoints={points.length > 0}
            onSave={contentReadOnly ? undefined : () => void handleSave()}
            saveDisabled={contentReadOnly}
            saveBusy={busy}
          />
        }
      />

      {readOnly ? (
        <p className="px-1 text-[1rem] font-semibold text-sky-200">
          履歴版は閲覧のみです。編集するには有効化してください。
        </p>
      ) : null}
      {message ? <p className="px-1 text-[1rem] font-semibold text-amber-200">{message}</p> : null}
      {template ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Link
            to={KIOSK_INSPECTION_DRAWING_LIBRARY_PATH}
            className="text-[1rem] font-semibold text-blue-200 underline"
          >
            一覧へ戻る
          </Link>
          <span className="text-[0.98rem] text-white/60">
            v{template.version} / {template.isActive ? '有効' : '履歴'}
          </span>
          {readOnly ? (
            <Button type="button" variant="primary" disabled={busy} onClick={() => void handleActivate()}>
              {busy ? '処理中…' : 'この版を有効化して編集'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className={inspectionDrawingCanvasColumnClassName}>
          {imagePreviewUrl ? (
            <InspectionDrawingCanvas
              imageUrl={imagePreviewUrl}
              points={points}
              mode={mode}
              selectedPointId={selectedPointId}
              onSelectPoint={setSelectedPointId}
              onAddPoint={
                contentReadOnly
                  ? undefined
                  : (x, y) => {
                      const pt = newPoint(x, y, points.length + 1);
                      setPoints((prev) => [...prev, pt]);
                      setSelectedPointId(pt.id);
                    }
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/30 text-[1rem] text-white/60">
              図面を選ぶとここに表示されます
            </div>
          )}
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
                  disabled={contentReadOnly}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1 text-[1rem] font-semibold">
                  基準値
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={selectedPoint.nominal}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { nominal: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                    disabled={contentReadOnly}
                  />
                </label>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  下限
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={selectedPoint.lower}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { lower: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                    disabled={contentReadOnly}
                  />
                </label>
                <label className="grid gap-1 text-[1rem] font-semibold">
                  上限
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={selectedPoint.upper}
                    onChange={(e) =>
                      updatePoint(selectedPoint.id, { upper: parseFloat(e.target.value) || 0 })
                    }
                    className={inspectionDrawingPointSettingInputClassName}
                    disabled={contentReadOnly}
                  />
                </label>
              </div>
              {!contentReadOnly ? (
                <Button type="button" variant="secondary" onClick={removeSelected}>
                  この点を削除
                </Button>
              ) : null}
            </div>
          ) : null}

          {mode === 'test' ? (
            <InspectionDrawingValuePanel
              point={selectedPoint}
              readOnly={contentReadOnly}
              onValueChange={(v) => {
                if (!selectedPoint) return;
                updatePoint(selectedPoint.id, { testValue: v });
              }}
            />
          ) : (
            <p className="px-1 text-[0.98rem] text-white/55">
              {mode === 'place'
                ? contentReadOnly
                  ? '履歴版は表示のみです。点の選択とテスト入力はできます。'
                  : '図面をタップして点を追加し、右側で設定します。'
                : null}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
