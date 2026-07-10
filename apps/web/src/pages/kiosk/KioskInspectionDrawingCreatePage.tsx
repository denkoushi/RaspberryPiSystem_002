import {
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  type InspectionDrawingMeasurementLabelSetting
} from '@raspi-system/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  addKioskInspectionDrawingTemplateGroupResources,
  activatePartMeasurementTemplate,
  changeKioskInspectionDrawingTemplateProcessGroup,
  createKioskInspectionDrawingTemplateGroup,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  deleteUnusedPartMeasurementVisualTemplate,
  getKioskInspectionDrawingTemplate,
  getPartMeasurementVisualTemplateOcrStatus,
  getResolvedClientKey,
  existsActivePartMeasurementTemplate,
  listInspectionDrawingMeasurementLabelSettings,
  listPartMeasurementDrawingOcrCandidates,
  listPartMeasurementVisualTemplates,
  reviseKioskInspectionDrawingTemplate,
  reviseKioskInspectionDrawingTemplateGroup
} from '../../api/client';
import { useKioskProductionScheduleResources } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  buildGeometricTolerancePointPatch,
  buildInspectionDrawingCreateDirtySnapshot,
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
  inspectionDrawingCreateKeyCollisionMessage,
  INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED,
  kioskInspectionDrawingTemplateEditPath,
  kioskInspectionDrawingTemplatePrintPath,
  templateItemToDrawingPoint,
  inspectionDrawingBlobFetchPath,
  inspectionDrawingCanvasImageUrl,
  inspectionDrawingHasImageSource,
  inspectionDrawingCreateDirtySnapshotsEqual,
  parseInspectionDrawingSourceTemplateIdFromSearch,
  parseInspectionDrawingVisualTemplateIdFromSearch,
  normalizeUniqueInspectionDrawingResourceCds,
  pointUsesGeometricTolerance,
  resolveInspectionDrawingCreateKeyCollisionForResources,
  resolveInspectionDrawingCreateSaveBlockReason,
  resolveInspectionDrawingCreateSaveStatus,
  suggestInspectionDrawingTemplateName,
  templateToCreateDraft,
  useInspectionDrawingUnsavedChangesGuard
} from '../../features/part-measurement/inspection-drawing';
import { InspectionDrawingResourceCdMultiSelect } from '../../features/part-measurement/inspection-drawing/InspectionDrawingResourceCdMultiSelect';
import { INSPECTION_DRAWING_VISUAL_PICKER_LIMIT } from '../../features/part-measurement/inspection-drawing/inspectionDrawingVisualLibraryConstants';
import { resolveVisualTemplateById } from '../../features/part-measurement/inspection-drawing/inspectionDrawingVisualLibraryHelpers';
import {
  createInspectionDrawingPoint,
  nextAvailableMarkerNo,
  toleranceBoundsFromPoint
} from '../../features/part-measurement/inspection-drawing/markerNumbering';
import { partMeasurementDrawingPreviewConvertingLabel } from '../../features/part-measurement/partMeasurementDrawingLocalPreview';
import {
  mapTemplateFixedCountToFormString,
  buildSelfInspectionTemplateApiBody
} from '../../features/part-measurement/selfInspectionTemplateForm';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { usePartMeasurementDrawingLocalPreview } from '../../features/part-measurement/usePartMeasurementDrawingLocalPreview';

import { parseKioskInspectionDrawingReturnFromLocation } from './kioskInspectionDrawingReturnNavigation';

import type {
  InspectionDrawingCreateDraftForm,
  InspectionDrawingCreateDirtySnapshot,
  InspectionDrawingSourceTemplateDraft,
  InspectionDrawingVisualSource
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingCreateDraft';
import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementDrawingOcrCandidateDto,
  PartMeasurementDrawingOcrStatus,
  PartMeasurementDrawingOcrStatusDto,
  PartMeasurementTemplateDto,
  PartMeasurementVisualTemplateDto,
  SelfInspectionMode
} from '../../features/part-measurement/types';

function confirmVisualChange(message: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.confirm(message);
}

