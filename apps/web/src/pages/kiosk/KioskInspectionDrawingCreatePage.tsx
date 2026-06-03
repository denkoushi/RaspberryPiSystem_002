import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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
  mergeInspectionDrawingPointPatch,
  InspectionDrawingCanvas,
  InspectionDrawingCanvasZoomControls,
  InspectionDrawingCreateHeaderBand,
  InspectionDrawingCreateToolbar,
  useInspectionDrawingZoom,
  InspectionDrawingPointSettingsPanel,
  InspectionDrawingPointSummaryStrip,
  InspectionDrawingResourceCdSelect,
  InspectionDrawingValuePanel,
  inspectionDrawingCanvasColumnClassName,
  inspectionDrawingMetadataFileInputClass,
  inspectionDrawingMetadataInputClass,
  inspectionDrawingMetadataLabelClassName,
  inspectionDrawingSideAsideClassName,
  kioskInspectionDrawingTemplateEditPath,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  templateItemToDrawingPoint,
  inspectionDrawingBlobFetchPath,
  inspectionDrawingCanvasImageUrl,
  inspectionDrawingHasImageSource
} from '../../features/part-measurement/inspection-drawing';
import {
  createInspectionDrawingPoint,
  nextAvailableMarkerNo,
  toleranceBoundsFromPoint
} from '../../features/part-measurement/inspection-drawing/markerNumbering';
import {
  PART_MEASUREMENT_DRAWING_FILE_ACCEPT,
  PART_MEASUREMENT_DRAWING_FILE_LABEL
} from '../../features/part-measurement/partMeasurementDrawingFileInput';
import {
  mapTemplateFixedCountToFormString,
  buildSelfInspectionTemplateApiBody
} from '../../features/part-measurement/selfInspectionTemplateForm';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { usePartMeasurementDrawingLocalPreview } from '../../features/part-measurement/usePartMeasurementDrawingLocalPreview';

import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  SelfInspectionMode
} from '../../features/part-measurement/types';

