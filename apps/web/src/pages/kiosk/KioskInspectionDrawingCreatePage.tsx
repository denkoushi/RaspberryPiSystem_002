import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  activatePartMeasurementTemplate,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  deleteUnusedPartMeasurementVisualTemplate,
  getKioskInspectionDrawingTemplate,
  getResolvedClientKey,
  existsActivePartMeasurementTemplate,
  listPartMeasurementVisualTemplates,
  reviseKioskInspectionDrawingTemplate
} from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  drawingPointToTemplateItemInput,
  mergeInspectionDrawingPointPatch,
  InspectionDrawingCanvas,
  InspectionDrawingCanvasZoomControls,
  InspectionDrawingCreateCompactHeader,
  InspectionDrawingCreateToolbar,
  InspectionDrawingVisualSourceControl,
  useInspectionDrawingZoom,
  InspectionDrawingPointSidebar,
  useInspectionDrawingGuidedTrial,
  inspectionDrawingCreateCanvasColumnClassName,
  inspectionDrawingCreatePageRootClassName,
  inspectionDrawingCreateSideAsideClassName,
  inspectionDrawingCreateWorkspaceClassName,
  kioskInspectionDrawingTemplateEditPath,
  templateItemToDrawingPoint,
  inspectionDrawingBlobFetchPath,
  inspectionDrawingCanvasImageUrl,
  inspectionDrawingHasImageSource,
  parseInspectionDrawingSourceTemplateIdFromSearch,
  templateToCreateDraft,
  resolveInspectionDrawingCreateKeyCollision,
  inspectionDrawingCreateKeyCollisionMessage
} from '../../features/part-measurement/inspection-drawing';
import {
  createInspectionDrawingPoint,
  nextAvailableMarkerNo,
  toleranceBoundsFromPoint
} from '../../features/part-measurement/inspection-drawing/markerNumbering';
import {
  mapTemplateFixedCountToFormString,
  buildSelfInspectionTemplateApiBody
} from '../../features/part-measurement/selfInspectionTemplateForm';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { usePartMeasurementDrawingLocalPreview } from '../../features/part-measurement/usePartMeasurementDrawingLocalPreview';

import { parseKioskInspectionDrawingReturnFromLocation } from './kioskInspectionDrawingReturnNavigation';

import type {
  InspectionDrawingCreateDraftForm,
  InspectionDrawingSourceTemplateDraft,
  InspectionDrawingVisualSource
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingCreateDraft';
import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  PartMeasurementVisualTemplateDto,
  SelfInspectionMode
} from '../../features/part-measurement/types';

function confirmVisualChange(message: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.confirm(message);
}