type DrawingOcrCandidateState = {
  requestId: number;
  loading: boolean;
  status: PartMeasurementDrawingOcrStatus | null;
  candidates: PartMeasurementDrawingOcrCandidateDto[];
  error: string | null;
};

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
  const [resourceCds, setResourceCds] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateNameAutoMode, setTemplateNameAutoMode] = useState(true);
  const [serverDrawingPath, setServerDrawingPath] = useState<string | null>(null);
  const [points, setPoints] = useState<InspectionDrawingPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [ocrCandidatesByPointId, setOcrCandidatesByPointId] = useState<Record<string, DrawingOcrCandidateState>>({});
  const [visualOcrStatus, setVisualOcrStatus] = useState<PartMeasurementDrawingOcrStatusDto | null>(null);
  const [visualOcrLoading, setVisualOcrLoading] = useState(false);
  const [visualOcrError, setVisualOcrError] = useState<string | null>(null);
  const [mode, setMode] = useState<'place' | 'callout' | 'test' | 'guidedTrial'>('place');
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
  const [activeKeyExistsByResourceCd, setActiveKeyExistsByResourceCd] = useState<Record<string, boolean>>({});
  const [groupSaveMode, setGroupSaveMode] = useState<'group' | 'single'>('single');
  const [resourceAddCds, setResourceAddCds] = useState<string[]>([]);
  const [resourceAddBusy, setResourceAddBusy] = useState(false);
  const [measurementLabelSettings, setMeasurementLabelSettings] = useState<
    InspectionDrawingMeasurementLabelSetting[]
  >(() => buildDefaultInspectionDrawingMeasurementLabelSettings());
  const [savedSnapshot, setSavedSnapshot] =
    useState<InspectionDrawingCreateDirtySnapshot | null>(null);
  const { zoom, zoomIn, zoomOut, fitToView, resetZoom, fitGeneration, setZoomLevel } = useInspectionDrawingZoom();

  const {
    localPreviewUrl,
    saveFile,
    previewResolving,
    previewError,
    pendingPreviewFile,
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
  const selectedPointOcrState = selectedPoint ? ocrCandidatesByPointId[selectedPoint.id] : undefined;
  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const resourceOptions = useMemo(() => {
    const unique = new Set(resourcesQuery.data?.resources ?? []);
    if (resourceCd.trim()) unique.add(resourceCd.trim());
    for (const cd of resourceCds) {
      if (cd.trim()) unique.add(cd.trim());
    }
    for (const cd of resourceAddCds) {
      if (cd.trim()) unique.add(cd.trim());
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [resourceAddCds, resourceCd, resourceCds, resourcesQuery.data?.resources]);
  const resourceSelectOptions = useMemo(
    () =>
      resourceOptions.map((cd) => ({
        value: cd,
        label: formatResourceCdWithJapaneseNames(cd, resourceNameMap)
      })),
    [resourceNameMap, resourceOptions]
  );

  const selectedResourceCds = useMemo(
    () =>
      isEditing
        ? normalizeUniqueInspectionDrawingResourceCds(resourceCd.trim() ? [resourceCd] : [])
        : normalizeUniqueInspectionDrawingResourceCds(resourceCds),
    [isEditing, resourceCd, resourceCds]
  );

  const keyCollision = useMemo(() => {
    if (isEditing) return null;
    const f = fhincd.trim();
    if (!f || selectedResourceCds.length === 0) return null;
    return resolveInspectionDrawingCreateKeyCollisionForResources({
      fhincd: f,
      processGroup,
      resourceCds: selectedResourceCds,
      sourceDraft: sourceTemplateDraft,
      activeExistsByResourceCd: activeKeyExistsByResourceCd
    });
  }, [
    activeKeyExistsByResourceCd,
    fhincd,
    isEditing,
    processGroup,
    selectedResourceCds,
    sourceTemplateDraft
  ]);

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
  const visualTemplateIdForOcr =
    visualSource === 'pickExisting' && selectedVisualTemplateId?.trim()
      ? selectedVisualTemplateId
      : null;
  const visualOcrPending =
    visualOcrLoading || visualOcrStatus?.status === 'pending' || visualOcrStatus?.status === 'processing';
  const visualOcrNotice =
    visualTemplateIdForOcr && visualOcrPending
      ? 'OCR準備中'
      : visualTemplateIdForOcr && visualOcrStatus?.status === 'failed'
        ? 'OCR準備失敗（手入力は可能です）'
        : visualTemplateIdForOcr && visualOcrError
          ? visualOcrError
          : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await listInspectionDrawingMeasurementLabelSettings(clientKey);
        if (!cancelled) setMeasurementLabelSettings(settings);
      } catch {
        if (!cancelled) {
          setMeasurementLabelSettings(buildDefaultInspectionDrawingMeasurementLabelSettings());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientKey]);

  useEffect(() => {
    setOcrCandidatesByPointId({});
    setVisualOcrStatus(null);
    setVisualOcrError(null);
    if (!visualTemplateIdForOcr) {
      setVisualOcrLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof window.setTimeout> | null = null;
    const load = async () => {
      setVisualOcrLoading(true);
      try {
        const status = await getPartMeasurementVisualTemplateOcrStatus(visualTemplateIdForOcr, clientKey);
        if (cancelled) return;
        setVisualOcrStatus(status);
        setVisualOcrError(null);
        if (status.status === 'pending' || status.status === 'processing') {
          timer = window.setTimeout(load, 5000);
        }
      } catch {
        if (cancelled) return;
        setVisualOcrError('OCR準備状態を確認できません');
      } finally {
        if (!cancelled) setVisualOcrLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [clientKey, visualTemplateIdForOcr]);

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

  const suggestedTemplateName = useMemo(
    () =>
      suggestInspectionDrawingTemplateName({
        visualTemplateName: selectedVisualLabel,
        fhincd
      }),
    [fhincd, selectedVisualLabel]
  );
  const effectiveTemplateName = useMemo(
    () => templateName.trim() || suggestedTemplateName || (fhincd.trim() ? `検査図面 ${fhincd.trim()}` : ''),
    [fhincd, suggestedTemplateName, templateName]
  );

  const hasSaveReadyDrawing =
    visualSource === 'pickExisting'
      ? Boolean(selectedVisualTemplateId?.trim())
      : visualSource === 'upload'
        ? Boolean(saveFile && hasLocalRenderablePreview && !previewError && !previewResolving)
        : Boolean(isEditing && template?.visualTemplateId?.trim());

  const pointsValid = useMemo(
    () =>
      points.length > 0 &&
      points.every(
        (pt) =>
          pt.name.trim().length > 0 &&
          !('error' in toleranceBoundsFromPoint(pt, { measurementLabelSettings }))
      ),
    [measurementLabelSettings, points]
  );

  const selfInspectionPayloadPreview = useMemo(
    () => buildSelfInspectionTemplateApiBody(selfInspectionMode, selfInspectionFixedCount),
    [selfInspectionFixedCount, selfInspectionMode]
  );

  const saveBlockReason = resolveInspectionDrawingCreateSaveBlockReason({
    contentReadOnly,
    busy,
    fhincd,
    resourceCds: selectedResourceCds,
    hasDrawing: hasSaveReadyDrawing,
    pointCount: points.length,
    pointsValid,
    selfInspectionValid: !('error' in selfInspectionPayloadPreview),
    keyCollision,
    saveBlockedByPreview
  });

  const snapshotVisualTemplateId =
    visualSource === 'pickExisting'
      ? selectedVisualTemplateId
      : visualSource === 'unselected'
        ? template?.visualTemplateId ?? null
        : null;
  const currentSnapshot = useMemo(
    () =>
      buildInspectionDrawingCreateDirtySnapshot({
        templateName: effectiveTemplateName,
        fhincd,
        resourceCds: selectedResourceCds,
        processGroup,
        visualSource,
        visualTemplateId: snapshotVisualTemplateId,
        uploadPending: visualSource === 'upload' && Boolean(saveFile || hasPendingLocalSelection),
        selfInspectionMode,
        selfInspectionFixedCount,
        groupSaveMode,
        points
      }),
    [
      effectiveTemplateName,
      fhincd,
      groupSaveMode,
      hasPendingLocalSelection,
      points,
      processGroup,
      saveFile,
      selectedResourceCds,
      selfInspectionFixedCount,
      selfInspectionMode,
      snapshotVisualTemplateId,
      visualSource
    ]
  );
  const hasNewDraftContent =
    effectiveTemplateName.trim().length > 0 ||
    fhincd.trim().length > 0 ||
    selectedResourceCds.length > 0 ||
    points.length > 0 ||
    Boolean(snapshotVisualTemplateId) ||
    visualSource !== 'unselected' ||
    selfInspectionMode !== 'full' ||
    selfInspectionFixedCount.trim().length > 0;
  const hasUnsavedChanges = savedSnapshot
    ? !inspectionDrawingCreateDirtySnapshotsEqual(savedSnapshot, currentSnapshot)
    : hasNewDraftContent;
  const saveStatus = resolveInspectionDrawingCreateSaveStatus({
    contentReadOnly,
    busy,
    saveBlockReason,
    dirty: hasUnsavedChanges
  });

  useInspectionDrawingUnsavedChangesGuard(!contentReadOnly && !busy && hasUnsavedChanges);

  const drawingReplacePendingRef = useRef(false);
  const prevSourceTemplateIdRef = useRef<string | null>(null);
  const prevVisualTemplateIdFromSearchRef = useRef<string | null>(null);
  const visualSearchRequestSeqRef = useRef(0);
  const ocrCandidateRequestSeqRef = useRef(0);

  const handleTemplateNameChange = useCallback((value: string) => {
    setTemplateName(value);
    if (value.trim().length === 0) {
      setTemplateNameAutoMode(true);
    } else {
      setTemplateNameAutoMode(false);
    }
  }, []);

  const handleResourceCdsChange = useCallback((values: string[]) => {
    const normalized = normalizeUniqueInspectionDrawingResourceCds(values);
    setResourceCds(normalized);
    setResourceCd(normalized[0] ?? '');
  }, []);

  useEffect(() => {
    if (isEditing || !templateNameAutoMode) return;
    setTemplateName(suggestedTemplateName);
  }, [isEditing, suggestedTemplateName, templateNameAutoMode]);

  const applyLoadedTemplate = useCallback(
    (loaded: PartMeasurementTemplateDto) => {
      const loadedProcessGroup: PartMeasurementProcessGroup =
        loaded.processGroup === 'grinding' ? 'grinding' : 'cutting';
      const loadedPoints = loaded.items.map((item) => templateItemToDrawingPoint(item));
      const loadedSelfInspectionFixedCount = mapTemplateFixedCountToFormString(
        loaded.selfInspectionMode,
        loaded.selfInspectionFixedCount,
        loaded.selfInspectionSampleSize
      );
      setTemplate(loaded);
      setTemplateName(loaded.name);
      setTemplateNameAutoMode(false);
      setFhincd(loaded.fhincd);
      setResourceCd(loaded.resourceCd);
      setResourceCds([loaded.resourceCd]);
      setGroupSaveMode(loaded.siblingGroupId ? 'group' : 'single');
      setResourceAddCds([]);
      setProcessGroup(loadedProcessGroup);
      setPoints(loadedPoints);
      setSelectedPointId(loaded.items[0]?.id ?? null);
      setOcrCandidatesByPointId({});
      setServerDrawingPath(loaded.visualTemplate?.drawingImageRelativePath ?? null);
      setSelfInspectionMode(loaded.selfInspectionMode);
      setSelfInspectionFixedCount(loadedSelfInspectionFixedCount);
      if (loaded.visualTemplateId?.trim()) {
        setVisualSource('pickExisting');
        setSelectedVisualTemplateId(loaded.visualTemplateId);
        setSelectedVisualLabel(loaded.visualTemplate?.name ?? null);
      } else {
        setVisualSource('unselected');
        setSelectedVisualTemplateId(null);
        setSelectedVisualLabel(null);
      }
      setSavedSnapshot(
        buildInspectionDrawingCreateDirtySnapshot({
          templateName: loaded.name,
          fhincd: loaded.fhincd,
          resourceCds: [loaded.resourceCd],
          processGroup: loadedProcessGroup,
          visualSource: loaded.visualTemplateId?.trim() ? 'pickExisting' : 'unselected',
          visualTemplateId: loaded.visualTemplateId?.trim() ? loaded.visualTemplateId : null,
          uploadPending: false,
          selfInspectionMode: loaded.selfInspectionMode,
          selfInspectionFixedCount: loadedSelfInspectionFixedCount,
          groupSaveMode: loaded.siblingGroupId ? 'group' : 'single',
          points: loadedPoints
        })
      );
      resetLocalPreview();
    },
    [resetLocalPreview]
  );

  const resetBlankCreateForm = useCallback(() => {
    setSourceTemplateDraft(null);
    setTemplateName('');
    setTemplateNameAutoMode(true);
    setFhincd('');
    setResourceCd('');
    setResourceCds([]);
    setGroupSaveMode('single');
    setResourceAddCds([]);
    setProcessGroup('cutting');
    setPoints([]);
    setSelectedPointId(null);
    setOcrCandidatesByPointId({});
    setSelfInspectionMode('full');
    setSelfInspectionFixedCount('');
    setVisualSource('unselected');
    setSelectedVisualTemplateId(null);
    setSelectedVisualLabel(null);
    setServerDrawingPath(null);
    setSavedSnapshot(null);
    resetLocalPreview();
  }, [resetLocalPreview]);

  const applyCreateDraft = useCallback(
    (draft: InspectionDrawingCreateDraftForm) => {
      setSourceTemplateDraft(draft.sourceDraft);
      setTemplateNameAutoMode(true);
      setTemplateName('');
      setFhincd(draft.fhincd);
      setResourceCd(draft.resourceCd);
      setResourceCds([draft.resourceCd]);
      setProcessGroup(draft.processGroup);
      setPoints(draft.points);
      setSelectedPointId(draft.points[0]?.id ?? null);
      setOcrCandidatesByPointId({});
      setSelfInspectionMode(draft.selfInspectionMode);
      setSelfInspectionFixedCount(draft.selfInspectionFixedCount);
      setSavedSnapshot(null);
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

  const applyInitialVisualPick = useCallback(
    (visual: Pick<PartMeasurementVisualTemplateDto, 'id' | 'name' | 'drawingImageRelativePath'>) => {
      resetLocalPreview();
      setVisualSource('pickExisting');
      setSelectedVisualTemplateId(visual.id);
      setSelectedVisualLabel(visual.name);
      setServerDrawingPath(visual.drawingImageRelativePath);
      setOcrCandidatesByPointId({});
      setSavedSnapshot(null);
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
      setOcrCandidatesByPointId({});
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
      setOcrCandidatesByPointId({});
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
          { q: searchQuery?.trim() || undefined, limit: INSPECTION_DRAWING_VISUAL_PICKER_LIMIT },
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
    if (isEditing) return;

    const sourceId = parseInspectionDrawingSourceTemplateIdFromSearch(location.search);
    if (sourceId) {
      prevVisualTemplateIdFromSearchRef.current = null;
      return;
    }

    const visualIdFromSearch = parseInspectionDrawingVisualTemplateIdFromSearch(location.search);
    const prevVisualId = prevVisualTemplateIdFromSearchRef.current;
    prevVisualTemplateIdFromSearchRef.current = visualIdFromSearch;

    if (!visualIdFromSearch) {
      if (prevVisualId) {
        resetBlankCreateForm();
        setMessage(null);
      }
      return;
    }

    if (prevVisualId === visualIdFromSearch) {
      return;
    }

    resetBlankCreateForm();
    setMessage(null);

    let cancelled = false;
    void (async () => {
      try {
        const visual = await resolveVisualTemplateById(visualIdFromSearch, clientKey);
        if (cancelled) return;
        if (!visual) {
          setMessage('指定の図面が見つかりませんでした。');
          return;
        }
        applyInitialVisualPick(visual);
      } catch {
        if (!cancelled) {
          setMessage('図面の読み込みに失敗しました。');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    applyInitialVisualPick,
    clientKey,
    isEditing,
    location.search,
    resetBlankCreateForm
  ]);

  useEffect(() => {
    if (isEditing) {
      setActiveKeyExistsByResourceCd({});
      return;
    }
    const f = fhincd.trim();
    if (!f || selectedResourceCds.length === 0) {
      setActiveKeyExistsByResourceCd({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const entries = await Promise.all(
            selectedResourceCds.map(async (selectedResourceCd) => {
              const exists = await existsActivePartMeasurementTemplate(
                { fhincd: f, processGroup, resourceCd: selectedResourceCd },
                clientKey
              );
              return [selectedResourceCd, exists] as const;
            })
          );
          if (!cancelled) {
            setActiveKeyExistsByResourceCd(Object.fromEntries(entries));
          }
        } catch {
          if (!cancelled) setActiveKeyExistsByResourceCd({});
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientKey, fhincd, isEditing, processGroup, selectedResourceCds]);

  useEffect(() => {
    resetZoom();
  }, [canvasImageUrl, resetZoom]);

  useEffect(() => {
    if (!drawingReplacePendingRef.current || !hasLocalRenderablePreview || !saveFile) return;
    drawingReplacePendingRef.current = false;
    setPoints([]);
    setSelectedPointId(null);
    setOcrCandidatesByPointId({});
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

  const invalidateOcrCandidatesForPoint = useCallback((pointId: string) => {
    setOcrCandidatesByPointId((prev) => {
      if (!(pointId in prev)) return prev;
      const next = { ...prev };
      delete next[pointId];
      return next;
    });
  }, []);

  const requestOcrCandidatesForPoint = useCallback(
    (point: InspectionDrawingPoint) => {
      const visualId = visualTemplateIdForOcr;
      if (!visualId) return;
      if (visualOcrStatus?.status !== 'completed') return;
      const requestId = ++ocrCandidateRequestSeqRef.current;
      setOcrCandidatesByPointId((prev) => ({
        ...prev,
        [point.id]: {
          requestId,
          loading: true,
          status: null,
          candidates: [],
          error: null
        }
      }));
      void (async () => {
        try {
          const result = await listPartMeasurementDrawingOcrCandidates(
            visualId,
            {
              xRatio: point.xRatio,
              yRatio: point.yRatio,
              markerNo: point.markerNo,
              limit: 5,
              measurementLabel: point.name.trim() || null,
              depthMode: point.depthMode ?? 'measured'
            },
            clientKey
          );
          setOcrCandidatesByPointId((prev) => {
            const current = prev[point.id];
            if (!current || current.requestId !== requestId) return prev;
            return {
              ...prev,
              [point.id]: {
                requestId,
                loading: false,
                status: result.status,
                candidates: result.candidates,
                error: null
              }
            };
          });
        } catch {
          setOcrCandidatesByPointId((prev) => {
            const current = prev[point.id];
            if (!current || current.requestId !== requestId) return prev;
            return {
              ...prev,
              [point.id]: {
                ...current,
                loading: false,
                status: null,
                candidates: [],
                error: 'OCR候補なし'
              }
            };
          });
        }
      })();
    },
    [clientKey, visualOcrStatus?.status, visualTemplateIdForOcr]
  );

  useEffect(() => {
    if (visualOcrStatus?.status !== 'completed') return;
    if (!selectedPoint) return;
    const current = ocrCandidatesByPointId[selectedPoint.id];
    if (current?.loading || current?.candidates.length || current?.status === 'completed') return;
    requestOcrCandidatesForPoint(selectedPoint);
  }, [ocrCandidatesByPointId, requestOcrCandidatesForPoint, selectedPoint, visualOcrStatus?.status]);

  const removeSelected = () => {
    if (contentReadOnly || !selectedPointId) return;
    setPoints((prev) => prev.filter((p) => p.id !== selectedPointId));
    setOcrCandidatesByPointId((prev) => {
      const next = { ...prev };
      delete next[selectedPointId];
      return next;
    });
    setSelectedPointId(null);
    guidedTrial.resetTrialState();
  };

  const removeAllPoints = () => {
    if (contentReadOnly || points.length === 0) return;
    if (!confirmVisualChange('すべての測定点を削除します。続行しますか？')) return;
    setPoints([]);
    setSelectedPointId(null);
    setOcrCandidatesByPointId({});
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

  const handleLineageLockedProcessGroupChange = async (next: PartMeasurementProcessGroup) => {
    if (!templateId || !template) return;
    const current = template.processGroup ?? processGroup;
    if (next === current) return;

    const label = next === 'cutting' ? '切削' : '研削';
    if (
      !confirmVisualChange(
        `工程を${label}へ変更します。この図面の全バージョン（兄弟グループ含む）に適用されます。よろしいですか？`
      )
    ) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const updated = await changeKioskInspectionDrawingTemplateProcessGroup(
        templateId,
        { processGroup: next },
        clientKey
      );
      applyLoadedTemplate(updated);
      if (updated.processGroup) {
        setProcessGroup(updated.processGroup);
      }
      setMessage(`工程を${label}へ変更しました。`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '工程の変更に失敗しました。');
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
    if (!hasUnsavedChanges) {
      setMessage('変更はありません。');
      return;
    }
    const f = fhincd.trim();
    const targetResourceCds = selectedResourceCds;
    const name = effectiveTemplateName || `検査図面 ${f}`;
    if (!f || targetResourceCds.length === 0) {
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
      const bounds = toleranceBoundsFromPoint(pt, { measurementLabelSettings });
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
        setMessage('新規アップロードの図面ファイルを選んでください（PDFは1ページ目のみ・TIFF/TIFも可）。');
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

      const items = points.map((pt, idx) =>
        drawingPointToTemplateItemInput(pt, idx, { measurementLabelSettings })
      );
      if (isEditing && templateId) {
        let saved: PartMeasurementTemplateDto;
        if (template?.siblingGroupId && groupSaveMode === 'group') {
          const result = await reviseKioskInspectionDrawingTemplateGroup(
            template.siblingGroupId,
            {
              name,
              visualTemplateId,
              selfInspectionMode: selfInspectionPayload.selfInspectionMode,
              selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
              items
            },
            clientKey
          );
          const nextTemplate =
            result.templates.find((candidate) => candidate.resourceCd === template.resourceCd) ??
            result.templates[0];
          if (!nextTemplate) {
            setMessage('保存結果の取得に失敗しました。一覧を確認してください。');
            return;
          }
          saved = nextTemplate;
        } else {
          saved = await reviseKioskInspectionDrawingTemplate(
            templateId,
            {
              name,
              visualTemplateId,
              selfInspectionMode: selfInspectionPayload.selfInspectionMode,
              selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
              detachFromSiblingGroup: Boolean(template?.siblingGroupId && groupSaveMode === 'single'),
              items
            },
            clientKey
          );
        }
        applyLoadedTemplate(saved);
        setMessage(
          template?.siblingGroupId && groupSaveMode === 'single'
            ? '個別改版として保存しました。この資源は兄弟グループから外れました。'
            : '保存しました。履歴から旧版を確認できます。'
        );
        void navigate(kioskInspectionDrawingTemplateEditPath(saved.id), {
          replace: true,
          state: inspectionReturn
        });
      } else if (targetResourceCds.length >= 2) {
        const result = await createKioskInspectionDrawingTemplateGroup(
          {
            fhincd: f,
            resourceCds: targetResourceCds,
            processGroup,
            name,
            displayName: name,
            visualTemplateId,
            selfInspectionMode: selfInspectionPayload.selfInspectionMode,
            selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
            items
          },
          clientKey
        );
        const created = result.templates[0];
        if (!created) {
          setMessage('保存結果の取得に失敗しました。一覧を確認してください。');
          return;
        }
        applyLoadedTemplate(created);
        setMessage(`${targetResourceCds.length}件の資源へ保存しました。一覧では1グループとして表示されます。`);
        void navigate(kioskInspectionDrawingTemplateEditPath(created.id), {
          replace: true,
          state: inspectionReturn
        });
      } else {
        const created = await createPartMeasurementTemplate(
          {
            templateScope: 'three_key',
            fhincd: f,
            resourceCd: targetResourceCds[0]!,
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

  const handleAddResourcesToGroup = async () => {
    if (!template?.siblingGroupId) return;
    const targetResourceCds = normalizeUniqueInspectionDrawingResourceCds(resourceAddCds);
    if (targetResourceCds.length === 0) {
      setMessage('追加する資源CDを選択してください。');
      return;
    }
    setResourceAddBusy(true);
    setMessage(null);
    try {
      await addKioskInspectionDrawingTemplateGroupResources(
        template.siblingGroupId,
        {
          resourceCds: targetResourceCds,
          sourceTemplateId: template.id
        },
        clientKey
      );
      const reloaded = await getKioskInspectionDrawingTemplate(template.id, clientKey);
      applyLoadedTemplate(reloaded);
      setResourceAddCds([]);
      setMessage('資源を追加しました。保存済み最新版の内容をコピーしています。');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err.response?.data?.message ?? '資源追加に失敗しました。');
    } finally {
      setResourceAddBusy(false);
    }
  };

  const handleSelectPointFromList = (id: string) => {
    if (mode === 'guidedTrial') {
      guidedTrial.handleManualSelect(id);
      return;
    }
    setSelectedPointId(id);
  };

  const saveDisabled = saveBlockReason !== null || !hasUnsavedChanges;

  return (
    <div className={inspectionDrawingCreatePageRootClassName}>
      <InspectionDrawingCreateCompactHeader
        centerSlot={
          hasDrawingImage ? (
            <InspectionDrawingCanvasZoomControls
              enabled={hasDrawingImage}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetZoom={resetZoom}
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
          resourceCds: lineageLocked ? undefined : resourceCds,
          onResourceCdsChange: lineageLocked ? undefined : handleResourceCdsChange,
          resourceSelectOptions,
          resourceNameMap,
          processGroup,
          templateProcessGroup: template?.processGroup,
          onLineageLockedProcessGroupChange: lineageLocked ? handleLineageLockedProcessGroupChange : undefined,
          processGroupChangeDisabled: busy || contentReadOnly,
          templateName,
          onTemplateNameChange: handleTemplateNameChange,
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
            saveStatus={saveStatus}
            savedPrintPath={
              INSPECTION_DRAWING_PRINT_PRODUCTION_ENABLED && isEditing && templateId
                ? kioskInspectionDrawingTemplatePrintPath(templateId)
                : undefined
            }
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
      {isEditing && template?.siblingGroup ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-white/15 bg-slate-900/70 px-2 py-1 text-sm text-white">
          <span className="font-semibold text-slate-300">保存範囲</span>
          <label className="inline-flex min-h-10 items-center gap-1 rounded border border-white/15 px-2">
            <input
              type="radio"
              checked={groupSaveMode === 'group'}
              disabled={contentReadOnly}
              onChange={() => setGroupSaveMode('group')}
            />
            <span>兄弟テンプレをまとめて改版</span>
          </label>
          <label className="inline-flex min-h-10 items-center gap-1 rounded border border-white/15 px-2">
            <input
              type="radio"
              checked={groupSaveMode === 'single'}
              disabled={contentReadOnly}
              onChange={() => setGroupSaveMode('single')}
            />
            <span>この資源だけ個別改版</span>
          </label>
          {groupSaveMode === 'single' ? (
            <span className="text-amber-200">保存後、この資源はグループから外れます。</span>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {(template.siblingGroup.activeResourceCds.length > 0
              ? template.siblingGroup.activeResourceCds
              : [template.resourceCd]
            ).map((cd) => (
              <span
                key={cd}
                className="rounded border border-cyan-300/40 bg-cyan-950/60 px-1.5 py-0.5 text-xs text-cyan-100"
                title={formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
              >
                {cd}
              </span>
            ))}
          </div>
          <InspectionDrawingResourceCdMultiSelect
            values={resourceAddCds}
            onChange={setResourceAddCds}
            options={resourceSelectOptions}
            resourceNameMap={resourceNameMap}
            disabled={contentReadOnly || resourceAddBusy}
            label="追加資源"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={contentReadOnly || resourceAddBusy || resourceAddCds.length === 0}
            className="min-h-10 px-3 py-1.5"
            onClick={() => void handleAddResourcesToGroup()}
          >
            {resourceAddBusy ? '追加中...' : '資源追加'}
          </Button>
        </div>
      ) : null}
      {keyCollisionMessage ? (
        <div
          role="status"
          className="rounded border border-amber-400/45 bg-amber-500/10 px-2 py-1.5 text-[0.95rem] font-semibold text-amber-100"
        >
          {keyCollisionMessage}
        </div>
      ) : null}
      {message ? <p className="px-1 text-[1rem] font-semibold text-amber-200">{message}</p> : null}
      {previewError ? <p className="px-1 text-sm text-red-300">{previewError}</p> : null}
      {drawingLoadError ? <p className="px-1 text-sm text-red-300">{drawingLoadError}</p> : null}
      {visualOcrNotice ? <p className="px-1 text-sm font-semibold text-cyan-100/75">{visualOcrNotice}</p> : null}
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
                contentReadOnly || mode !== 'place'
                  ? undefined
                  : (x, y) => {
                      const markerNo = nextAvailableMarkerNo(points);
                      const pt = createInspectionDrawingPoint(x, y, markerNo);
                      setPoints((prev) => [...prev, pt]);
                      setSelectedPointId(pt.id);
                      requestOcrCandidatesForPoint(pt);
                    }
              }
              onSetCalloutTip={
                contentReadOnly || mode !== 'callout' || !selectedPointId
                  ? undefined
                  : (x, y) => {
                      updatePoint(selectedPointId, {
                        calloutTipXRatio: Math.min(1, Math.max(0, x)),
                        calloutTipYRatio: Math.min(1, Math.max(0, y))
                      });
                    }
              }
            />
          ) : hasDrawingImage && !drawingLoadError && !previewError ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/30 text-[1rem] text-white/60">
              {previewResolving
                ? partMeasurementDrawingPreviewConvertingLabel(pendingPreviewFile)
                : '図面を読み込み中…'}
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
              const nextPoint = mergeInspectionDrawingPointPatch(selectedPoint, patch);
              updatePoint(selectedPoint.id, patch);
              const labelChanged =
                Object.prototype.hasOwnProperty.call(patch, 'name') ||
                Object.prototype.hasOwnProperty.call(patch, 'depthMode');
              const positionChanged =
                (typeof patch.xRatio === 'number' &&
                  Math.abs(patch.xRatio - selectedPoint.xRatio) >= 0.002) ||
                (typeof patch.yRatio === 'number' &&
                  Math.abs(patch.yRatio - selectedPoint.yRatio) >= 0.002);
              if (labelChanged || positionChanged) {
                invalidateOcrCandidatesForPoint(selectedPoint.id);
                requestOcrCandidatesForPoint(nextPoint);
              }
            }}
            onRemovePoint={contentReadOnly ? undefined : removeSelected}
            onRemoveAllPoints={contentReadOnly ? undefined : removeAllPoints}
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
            ocrCandidates={selectedPointOcrState?.candidates ?? []}
            ocrCandidateStatus={selectedPointOcrState?.status ?? null}
            ocrCandidateLoading={selectedPointOcrState?.loading ?? false}
            ocrCandidateError={selectedPointOcrState?.error ?? null}
            measurementLabelSettings={measurementLabelSettings}
            onApplyOcrCandidate={(valueText) => {
              if (!selectedPoint) return;
              updatePoint(
                selectedPoint.id,
                pointUsesGeometricTolerance(selectedPoint, { measurementLabelSettings })
                  ? buildGeometricTolerancePointPatch(valueText)
                  : { nominalRaw: valueText }
              );
            }}
          />
        </aside>
      </div>
    </div>
  );
}