function processGroupDisplayLabel(processGroup: PartMeasurementProcessGroup | null | undefined): string {
  if (processGroup === 'cutting') return '切削';
  if (processGroup === 'grinding') return '研削';
  return '—';
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
  const [serverDrawingPath, setServerDrawingPath] = useState<string | null>(null);
  const [points, setPoints] = useState<InspectionDrawingPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [mode, setMode] = useState<'place' | 'test'>('place');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [template, setTemplate] = useState<PartMeasurementTemplateDto | null>(null);
  const [selfInspectionMode, setSelfInspectionMode] = useState<SelfInspectionMode>('full');
  const [selfInspectionFixedCount, setSelfInspectionFixedCount] = useState('');
  const { zoom, zoomIn, zoomOut, fitToView, resetZoom, fitGeneration } = useInspectionDrawingZoom();

  const {
    localPreviewUrl,
    saveFile,
    previewResolving,
    previewError,
    hasLocalRenderablePreview,
    hasPendingLocalSelection,
    selectFile,
    reset: resetLocalPreview
  } = usePartMeasurementDrawingLocalPreview(clientKey);

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
  const resourceSelectOptions = useMemo(
    () =>
      resourceOptions.map((cd) => ({
        value: cd,
        label: formatResourceCdWithJapaneseNames(cd, resourceNameMap)
      })),
    [resourceNameMap, resourceOptions]
  );

  const blobFetchPath = inspectionDrawingBlobFetchPath(serverDrawingPath, hasLocalRenderablePreview);
  const { blobUrl: serverDrawingBlobUrl, error: drawingLoadError } =
    usePartMeasurementDrawingBlobUrl(blobFetchPath);

  const canvasImageUrl = inspectionDrawingCanvasImageUrl(localPreviewUrl, serverDrawingBlobUrl);
  const hasDrawingImage = inspectionDrawingHasImageSource(
    localPreviewUrl,
    serverDrawingPath,
    previewResolving
  );

  const saveBlockedByPreview =
    previewResolving || (hasPendingLocalSelection && !saveFile);

  const drawingReplacePendingRef = useRef(false);

  const applyLoadedTemplate = (loaded: PartMeasurementTemplateDto) => {
    setTemplate(loaded);
    setTemplateName(loaded.name);
    setFhincd(loaded.fhincd);
    setResourceCd(loaded.resourceCd);
    setProcessGroup(loaded.processGroup === 'grinding' ? 'grinding' : 'cutting');
    setPoints(loaded.items.map((item) => templateItemToDrawingPoint(item)));
    setSelectedPointId(loaded.items[0]?.id ?? null);
    setServerDrawingPath(loaded.visualTemplate?.drawingImageRelativePath ?? null);
    setSelfInspectionMode(loaded.selfInspectionMode);
    setSelfInspectionFixedCount(
      mapTemplateFixedCountToFormString(
        loaded.selfInspectionMode,
        loaded.selfInspectionFixedCount,
        loaded.selfInspectionSampleSize
      )
    );
    resetLocalPreview();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- templateId / clientKey のみで再取得
  }, [clientKey, templateId]);

  useEffect(() => {
    resetZoom();
  }, [canvasImageUrl, resetZoom]);

  const handleFile = (file: File | null) => {
    setMessage(null);
    if (isEditing && file) {
      drawingReplacePendingRef.current = true;
    }
    selectFile(file);
    if (!isEditing) {
      setPoints([]);
      setSelectedPointId(null);
    }
  };

  useEffect(() => {
    if (!drawingReplacePendingRef.current || !hasLocalRenderablePreview || !saveFile) return;
    drawingReplacePendingRef.current = false;
    setPoints([]);
    setSelectedPointId(null);
    setMessage('図面を差し替えました。測定点を置き直してください。');
  }, [hasLocalRenderablePreview, saveFile]);

  useEffect(() => {
    if (!previewError) return;
    drawingReplacePendingRef.current = false;
  }, [previewError]);

  const updatePoint = (id: string, patch: Partial<InspectionDrawingPoint>) => {
    if (contentReadOnly) return;
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? mergeInspectionDrawingPointPatch(p, patch) : p))
    );
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
    if (saveBlockedByPreview) {
      setMessage('図面のプレビュー変換が完了するまで保存できません。');
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
      const bounds = toleranceBoundsFromPoint(pt);
      if ('error' in bounds) {
        setMessage(`「${pt.name}」: ${bounds.error}`);
        return;
      }
    }

    const selfInspectionPayload = buildSelfInspectionTemplateApiBody(
      selfInspectionMode,
      selfInspectionFixedCount
    );
    if ('error' in selfInspectionPayload) {
      setMessage(selfInspectionPayload.error);
      return;
    }

    if (!isEditing) {
      if (!saveFile) {
        setMessage('新規作成には図面画像またはPDFを選んでください（PDFは1ページ目のみ）。');
        return;
      }
    } else if (!saveFile && !template?.visualTemplateId?.trim()) {
      setMessage('図面を設定してください。');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      let visualTemplateId = template?.visualTemplateId?.trim() ? template.visualTemplateId : null;
      if (saveFile) {
        const visualTemplate = await createPartMeasurementVisualTemplate(name, saveFile, clientKey);
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
            selfInspectionMode: selfInspectionPayload.selfInspectionMode,
            selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
            items
          },
          clientKey
        );
        applyLoadedTemplate(saved);
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
            selfInspectionMode: selfInspectionPayload.selfInspectionMode,
            selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
            items
          },
          clientKey
        );
        applyLoadedTemplate(created);
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
        centerSlot={
          hasDrawingImage ? (
            <InspectionDrawingCanvasZoomControls
              enabled={hasDrawingImage}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onFitToView={fitToView}
            />
          ) : undefined
        }
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
                <InspectionDrawingResourceCdSelect
                  value={resourceCd}
                  onChange={setResourceCd}
                  options={resourceSelectOptions}
                  emptyOptionLabel="選択してください"
                  widthVariant="metadata"
                  disabled={contentReadOnly}
                />
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
              {PART_MEASUREMENT_DRAWING_FILE_LABEL}
              <input
                type="file"
                accept={PART_MEASUREMENT_DRAWING_FILE_ACCEPT}
                className={inspectionDrawingMetadataFileInputClass}
                disabled={contentReadOnly}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className={inspectionDrawingMetadataLabelClassName}>
              自主検査（検査数）
              <select
                className={inspectionDrawingMetadataInputClass}
                value={selfInspectionMode}
                disabled={contentReadOnly}
                onChange={(e) => setSelfInspectionMode(e.target.value as SelfInspectionMode)}
              >
                <option value="full">全数</option>
                <option value="single">抜き取り1個</option>
                <option value="first_last">最初と最後</option>
                <option value="fixed_count">指定数</option>
              </select>
            </label>
            {selfInspectionMode === 'fixed_count' ? (
              <label className={inspectionDrawingMetadataLabelClassName}>
                指定数
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={selfInspectionFixedCount}
                  disabled={contentReadOnly}
                  onChange={(e) => setSelfInspectionFixedCount(e.target.value)}
                  className={inspectionDrawingMetadataInputClass}
                />
              </label>
            ) : null}
          </>
        }
        toolbar={
          <InspectionDrawingCreateToolbar
            processGroup={processGroup}
            onProcessGroupChange={setProcessGroup}
            showProcessGroup={!lineageLocked}
            mode={mode}
            onModeChange={setMode}
            hasDrawingImage={hasDrawingImage}
            hasMeasurementPoints={points.length > 0}
            onSave={contentReadOnly ? undefined : () => void handleSave()}
            saveDisabled={contentReadOnly || saveBlockedByPreview}
            saveBusy={busy}
            libraryTo={KIOSK_INSPECTION_DRAWING_LIBRARY_PATH}
          />
        }
        pointListSlot={
          points.length > 0 ? (
            <InspectionDrawingPointSummaryStrip
              points={points}
              selectedPointId={selectedPointId}
              disabled={false}
              onSelectPoint={(id) => {
                setSelectedPointId(id);
                if (mode !== 'place') setMode('place');
              }}
            />
          ) : undefined
        }
      />

      {readOnly ? (
        <p className="px-1 text-[1rem] font-semibold text-sky-200">
          履歴版は閲覧のみです。編集するには有効化してください。
        </p>
      ) : null}
      {message ? <p className="px-1 text-[1rem] font-semibold text-amber-200">{message}</p> : null}
      {previewError ? <p className="px-1 text-sm text-red-300">{previewError}</p> : null}
      {drawingLoadError ? <p className="px-1 text-sm text-red-300">{drawingLoadError}</p> : null}
      {template ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
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
          {canvasImageUrl ? (
            <InspectionDrawingCanvas
              imageUrl={canvasImageUrl}
              points={points}
              mode={mode}
              zoom={zoom}
              fitGeneration={fitGeneration}
              selectedPointId={selectedPointId}
              onSelectPoint={setSelectedPointId}
              onAddPoint={
                contentReadOnly
                  ? undefined
                  : (x, y) => {
                      const markerNo = nextAvailableMarkerNo(points);
                      const pt = createInspectionDrawingPoint(x, y, markerNo);
                      setPoints((prev) => [...prev, pt]);
                      setSelectedPointId(pt.id);
                    }
              }
            />
          ) : hasDrawingImage && !drawingLoadError && !previewError ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/30 text-[1rem] text-white/60">
              {previewResolving ? 'PDF を変換中…' : '図面を読み込み中…'}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/30 text-[1rem] text-white/60">
              図面を選ぶとここに表示されます
            </div>
          )}
        </div>

        <aside className={inspectionDrawingSideAsideClassName}>
          {mode === 'place' && selectedPoint ? (
            <InspectionDrawingPointSettingsPanel
              point={selectedPoint}
              disabled={contentReadOnly}
              onChange={(patch) => updatePoint(selectedPoint.id, patch)}
              onRemove={contentReadOnly ? undefined : removeSelected}
            />
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
          ) : contentReadOnly && mode === 'place' ? (
            <p className="px-1 text-[0.98rem] text-white/55">
              履歴版は表示のみです。点の選択とテスト入力はできます。
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