export function KioskInspectionDrawingCreatePage() {
  const { templateId } = useParams<{ templateId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const inspectionReturn = useMemo(
    () => parseKioskInspectionDrawingReturnFromLocation(location.state),
    [location.state]
  );
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
  const [mode, setMode] = useState<'place' | 'test' | 'guidedTrial'>('place');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [template, setTemplate] = useState<PartMeasurementTemplateDto | null>(null);
  const [selfInspectionMode, setSelfInspectionMode] = useState<SelfInspectionMode>('full');
  const [selfInspectionFixedCount, setSelfInspectionFixedCount] = useState('');
  const [visualSource, setVisualSource] = useState<InspectionDrawingVisualSource>('unselected');
  const [selectedVisualTemplateId, setSelectedVisualTemplateId] = useState<string | null>(null);
  const [selectedVisualLabel, setSelectedVisualLabel] = useState<string | null>(null);
  const [sourceTemplateDraft, setSourceTemplateDraft] =
    useState<InspectionDrawingSourceTemplateDraft | null>(null);
  const [visuals, setVisuals] = useState<PartMeasurementVisualTemplateDto[]>([]);
  const [visualsLoading, setVisualsLoading] = useState(false);
  const [activeKeyExists, setActiveKeyExists] = useState(false);
  const { zoom, zoomIn, zoomOut, fitToView, resetZoom, fitGeneration, setZoomLevel } = useInspectionDrawingZoom();

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

  const keyCollision = useMemo(() => {
    if (isEditing) return null;
    const f = fhincd.trim();
    const r = resourceCd.trim();
    if (!f || !r) return null;
    return resolveInspectionDrawingCreateKeyCollision({
      fhincd: f,
      processGroup,
      resourceCd: r,
      sourceDraft: sourceTemplateDraft,
      activeExists: activeKeyExists
    });
  }, [activeKeyExists, fhincd, isEditing, processGroup, resourceCd, sourceTemplateDraft]);

  const keyCollisionMessage = keyCollision
    ? inspectionDrawingCreateKeyCollisionMessage(keyCollision)
    : null;

  const blobFetchPath = inspectionDrawingBlobFetchPath(serverDrawingPath, hasLocalRenderablePreview);
  const { blobUrl: serverDrawingBlobUrl, error: drawingLoadError } =
    usePartMeasurementDrawingBlobUrl(blobFetchPath);

  const canvasImageUrl = inspectionDrawingCanvasImageUrl(localPreviewUrl, serverDrawingBlobUrl);
  const hasDrawingImage = inspectionDrawingHasImageSource(
    localPreviewUrl,
    serverDrawingPath,
    previewResolving
  );

  const guidedTrial = useInspectionDrawingGuidedTrial({
    enabled: mode === 'guidedTrial',
    points,
    onPointsChange: setPoints,
    selectedPointId,
    onSelectPointId: setSelectedPointId,
    hasDrawingReady: Boolean(canvasImageUrl),
    onZoomLevel: setZoomLevel,
    canvasZoom: zoom
  });

  const saveBlockedByPreview =
    visualSource === 'upload' &&
    (previewResolving ||
      Boolean(previewError) ||
      !hasLocalRenderablePreview ||
      (hasPendingLocalSelection && !saveFile));

  const drawingReplacePendingRef = useRef(false);
  const prevSourceTemplateIdRef = useRef<string | null>(null);
  const visualSearchRequestSeqRef = useRef(0);

  const applyLoadedTemplate = useCallback(
    (loaded: PartMeasurementTemplateDto) => {
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
      if (loaded.visualTemplateId?.trim()) {
        setVisualSource('pickExisting');
        setSelectedVisualTemplateId(loaded.visualTemplateId);
        setSelectedVisualLabel(loaded.visualTemplate?.name ?? null);
      } else {
        setVisualSource('unselected');
        setSelectedVisualTemplateId(null);
        setSelectedVisualLabel(null);
      }
      resetLocalPreview();
    },
    [resetLocalPreview]
  );

  const resetBlankCreateForm = useCallback(() => {
    setSourceTemplateDraft(null);
    setTemplateName('');
    setFhincd('');
    setResourceCd('');
    setProcessGroup('cutting');
    setPoints([]);
    setSelectedPointId(null);
    setSelfInspectionMode('full');
    setSelfInspectionFixedCount('');
    setVisualSource('unselected');
    setSelectedVisualTemplateId(null);
    setSelectedVisualLabel(null);
    setServerDrawingPath(null);
    resetLocalPreview();
  }, [resetLocalPreview]);

  const applyCreateDraft = useCallback(
    (draft: InspectionDrawingCreateDraftForm) => {
      setSourceTemplateDraft(draft.sourceDraft);
      setTemplateName(draft.templateName);
      setFhincd(draft.fhincd);
      setResourceCd(draft.resourceCd);
      setProcessGroup(draft.processGroup);
      setPoints(draft.points);
      setSelectedPointId(draft.points[0]?.id ?? null);
      setSelfInspectionMode(draft.selfInspectionMode);
      setSelfInspectionFixedCount(draft.selfInspectionFixedCount);
      if (draft.visualTemplateId && draft.drawingImageRelativePath) {
        setVisualSource('pickExisting');
        setSelectedVisualTemplateId(draft.visualTemplateId);
        setSelectedVisualLabel(draft.visualTemplateName);
        setServerDrawingPath(draft.drawingImageRelativePath);
        resetLocalPreview();
      } else {
        setVisualSource('unselected');
        setSelectedVisualTemplateId(null);
        setSelectedVisualLabel(null);
        setServerDrawingPath(null);
      }
    },
    [resetLocalPreview]
  );

  const clearPointsIfConfirmed = useCallback((): boolean => {
    if (points.length === 0) return true;
    return confirmVisualChange(
      '図面を変更すると測定点がクリアされます。続行しますか？'
    );
  }, [points.length]);

  const applyPickExistingVisual = useCallback(
    (visual: PartMeasurementVisualTemplateDto): boolean => {
      if (selectedVisualTemplateId === visual.id) {
        setVisualSource('pickExisting');
        setSelectedVisualLabel(visual.name);
        setServerDrawingPath(visual.drawingImageRelativePath);
        return true;
      }
      if (!clearPointsIfConfirmed()) return false;
      resetLocalPreview();
      setVisualSource('pickExisting');
      setSelectedVisualTemplateId(visual.id);
      setSelectedVisualLabel(visual.name);
      setServerDrawingPath(visual.drawingImageRelativePath);
      setPoints([]);
      setSelectedPointId(null);
      guidedTrial.resetTrialState();
      return true;
    },
    [clearPointsIfConfirmed, guidedTrial, resetLocalPreview, selectedVisualTemplateId]
  );

  const applyUploadVisual = useCallback(
    (file: File): boolean => {
      if (visualSource === 'pickExisting' || points.length > 0) {
        if (!clearPointsIfConfirmed()) return false;
      }
      setVisualSource('upload');
      setSelectedVisualTemplateId(null);
      setSelectedVisualLabel(null);
      setServerDrawingPath(null);
      if (file && (points.length > 0 || visualSource === 'pickExisting')) {
        drawingReplacePendingRef.current = true;
      }
      selectFile(file);
      guidedTrial.resetTrialState();
      return true;
    },
    [clearPointsIfConfirmed, guidedTrial, points.length, selectFile, visualSource]
  );

  const loadVisualTemplates = useCallback(
    async (searchQuery?: string) => {
      const requestSeq = ++visualSearchRequestSeqRef.current;
      setVisualsLoading(true);
      try {
        const list = await listPartMeasurementVisualTemplates(
          { q: searchQuery?.trim() || undefined, limit: 80 },
          clientKey
        );
        if (visualSearchRequestSeqRef.current === requestSeq) {
          setVisuals(list);
        }
      } catch {
        if (visualSearchRequestSeqRef.current === requestSeq) {
          setVisuals([]);
        }
      } finally {
        if (visualSearchRequestSeqRef.current === requestSeq) {
          setVisualsLoading(false);
        }
      }
    },
    [clientKey]
  );

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
  }, [applyLoadedTemplate, clientKey, templateId]);

  useEffect(() => {
    if (isEditing) return;

    const sourceId = parseInspectionDrawingSourceTemplateIdFromSearch(location.search);
    const prevSourceId = prevSourceTemplateIdRef.current;
    prevSourceTemplateIdRef.current = sourceId;

    if (!sourceId) {
      if (prevSourceId) {
        resetBlankCreateForm();
        setMessage(null);
        setBusy(false);
      }
      return;
    }

    if (prevSourceId !== sourceId) {
      resetBlankCreateForm();
    }

    let cancelled = false;
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const loaded = await getKioskInspectionDrawingTemplate(sourceId, clientKey);
        if (cancelled) return;
        if (!loaded.isActive) {
          resetBlankCreateForm();
          setMessage('有効版のみ雛形にできます。履歴版は流用できません。');
          return;
        }
        applyCreateDraft(templateToCreateDraft(loaded));
      } catch (e: unknown) {
        if (cancelled) return;
        resetBlankCreateForm();
        const err = e as { response?: { data?: { message?: string } } };
        setMessage(err.response?.data?.message ?? '雛形テンプレートの読み込みに失敗しました。');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyCreateDraft, clientKey, isEditing, location.search, resetBlankCreateForm]);

  useEffect(() => {
    if (isEditing) {
      setActiveKeyExists(false);
      return;
    }
    const f = fhincd.trim();
    const r = resourceCd.trim();
    if (!f || !r) {
      setActiveKeyExists(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const exists = await existsActivePartMeasurementTemplate(
            { fhincd: f, processGroup, resourceCd: r },
            clientKey
          );
          if (!cancelled) {
            setActiveKeyExists(exists);
          }
        } catch {
          if (!cancelled) setActiveKeyExists(false);
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientKey, fhincd, isEditing, processGroup, resourceCd]);

  useEffect(() => {
    resetZoom();
  }, [canvasImageUrl, resetZoom]);

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
    if (!isEditing || !template) return;

    resetLocalPreview();
    if (template.visualTemplateId?.trim() && template.visualTemplate) {
      setVisualSource('pickExisting');
      setSelectedVisualTemplateId(template.visualTemplateId);
      setSelectedVisualLabel(template.visualTemplate.name ?? null);
      setServerDrawingPath(template.visualTemplate.drawingImageRelativePath ?? null);
    } else {
      setVisualSource('unselected');
      setSelectedVisualTemplateId(null);
      setSelectedVisualLabel(null);
      setServerDrawingPath(null);
    }
    setMessage('図面のプレビュー変換に失敗しました。前の図面に戻しました。');
  }, [isEditing, previewError, resetLocalPreview, template]);

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
    guidedTrial.resetTrialState();
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
        void navigate(kioskInspectionDrawingTemplateEditPath(activated.id), {
          replace: true,
          state: inspectionReturn
        });
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
    if (keyCollision) {
      setMessage(keyCollisionMessage);
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
      if (visualSource === 'unselected') {
        setMessage('図面を選択するかアップロードしてください。');
        return;
      }
      if (visualSource === 'upload' && !saveFile) {
        setMessage('新規アップロードの図面ファイルを選んでください（PDFは1ページ目のみ）。');
        return;
      }
      if (visualSource === 'pickExisting' && !selectedVisualTemplateId?.trim()) {
        setMessage('既存図面を選択してください。');
        return;
      }
    } else {
      if (
        visualSource === 'upload' &&
        (!saveFile || Boolean(previewError) || !hasLocalRenderablePreview)
      ) {
        setMessage('図面のプレビュー変換に失敗したか、ファイルが未選択です。');
        return;
      }
      if (visualSource === 'unselected' && !template?.visualTemplateId?.trim()) {
        setMessage('図面を設定してください。');
        return;
      }
    }

    setBusy(true);
    setMessage(null);
    let uploadedVisualCleanup: { id: string; cleanupToken: string } | null = null;
    try {
      let visualTemplateId =
        visualSource === 'pickExisting'
          ? selectedVisualTemplateId
          : template?.visualTemplateId?.trim()
            ? template.visualTemplateId
            : null;

      if (visualSource === 'upload' && saveFile) {
        const createdVisual = await createPartMeasurementVisualTemplate(name, saveFile, clientKey);
        visualTemplateId = createdVisual.visualTemplate.id;
        uploadedVisualCleanup = {
          id: createdVisual.visualTemplate.id,
          cleanupToken: createdVisual.cleanupToken
        };
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
        void navigate(kioskInspectionDrawingTemplateEditPath(saved.id), {
          replace: true,
          state: inspectionReturn
        });
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
            failIfActiveExists: true,
            items
          },
          clientKey
        );
        applyLoadedTemplate(created);
        setMessage('保存しました。一覧から続けて編集できます。');
        void navigate(kioskInspectionDrawingTemplateEditPath(created.id), {
          replace: true,
          state: inspectionReturn
        });
      }
    } catch (e: unknown) {
      if (uploadedVisualCleanup) {
        await deleteUnusedPartMeasurementVisualTemplate(
          uploadedVisualCleanup.id,
          uploadedVisualCleanup.cleanupToken,
          clientKey
        ).catch(() => undefined);
      }
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectPointFromList = (id: string) => {
    if (mode === 'guidedTrial') {
      guidedTrial.handleManualSelect(id);
      return;
    }
    setSelectedPointId(id);
  };

  const saveDisabled =
    contentReadOnly || saveBlockedByPreview || Boolean(keyCollision) || busy;

  return (
    <div className={inspectionDrawingCreatePageRootClassName}>
      <InspectionDrawingCreateCompactHeader
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
        metadata={{
          lineageLocked,
          fhincd,
          onFhincdChange: setFhincd,
          resourceCd,
          onResourceCdChange: setResourceCd,
          resourceSelectOptions,
          resourceNameMap,
          processGroup,
          templateProcessGroup: template?.processGroup,
          templateName,
          onTemplateNameChange: setTemplateName,
          selfInspectionMode,
          onSelfInspectionModeChange: setSelfInspectionMode,
          selfInspectionFixedCount,
          onSelfInspectionFixedCountChange: setSelfInspectionFixedCount,
          contentReadOnly,
          onDrawingFileChange: () => undefined,
          templateVersion: template?.version,
          templateIsActive: template?.isActive
        }}
        drawingSourceControl={
          <InspectionDrawingVisualSourceControl
            contentReadOnly={contentReadOnly}
            visualSource={visualSource}
            selectedVisualTemplateId={selectedVisualTemplateId}
            selectedVisualLabel={selectedVisualLabel}
            visuals={visuals}
            visualsLoading={visualsLoading}
            onPickExisting={applyPickExistingVisual}
            onUploadFile={applyUploadVisual}
            onSearchChange={(query) => {
              void loadVisualTemplates(query);
            }}
          />
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
            saveDisabled={saveDisabled}
            saveBusy={busy}
            returnTo={inspectionReturn.inspectionDrawingReturnTo}
            returnLabel={inspectionReturn.inspectionDrawingReturnLabel}
          />
        }
      />

      {!isEditing ? (
        <p className="px-1 text-[0.95rem] font-semibold text-sky-100">
          {sourceTemplateDraft
            ? '雛形から新規作成 — 品番・工程・資源CDを変えて別テンプレとして保存します。'
            : '新規作成 — 品番・工程・資源CDごとに1テンプレートです。'}
        </p>
      ) : null}
      {readOnly ? (
        <p className="px-1 text-[1rem] font-semibold text-sky-200">
          履歴版は閲覧のみです。編集するには有効化してください。
        </p>
      ) : null}
      {keyCollisionMessage ? (
        <p className="px-1 text-[1rem] font-semibold text-amber-200">{keyCollisionMessage}</p>
      ) : null}
      {message ? <p className="px-1 text-[1rem] font-semibold text-amber-200">{message}</p> : null}
      {previewError ? <p className="px-1 text-sm text-red-300">{previewError}</p> : null}
      {drawingLoadError ? <p className="px-1 text-sm text-red-300">{drawingLoadError}</p> : null}
      {template && readOnly ? (
        <div className="px-1">
          <Button type="button" variant="primary" disabled={busy} onClick={() => void handleActivate()}>
            {busy ? '処理中…' : 'この版を有効化して編集'}
          </Button>
        </div>
      ) : null}

      <div className={inspectionDrawingCreateWorkspaceClassName}>
        <div className={inspectionDrawingCreateCanvasColumnClassName}>
          {canvasImageUrl ? (
            <InspectionDrawingCanvas
              imageUrl={canvasImageUrl}
              points={points}
              mode={mode === 'guidedTrial' ? 'test' : mode}
              zoom={zoom}
              fitGeneration={fitGeneration}
              focusRequest={mode === 'guidedTrial' ? guidedTrial.focusRequest : null}
              selectedPointId={selectedPointId}
              onSelectPoint={handleSelectPointFromList}
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

        <aside className={inspectionDrawingCreateSideAsideClassName}>
          <InspectionDrawingPointSidebar
            mode={mode}
            points={points}
            selectedPoint={selectedPoint}
            contentReadOnly={contentReadOnly}
            onSelectPoint={handleSelectPointFromList}
            onPointChange={(patch) => {
              if (!selectedPoint) return;
              updatePoint(selectedPoint.id, patch);
            }}
            onRemovePoint={contentReadOnly ? undefined : removeSelected}
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
    </div>
  );
}
