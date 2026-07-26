import clsx from 'clsx';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  createAssemblyTemplate,
  getKioskDocumentDetail,
  listCompatibleTorqueWrenchCapabilityGroups,
  reviseAssemblyTemplate,
  verifyAssemblyTemplateAccessPassword
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  AssemblyProcedureCanvas,
  AssemblyMarkerOverlay,
  AssemblyProcedureCropView,
  AssemblyProcedureStoryboard,
  AssemblyProcedureStepInspector,
  AssemblyTemplateDocumentLibraryDialog,
  AssemblyTemplateProcedurePane,
  appendAssemblyProcedureDocument,
  applyAssemblyBoltConditionRange,
  assemblyTemplateProcedureDraftToInput,
  assemblyTemplateProcedureDraftReducer,
  assemblyProcedureStepDraftReducer,
  buildProcedureDraftPageOptions,
  canRemoveAssemblyTemplateProcedureItem,
  canRemoveProcedureStep,
  createCropStepDraft,
  createFullPageStepDraft,
  createAssemblyBoltAt,
  createAssemblyCheckItemAt,
  draftAreasToInput,
  draftCheckItemsToInput,
  emptyAssemblyArea,
  filterDraftBoltsForPage,
  filterDraftCheckItemsForPage,
  findMarkerWithoutVisibleProcedureStep,
  findPageForProcedureStep,
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  getPrimaryAssemblyProcedureDocumentId,
  getPrimaryAssemblyDocumentIdFromSteps,
  hasAssemblyProcedureDocument,
  loadAssemblyTemplateEditorData,
  pageRefKey,
  orderProcedureItemsByFirstStep,
  parseAssemblyTemplateNewSearch,
  procedureStepDraftToInput,
  readAssemblyApiErrorMessage,
  renumberDraftCheckItems,
  resolveAssemblyDocumentStatus,
  templateToProcedureDraftItems,
  templateToProcedureStepDrafts,
  templateToDraftAreas,
  templateToDraftCheckItems,
  transformMarkerForProcedureStep
} from '../../features/assembly';
import {
  clearImageMarkerCalloutTip,
  ImageCanvasZoomControls,
  ImageMarkerPositionNudge,
  imageMarkerHasCalloutTip,
  setImageMarkerCalloutTip,
  useImageCanvasZoom
} from '../../features/kiosk/image-canvas';
import { useUnsavedChangesGuard } from '../../features/navigation/useUnsavedChangesGuard';

import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';
import type {
  AssemblyDraftArea,
  AssemblyDraftBolt,
  AssemblyDraftCheckItem,
  AssemblyEditorPageOption,
  AssemblyProcedureStepDraft,
  AssemblyTemplateProcedureDraftItem
} from '../../features/assembly';
import type { AssemblyProcedureDocumentSummaryDto, AssemblyTemplateDto } from '../../features/assembly/types';

function selectFirstAreaId(areas: AssemblyDraftArea[]): string {
  return areas[0]?.id ?? '';
}

export function KioskAssemblyTemplateEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { templateId } = useParams<{ templateId?: string }>();
  const query = useMemo(() => parseAssemblyTemplateNewSearch(location.search), [location.search]);
  const [documents, setDocuments] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [loadedTemplate, setLoadedTemplate] = useState<AssemblyTemplateDto | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(query.procedureDocumentId ?? '');
  const [procedureItems, dispatchProcedureItems] = useReducer(
    assemblyTemplateProcedureDraftReducer,
    []
  );
  const [procedureSteps, dispatchProcedureSteps] = useReducer(
    assemblyProcedureStepDraftReducer,
    []
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [leftPaneTab, setLeftPaneTab] = useState<'steps' | 'documents'>('steps');
  const [inspectorTab, setInspectorTab] = useState<'step' | 'markers'>('step');
  const [showFullPage, setShowFullPage] = useState(false);
  const [procedurePaneOpen, setProcedurePaneOpen] = useState(true);
  const [documentLibraryOpen, setDocumentLibraryOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState('');
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('組立トルクテンプレート');
  const [modelCode, setModelCode] = useState('');
  const [procedurePattern, setProcedurePattern] = useState('手順7');
  const [areas, setAreas] = useState<AssemblyDraftArea[]>(() => [emptyAssemblyArea()]);
  const [checkItems, setCheckItems] = useState<AssemblyDraftCheckItem[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>(null);
  const [selectedCheckItemId, setSelectedCheckItemId] = useState<string | null>(null);
  const [markerMode, setMarkerMode] = useState<'bolt' | 'check'>('bolt');
  const [placementAction, setPlacementAction] = useState<'place' | 'callout' | 'crop'>('place');
  const [pageOptions, setPageOptions] = useState<AssemblyEditorPageOption[]>([]);
  const [selectedPageKey, setSelectedPageKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inheritCondition, setInheritCondition] = useState(true);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(35);
  const [capabilityGroups, setCapabilityGroups] = useState<TorqueWrenchCapabilityGroupApi[]>([]);
  const canvasZoom = useImageCanvasZoom();
  const fitCanvasToView = canvasZoom.fitToView;

  const readOnly = Boolean(templateId && loadedTemplate && !loadedTemplate.isActive);
  const accessGranted = readOnly || accessPassword != null;
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? loadedTemplate?.procedureDocument ?? null,
    [documents, loadedTemplate?.procedureDocument, selectedDocumentId]
  );
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0] ?? null;
  const selectedBolt = selectedArea?.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const selectedCheckItem = checkItems.find((item) => item.id === selectedCheckItemId) ?? null;
  const selectedPage = pageOptions.find((option) => option.key === selectedPageKey) ?? pageOptions[0] ?? null;
  const selectedStep =
    procedureSteps.find((step) => step.localId === selectedStepId) ?? procedureSteps[0] ?? null;
  const selectedStepPage = selectedStep
    ? findPageForProcedureStep(selectedStep, pageOptions)
    : null;
  const selectedPageIndex = selectedPage
    ? pageOptions.findIndex((option) => option.key === selectedPage.key)
    : -1;
  const draftSnapshot = useMemo(
    () =>
      JSON.stringify({
        templateName,
        modelCode,
        procedurePattern,
        procedureItems: assemblyTemplateProcedureDraftToInput(procedureItems),
        procedureSteps: procedureStepDraftToInput(procedureSteps),
        areas: draftAreasToInput(areas),
        checkItems: draftCheckItemsToInput(checkItems)
      }),
    [areas, checkItems, modelCode, procedureItems, procedurePattern, procedureSteps, templateName]
  );
  const isDirty = baselineSnapshot != null && baselineSnapshot !== draftSnapshot;
  const markerSettingsOpen = Boolean(selectedBolt || selectedCheckItem);
  const settingsPaneOpen = Boolean(selectedStep || markerSettingsOpen);
  useUnsavedChangesGuard(isDirty && !busy && !readOnly);

  useEffect(() => {
    const primaryDocumentId =
      getPrimaryAssemblyDocumentIdFromSteps(procedureSteps) ??
      getPrimaryAssemblyProcedureDocumentId(procedureItems) ??
      '';
    setSelectedDocumentId(primaryDocumentId);
  }, [procedureItems, procedureSteps]);

  useEffect(() => {
    if (!loading && baselineSnapshot == null) setBaselineSnapshot(draftSnapshot);
  }, [baselineSnapshot, draftSnapshot, loading]);

  useEffect(() => {
    if (!selectedBolt?.nominalDiameter) {
      setCapabilityGroups([]);
      return;
    }
    let cancelled = false;
    void listCompatibleTorqueWrenchCapabilityGroups({
      nominalDiameter: selectedBolt.nominalDiameter,
      boltLengthMm: selectedBolt.boltLengthMm,
      material: selectedBolt.material,
      strengthClass: selectedBolt.strengthClass
    })
      .then((groups) => {
        if (!cancelled) setCapabilityGroups(groups);
      })
      .catch(() => {
        if (!cancelled) setCapabilityGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBolt?.boltLengthMm, selectedBolt?.material, selectedBolt?.nominalDiameter, selectedBolt?.strengthClass]);

  useEffect(() => {
    fitCanvasToView();
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
  }, [fitCanvasToView, selectedPageKey]);

  useEffect(() => {
    if (areas.length > 0 && !areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(areas[0].id);
      setSelectedBoltId(null);
    }
  }, [areas, selectedAreaId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    setBaselineSnapshot(null);
    setAccessPassword(null);
    setPasswordInput('');
    void loadAssemblyTemplateEditorData({
      templateId,
      sourceTemplateId: query.sourceTemplateId
    })
      .then(({ documents: nextDocuments, template }) => {
        if (cancelled) return;
        setDocuments(nextDocuments);
        if (template) {
          setLoadedTemplate(template);
          const nextProcedureItems = templateToProcedureDraftItems(template);
          dispatchProcedureItems({ type: 'replace', items: nextProcedureItems });
          setLeftPaneTab(
            typeof window !== 'undefined' && window.innerWidth >= 1366
              ? 'steps'
              : 'documents'
          );
          const nextProcedureSteps = templateToProcedureStepDrafts(template);
          dispatchProcedureSteps({ type: 'replace', steps: nextProcedureSteps });
          setSelectedStepId(nextProcedureSteps[0]?.localId ?? null);
          setProcedurePaneOpen(nextProcedureItems.length > 1);
          const nextAreas = templateToDraftAreas(template);
          const nextCheckItems = templateToDraftCheckItems(template);
          setAreas(nextAreas.length > 0 ? nextAreas : [emptyAssemblyArea()]);
          setCheckItems(nextCheckItems);
          setSelectedAreaId(selectFirstAreaId(nextAreas));
          setSelectedBoltId(null);
          setSelectedCheckItemId(null);
          if (templateId) {
            setTemplateName(template.name);
            setModelCode(template.modelCode);
            setProcedurePattern(template.procedurePattern);
          } else {
            setTemplateName(`${template.name} 雛形`);
            setModelCode('');
            setProcedurePattern(template.procedurePattern);
          }
        } else {
          setLoadedTemplate(null);
          const initialDocumentId =
            query.procedureDocumentId ||
            nextDocuments.find(
              (document) =>
                document.isActive && resolveAssemblyDocumentStatus(document) === 'published'
            )?.id ||
            '';
          const initialDocument = nextDocuments.find((document) => document.id === initialDocumentId);
          dispatchProcedureItems({
            type: 'replace',
            items: initialDocument
              ? [appendAssemblyProcedureDocument([], initialDocument)[0]!]
              : []
          });
          dispatchProcedureSteps({ type: 'replace', steps: [] });
          setSelectedStepId(null);
          setProcedurePaneOpen(false);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMessage(readAssemblyApiErrorMessage(e, 'テンプレート編集データの取得に失敗しました。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.procedureDocumentId, query.sourceTemplateId, templateId]);

  useEffect(() => {
    let cancelled = false;

    const buildOptions = async () => {
      const kioskPagesByDocumentId = new Map<string, { title: string; pageUrls: string[] }>();
      const kioskDocumentIds = [
        ...new Set(
          procedureItems
            .map((item) => item.kioskDocumentId)
            .filter((id): id is string => id != null)
        )
      ];
      await Promise.all(
        kioskDocumentIds.map(async (documentId) => {
        try {
            const detail = await getKioskDocumentDetail(documentId);
            kioskPagesByDocumentId.set(documentId, {
              title:
                detail.document.displayTitle?.trim() ||
                detail.document.title ||
                procedureItems.find((item) => item.kioskDocumentId === documentId)?.document.title ||
                '要領書',
              pageUrls: detail.pageUrls ?? []
            });
        } catch {
            // 旧文書列の参照先が欠けている場合も他の文書は表示する。
        }
        })
      );

      if (cancelled) return;
      const nextOptions = buildProcedureDraftPageOptions({
        items: procedureItems,
        assemblyDocuments: documents,
        kioskPagesByDocumentId
      });
      setPageOptions(nextOptions);
      setSelectedPageKey((current) => (nextOptions.some((option) => option.key === current) ? current : nextOptions[0]?.key ?? ''));
    };

    void buildOptions();
    return () => {
      cancelled = true;
    };
  }, [documents, procedureItems]);

  useEffect(() => {
    if (pageOptions.length === 0 || procedureSteps.length > 0) return;
    const initialSteps = pageOptions.map(createFullPageStepDraft);
    dispatchProcedureSteps({ type: 'replace', steps: initialSteps });
    setSelectedStepId(initialSteps[0]?.localId ?? null);
  }, [pageOptions, procedureSteps.length]);

  useEffect(() => {
    if (procedureSteps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (!procedureSteps.some((step) => step.localId === selectedStepId)) {
      setSelectedStepId(procedureSteps[0]!.localId);
    }
  }, [procedureSteps, selectedStepId]);

  const currentPageRef = useMemo(() => {
    if (!selectedPage) return null;
    return {
      source: selectedPage.source,
      documentId: selectedPage.documentId,
      pageIndex: selectedPage.pageIndex
    } as const;
  }, [selectedPage]);

  const visibleBolts = useMemo(() => {
    if (!currentPageRef || !selectedDocumentId) return [];
    return filterDraftBoltsForPage(areas, currentPageRef, selectedDocumentId);
  }, [areas, currentPageRef, selectedDocumentId]);

  const visibleCheckItems = useMemo(() => {
    if (!currentPageRef || !selectedDocumentId) return [];
    return filterDraftCheckItemsForPage(checkItems, currentPageRef, selectedDocumentId);
  }, [checkItems, currentPageRef, selectedDocumentId]);

  const allStepMarkers = useMemo(
    () =>
      [...areas.flatMap((area) => area.bolts), ...checkItems].map((marker) =>
        marker.kioskDocumentId || marker.assemblyProcedureDocumentId
          ? marker
          : {
              ...marker,
              kioskDocumentId: null,
              assemblyProcedureDocumentId: selectedDocumentId,
              pageIndex: marker.pageIndex ?? 0
            }
      ),
    [areas, checkItems, selectedDocumentId]
  );

  const cropVisibleBolts = useMemo(
    () =>
      selectedStep
        ? visibleBolts.flatMap((marker) => {
            const transformed = transformMarkerForProcedureStep(marker, selectedStep);
            return transformed ? [transformed] : [];
          })
        : [],
    [selectedStep, visibleBolts]
  );
  const cropVisibleCheckItems = useMemo(
    () =>
      selectedStep
        ? visibleCheckItems.flatMap((marker) => {
            const transformed = transformMarkerForProcedureStep(marker, selectedStep);
            return transformed ? [transformed] : [];
          })
        : [],
    [selectedStep, visibleCheckItems]
  );
  const showSelectedCrop =
    selectedStep?.viewMode === 'crop' &&
    selectedStep.crop != null &&
    selectedStepPage?.key === selectedPage?.key &&
    !showFullPage &&
    placementAction !== 'crop';

  const setAreaPatch = (areaId: string, patch: Partial<AssemblyDraftArea>) => {
    setAreas((prev) => prev.map((area) => (area.id === areaId ? { ...area, ...patch } : area)));
  };

  const setBoltPatch = (boltId: string, patch: Partial<AssemblyDraftBolt>) => {
    setAreas((prev) =>
      prev.map((area) => ({
        ...area,
        bolts: area.bolts.map((bolt) => (bolt.id === boltId ? { ...bolt, ...patch } : bolt))
      }))
    );
  };

  const setCheckItemPatch = (checkItemId: string, patch: Partial<AssemblyDraftCheckItem>) => {
    setCheckItems((prev) => prev.map((item) => (item.id === checkItemId ? { ...item, ...patch } : item)));
  };

  const addArea = () => {
    const next = emptyAssemblyArea(areas.length);
    setAreas((prev) => [...prev, next]);
    setSelectedAreaId(next.id);
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
  };

  const deleteSelectedBolt = () => {
    if (!selectedBolt || !selectedArea) return;
    setAreas((prev) =>
      prev.map((area) => {
        if (area.id !== selectedArea.id) return area;
        const bolts = area.bolts
          .filter((bolt) => bolt.id !== selectedBolt.id)
          .map((bolt, index) => ({ ...bolt, sortOrder: index }));
        return { ...area, bolts };
      })
    );
    setSelectedBoltId(null);
  };

  const deleteSelectedCheckItem = () => {
    if (!selectedCheckItem) return;
    setCheckItems((prev) => renumberDraftCheckItems(prev.filter((item) => item.id !== selectedCheckItem.id)));
    setSelectedCheckItemId(null);
  };

  const addBoltAt = (xRatio: number, yRatio: number) => {
    if (readOnly || !selectedArea || !currentPageRef) return;
    const next = createAssemblyBoltAt(selectedArea, xRatio, yRatio, currentPageRef, {
      allAreas: areas,
      inheritFrom: inheritCondition ? selectedBolt : null
    });
    setAreas((prev) => prev.map((area) => (area.id === selectedArea.id ? { ...area, bolts: [...area.bolts, next] } : area)));
    setSelectedBoltId(next.id);
    setSelectedCheckItemId(null);
    setInspectorTab('markers');
  };

  const applySelectedConditionToRange = () => {
    if (!selectedBolt) return;
    const result = applyAssemblyBoltConditionRange(areas, selectedBolt.id, rangeStart, rangeEnd);
    setAreas(result.areas);
    setMessage(`締付条件を${result.updatedCount}件へ反映しました。欠番は${result.missingCount}件です。`);
  };

  const addCheckItemAt = (xRatio: number, yRatio: number) => {
    if (readOnly || !currentPageRef) return;
    const next = createAssemblyCheckItemAt(checkItems, xRatio, yRatio, currentPageRef);
    setCheckItems((prev) => renumberDraftCheckItems([...prev, next]));
    setSelectedCheckItemId(next.id);
    setSelectedBoltId(null);
    setInspectorTab('markers');
  };

  const placeSelectedCalloutAt = (xRatio: number, yRatio: number) => {
    if (readOnly) return;
    const calloutTip = setImageMarkerCalloutTip(xRatio, yRatio);
    if (markerMode === 'bolt' && selectedBolt) {
      setBoltPatch(selectedBolt.id, calloutTip);
    }
    if (markerMode === 'check' && selectedCheckItem) {
      setCheckItemPatch(selectedCheckItem.id, calloutTip);
    }
  };

  const verifyEditorPassword = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyAssemblyTemplateAccessPassword({ password: passwordInput });
      if (!result.success) {
        setMessage('パスワードが違います。');
        return;
      }
      setAccessPassword(passwordInput);
      setPasswordInput('');
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '認証に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const addProcedureDocument = (
    document: AssemblyProcedureDocumentSummaryDto,
    mode: 'all_pages' | 'document_only'
  ) => {
    if (hasAssemblyProcedureDocument(procedureItems, document.id)) {
      setMessage('同じ組立手順書は新たに重複追加できません。');
      return;
    }
    if (procedureItems.length >= 50) {
      setMessage('文書順は50件までです。');
      return;
    }
    dispatchProcedureItems({ type: 'append_assembly_document', document });
    if (mode === 'all_pages') {
      const draftItem = appendAssemblyProcedureDocument([], document)[0]!;
      const pages = buildProcedureDraftPageOptions({
        items: [draftItem],
        assemblyDocuments: [document],
        kioskPagesByDocumentId: new Map()
      });
      dispatchProcedureSteps({ type: 'append_pages', pages });
    }
    setDocumentLibraryOpen(false);
    setMessage(null);
  };

  const moveProcedureItem = (index: number, delta: -1 | 1) => {
    dispatchProcedureItems({ type: 'move', index, delta });
  };

  const removeProcedureItem = (index: number) => {
    const item = procedureItems[index];
    if (
      item &&
      procedureSteps.some(
        (step) =>
          step.kioskDocumentId === item.kioskDocumentId &&
          step.assemblyProcedureDocumentId === item.assemblyProcedureDocumentId
      )
    ) {
      setMessage('この文書を使う表示ステップを先に削除してください。');
      return;
    }
    const markerRefs = [
      ...areas.flatMap((area) => area.bolts),
      ...checkItems
    ].map((marker) =>
      marker.kioskDocumentId || marker.assemblyProcedureDocumentId
        ? marker
        : { ...marker, assemblyProcedureDocumentId: selectedDocumentId }
    );
    const result = canRemoveAssemblyTemplateProcedureItem({
      items: procedureItems,
      index,
      markerRefs
    });
    if (!result.allowed) {
      setMessage(result.message);
      return;
    }
    dispatchProcedureItems({ type: 'remove', index });
    setMessage(null);
  };

  const focusProcedureItem = (item: AssemblyTemplateProcedureDraftItem) => {
    const firstPage = pageOptions.find((option) => option.key.startsWith(`${item.localId}:`));
    if (firstPage) setSelectedPageKey(firstPage.key);
  };

  const focusProcedureStep = (step: AssemblyProcedureStepDraft) => {
    setSelectedStepId(step.localId);
    setInspectorTab('step');
    setShowFullPage(false);
    const page = findPageForProcedureStep(step, pageOptions);
    if (page) setSelectedPageKey(page.key);
  };

  const addCurrentFullPageStep = () => {
    if (!selectedPage || procedureSteps.length >= 300) return;
    const step = createFullPageStepDraft(selectedPage);
    dispatchProcedureSteps({
      type: 'insert',
      step,
      afterLocalId: selectedStep?.localId
    });
    focusProcedureStep(step);
  };

  const addCurrentCropStep = (crop: NonNullable<AssemblyProcedureStepDraft['crop']>) => {
    if (!selectedPage || procedureSteps.length >= 300) return;
    const step = createCropStepDraft(selectedPage, crop);
    dispatchProcedureSteps({
      type: 'insert',
      step,
      afterLocalId: selectedStep?.localId
    });
    setPlacementAction('place');
    focusProcedureStep(step);
  };

  const patchProcedureStep = (
    localId: string,
    patch: Partial<AssemblyProcedureStepDraft>
  ) => {
    const nextSteps = procedureSteps.map((step) =>
      step.localId === localId ? { ...step, ...patch } : step
    );
    const hiddenMarker = findMarkerWithoutVisibleProcedureStep(nextSteps, allStepMarkers);
    if (hiddenMarker) {
      setMessage(
        `丸数字／チェック${hiddenMarker.markerNo}が見える最後の範囲は外せません。`
      );
      return;
    }
    dispatchProcedureSteps({ type: 'update', localId, patch });
    setMessage(null);
  };

  const removeProcedureStep = (localId: string) => {
    const result = canRemoveProcedureStep({
      steps: procedureSteps,
      localId,
      markers: allStepMarkers
    });
    if (!result.allowed) {
      setMessage(result.message);
      return;
    }
    dispatchProcedureSteps({ type: 'remove', localId });
    setMessage(null);
  };

  const saveTemplate = async () => {
    if (readOnly) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!accessPassword) throw new Error('編集パスワードを認証してください。');
      if (procedureItems.length < 1 || procedureItems.length > 50) {
        throw new Error('文書順は1件以上50件以下にしてください。');
      }
      if (procedureSteps.length < 1 || procedureSteps.length > 300) {
        throw new Error('表示ステップは1件以上300件以下にしてください。');
      }
      const hiddenMarker = findMarkerWithoutVisibleProcedureStep(
        procedureSteps,
        allStepMarkers
      );
      if (hiddenMarker) {
        throw new Error(
          `丸数字／チェック${hiddenMarker.markerNo}が見える表示ステップを残してください。`
        );
      }
      const orderedProcedureItems = orderProcedureItemsByFirstStep(
        procedureItems,
        procedureSteps
      );
      if (orderedProcedureItems.length !== procedureItems.length) {
        throw new Error('各文書を表示ステップで1回以上使用してください。');
      }
      const primaryDocumentId = getPrimaryAssemblyDocumentIdFromSteps(procedureSteps);
      if (!primaryDocumentId) throw new Error('主手順書となる組立手順書を選択してください。');
      if (selectedDocument && !selectedDocument.isActive) throw new Error('有効な手順書を選択してください。');
      if (selectedDocument && resolveAssemblyDocumentStatus(selectedDocument) !== 'published') {
        throw new Error('手順書を公開してから保存してください。');
      }
      const payload = {
        name: templateName,
        modelCode,
        procedurePattern,
        procedureDocumentId: primaryDocumentId,
        areas: draftAreasToInput(areas),
        checkItems: draftCheckItemsToInput(checkItems),
        traceabilityMode: 'REQUIRED' as const,
        procedureItems: assemblyTemplateProcedureDraftToInput(orderedProcedureItems),
        procedureSteps: procedureStepDraftToInput(procedureSteps),
        accessPassword
      };
      const saved = templateId ? await reviseAssemblyTemplate(templateId, payload) : await createAssemblyTemplate(payload);
      setBaselineSnapshot(draftSnapshot);
      navigate(kioskAssemblyTemplateEditPath(saved.id), { replace: true });
    } catch (e: unknown) {
      setMessage(
        readAssemblyApiErrorMessage(
          e,
          e instanceof Error ? e.message : 'テンプレートの保存に失敗しました。'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">
        読込中…
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-slate-800 p-3 text-white">
        <section className="rounded border border-white/15 bg-slate-900/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">組立テンプレート編集</h1>
              <p className="mt-1 text-sm font-semibold text-white/65">
                文書順・工程・マーカーを編集する前にパスワードを入力してください。
              </p>
            </div>
            <Link
              to={KIOSK_ASSEMBLY_LIBRARY_PATH}
              className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center')}
            >
              一覧へ
            </Link>
          </div>
          <div className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-2">
            <Input
              value={passwordInput}
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="パスワード"
              className="min-h-12 text-lg"
              disabled={busy}
              onChange={(event) => setPasswordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verifyEditorPassword();
              }}
            />
            <Button
              type="button"
              variant="primary"
              className="min-h-12"
              disabled={!passwordInput || busy}
              onClick={() => void verifyEditorPassword()}
            >
              認証
            </Button>
          </div>
          {message ? (
            <p className="mt-3 rounded border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 px-2 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-[1.12rem] font-bold leading-tight">
            {templateId ? '組立テンプレート編集' : '組立テンプレート新規'}
          </h1>
          {loadedTemplate ? (
            <span className="rounded border border-white/15 bg-slate-950/60 px-2 py-1 text-xs font-bold text-white/70">
              v{loadedTemplate.version} {loadedTemplate.isActive ? '有効' : '旧版'}
            </span>
          ) : null}
          {loadedTemplate?.procedureSequence?.source !== 'template_version' ? (
            <span className="rounded border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-100">
              旧形式を取込
            </span>
          ) : null}
          {readOnly ? (
            <span className="text-xs font-semibold text-amber-200">表示のみ</span>
          ) : isDirty ? (
            <span className="text-xs font-bold text-amber-200">未保存あり</span>
          ) : (
            <span className="text-xs font-semibold text-emerald-200">保存済み</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-10 text-[0.88rem]"
            aria-expanded={procedurePaneOpen}
            aria-controls="assembly-procedure-pane"
            onClick={() =>
              setProcedurePaneOpen((current) => {
                if (!current && typeof window !== 'undefined' && window.innerWidth < 1366) {
                  setLeftPaneTab('documents');
                }
                return !current;
              })
            }
          >
          {procedurePaneOpen ? '文書/工程を閉じる' : `文書/工程 (${procedureItems.length})`}
          </Button>
          <Link
            to={KIOSK_ASSEMBLY_LIBRARY_PATH}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center text-[0.88rem]')}
          >
            一覧へ
          </Link>
          {loadedTemplate ? (
            <Link
              to={kioskAssemblyTemplateNewPath({ sourceTemplateId: loadedTemplate.id })}
              className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center text-[0.88rem]')}
            >
              雛形
            </Link>
          ) : null}
          <Button type="button" variant="primary" className="min-h-10 text-[0.95rem]" disabled={busy || readOnly} onClick={() => void saveTemplate()}>
            {busy ? '保存中…' : templateId ? '新しい版で保存' : '保存'}
          </Button>
        </div>
      </header>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <div
        data-testid="assembly-unified-editor-workspace"
        className={clsx(
          'grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:overflow-hidden',
          procedurePaneOpen && settingsPaneOpen && 'xl:grid-cols-[16rem_minmax(0,1fr)_20rem]',
          procedurePaneOpen && !settingsPaneOpen && 'xl:grid-cols-[16rem_minmax(0,1fr)]',
          !procedurePaneOpen && settingsPaneOpen && 'xl:grid-cols-[minmax(0,1fr)_20rem]',
          !procedurePaneOpen && !settingsPaneOpen && 'xl:grid-cols-1'
        )}
      >
        {procedurePaneOpen ? (
          <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70">
            <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-white/10 p-1">
              <Button
                type="button"
                variant={leftPaneTab === 'steps' ? 'primary' : 'ghostOnDark'}
                className="min-h-10 !px-1 text-xs"
                onClick={() => setLeftPaneTab('steps')}
              >
                手順
              </Button>
              <Button
                type="button"
                variant={leftPaneTab === 'documents' ? 'primary' : 'ghostOnDark'}
                className="min-h-10 !px-1 text-xs"
                onClick={() => setLeftPaneTab('documents')}
              >
                文書・工程
              </Button>
            </div>
            {leftPaneTab === 'steps' ? (
              <AssemblyProcedureStoryboard
                steps={procedureSteps}
                pages={pageOptions}
                selectedLocalId={selectedStep?.localId ?? null}
                readOnly={readOnly}
                onSelect={(localId) => {
                  const step = procedureSteps.find((item) => item.localId === localId);
                  if (step) focusProcedureStep(step);
                }}
                onMove={(localId, delta) =>
                  dispatchProcedureSteps({ type: 'move', localId, delta })
                }
                onMoveTo={(localId, targetIndex) =>
                  dispatchProcedureSteps({ type: 'move_to', localId, targetIndex })
                }
                onDuplicate={(localId) =>
                  dispatchProcedureSteps({ type: 'duplicate', localId })
                }
                onRemove={removeProcedureStep}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <AssemblyTemplateProcedurePane
                  items={procedureItems}
                  selectedPageKey={selectedPageKey}
                  selectedDocumentId={selectedDocumentId}
                  areas={areas}
                  selectedArea={selectedArea}
                  selectedAreaId={selectedAreaId}
                  templateName={templateName}
                  modelCode={modelCode}
                  procedurePattern={procedurePattern}
                  busy={busy}
                  readOnly={readOnly}
                  onOpenDocumentLibrary={() => setDocumentLibraryOpen(true)}
                  onFocusItem={focusProcedureItem}
                  onMoveItem={moveProcedureItem}
                  onRemoveItem={removeProcedureItem}
                  onLabelChange={(localId, label) =>
                    dispatchProcedureItems({ type: 'set_label', localId, label })
                  }
                  onTemplateNameChange={setTemplateName}
                  onModelCodeChange={setModelCode}
                  onProcedurePatternChange={setProcedurePattern}
                  onSelectArea={(areaId) => {
                    setSelectedAreaId(areaId);
                    setSelectedBoltId(null);
                    setSelectedCheckItemId(null);
                  }}
                  onAddArea={addArea}
                  onAreaPatch={setAreaPatch}
                />
              </div>
            )}
          </aside>
        ) : null}

        <section
          data-testid="assembly-unified-editor-canvas-pane"
          className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0"
        >
          <div
            data-testid="assembly-editor-toolbar"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 xl:flex-nowrap xl:whitespace-nowrap"
          >
            <h2 className="shrink-0 text-[1.02rem] font-bold">手順書</h2>
            <select
              aria-label="ページ"
              className="min-h-9 min-w-36 flex-1 rounded border border-white/10 bg-slate-950 px-2 text-sm text-white xl:min-w-0"
              value={selectedPageKey}
              disabled={pageOptions.length === 0}
              onChange={(event) => setSelectedPageKey(event.target.value)}
            >
              {pageOptions.length === 0 ? <option value="">ページがありません</option> : null}
              {pageOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex shrink-0 gap-1" role="group" aria-label="ページ移動">
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 !px-2 !py-1 text-xs"
                disabled={selectedPageIndex <= 0}
                onClick={() => setSelectedPageKey(pageOptions[selectedPageIndex - 1]!.key)}
              >
                前頁
              </Button>
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 !px-2 !py-1 text-xs"
                disabled={
                  selectedPageIndex < 0 || selectedPageIndex >= pageOptions.length - 1
                }
                onClick={() => setSelectedPageKey(pageOptions[selectedPageIndex + 1]!.key)}
              >
                次頁
              </Button>
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label="表示ステップ操作">
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 !px-2 !py-1 text-xs"
                disabled={readOnly || !selectedPage || procedureSteps.length >= 300}
                onClick={addCurrentFullPageStep}
              >
                全体追加
              </Button>
              <Button
                type="button"
                variant={placementAction === 'crop' ? 'primary' : 'ghostOnDark'}
                className="min-h-10 !px-2 !py-1 text-xs"
                disabled={readOnly || !selectedPage || procedureSteps.length >= 300}
                aria-pressed={placementAction === 'crop'}
                onClick={() => {
                  setPlacementAction('crop');
                  setShowFullPage(true);
                }}
              >
                矩形追加
              </Button>
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 !px-2 !py-1 text-xs"
                disabled={readOnly || selectedStep?.viewMode !== 'crop'}
                onClick={() => {
                  if (!selectedStep || !selectedStepPage) return;
                  setSelectedPageKey(selectedStepPage.key);
                  setShowFullPage(true);
                  setInspectorTab('step');
                }}
              >
                範囲修正
              </Button>
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー種別">
              <Button
                type="button"
                aria-label="締結マーカー"
                aria-pressed={markerMode === 'bolt'}
                variant={markerMode === 'bolt' ? 'primary' : 'ghostOnDark'}
                className="min-h-9 !px-2 !py-1 text-xs"
                disabled={readOnly}
                onClick={() => {
                  setMarkerMode('bolt');
                  setSelectedCheckItemId(null);
                }}
              >
                締結
              </Button>
              <Button
                type="button"
                aria-label="チェックマーカー"
                aria-pressed={markerMode === 'check'}
                variant={markerMode === 'check' ? 'primary' : 'ghostOnDark'}
                className="min-h-9 !px-2 !py-1 text-xs"
                disabled={readOnly}
                onClick={() => {
                  setMarkerMode('check');
                  setSelectedBoltId(null);
                }}
              >
                チェック
              </Button>
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー操作">
              <Button
                type="button"
                variant={placementAction === 'place' ? 'primary' : 'ghostOnDark'}
                className="min-h-9 !px-2 !py-1 text-xs"
                disabled={readOnly}
                aria-pressed={placementAction === 'place'}
                onClick={() => setPlacementAction('place')}
              >
                丸数字
              </Button>
              <Button
                type="button"
                variant={placementAction === 'callout' ? 'primary' : 'ghostOnDark'}
                className="min-h-9 !px-2 !py-1 text-xs"
                disabled={readOnly || (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)}
                aria-pressed={placementAction === 'callout'}
                onClick={() => setPlacementAction('callout')}
              >
                矢視
              </Button>
            </div>
            <ImageCanvasZoomControls
              enabled={Boolean(selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath)}
              onZoomIn={canvasZoom.zoomIn}
              onZoomOut={canvasZoom.zoomOut}
              onFitToView={canvasZoom.fitToView}
              controlsClassName="shrink-0 rounded bg-slate-950/70 p-1"
            />
          </div>
          <div className="min-h-0 flex-1">
            {showSelectedCrop && selectedStep?.crop && selectedPage ? (
              <div className="relative h-full w-full bg-slate-950 p-2">
                <AssemblyProcedureCropView
                  pageUrl={selectedPage.imageRelativePath}
                  crop={selectedStep.crop}
                  className="h-full w-full"
                  overlay={
                    <AssemblyMarkerOverlay
                      bolts={cropVisibleBolts}
                      checkItems={cropVisibleCheckItems}
                      selectedBoltId={selectedBoltId}
                      selectedCheckItemId={selectedCheckItemId}
                      onSelectBolt={(id) => {
                        setInspectorTab('markers');
                        setMarkerMode('bolt');
                        setSelectedBoltId(id);
                        setSelectedCheckItemId(null);
                      }}
                      onSelectCheckItem={(id) => {
                        setInspectorTab('markers');
                        setMarkerMode('check');
                        setSelectedCheckItemId(id);
                        setSelectedBoltId(null);
                      }}
                    />
                  }
                />
              </div>
            ) : (
            <AssemblyProcedureCanvas
              imageRelativePath={selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath}
              bolts={visibleBolts}
              checkItems={visibleCheckItems}
              selectedBoltId={selectedBoltId}
              selectedCheckItemId={selectedCheckItemId}
              onSelectBolt={(id) => {
                setInspectorTab('markers');
                setMarkerMode('bolt');
                setSelectedBoltId(id);
                setSelectedCheckItemId(null);
              }}
              onSelectCheckItem={(id) => {
                setInspectorTab('markers');
                setMarkerMode('check');
                setSelectedCheckItemId(id);
                setSelectedBoltId(null);
              }}
              onAddBolt={readOnly || markerMode !== 'bolt' || placementAction !== 'place' ? undefined : addBoltAt}
              onAddCheckItem={readOnly || markerMode !== 'check' || placementAction !== 'place' ? undefined : addCheckItemAt}
              onPlaceCallout={
                readOnly || placementAction !== 'callout' || (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)
                  ? undefined
                  : placeSelectedCalloutAt
              }
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
              zoom={canvasZoom.zoom}
              fitGeneration={canvasZoom.fitGeneration}
              className="h-full"
            />
            )}
          </div>
        </section>

        {settingsPaneOpen ? (
        <section
          data-testid="assembly-editor-settings-pane"
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3"
        >
          <div className="mb-3 grid grid-cols-2 gap-1 border-b border-white/10 pb-2">
            <Button
              type="button"
              variant={inspectorTab === 'step' ? 'primary' : 'ghostOnDark'}
              className="min-h-10 !px-1 text-xs"
              disabled={!selectedStep}
              onClick={() => setInspectorTab('step')}
            >
              手順指示
            </Button>
            <Button
              type="button"
              variant={inspectorTab === 'markers' ? 'primary' : 'ghostOnDark'}
              className="min-h-10 !px-1 text-xs"
              disabled={!markerSettingsOpen}
              onClick={() => setInspectorTab('markers')}
            >
              丸数字／チェック設定
            </Button>
          </div>
          {inspectorTab === 'step' && selectedStep ? (
            <AssemblyProcedureStepInspector
              step={selectedStep}
              page={selectedStepPage}
              readOnly={readOnly || busy}
              showFullPage={showFullPage}
              onShowFullPageChange={setShowFullPage}
              onPatch={(patch) => patchProcedureStep(selectedStep.localId, patch)}
            />
          ) : markerMode === 'bolt' ? (
            <>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[1.02rem] font-bold">締付条件</h2>
                  {selectedBolt ? (
                    <>
                      <div className="mt-0.5 truncate text-sm font-bold">丸数字 {selectedBolt.markerNo}</div>
                      <div className="mt-0.5 truncate text-[0.68rem] text-white/55">
                        ページ: {selectedPage ? pageRefKey(currentPageRef!) : '未設定'}
                      </div>
                    </>
                  ) : null}
                </div>
                {selectedBolt ? (
                  <Button type="button" variant="danger" className="min-h-8 shrink-0 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={deleteSelectedBolt}>
                    削除
                  </Button>
                ) : null}
              </div>
              {selectedBolt ? (
                <div className="mt-2 grid min-w-0 gap-2">
                  <div className="flex min-h-8 min-w-0 items-center gap-1 rounded border border-white/10 bg-slate-950/60 px-1.5 py-1">
                    <span className="shrink-0 text-[0.68rem] font-semibold text-white/70">
                      {imageMarkerHasCalloutTip(selectedBolt) ? '矢視 あり' : '矢視 なし'}
                    </span>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-7 shrink-0 !px-1.5 !py-0.5 text-[0.68rem]"
                      disabled={busy || readOnly || !imageMarkerHasCalloutTip(selectedBolt)}
                      onClick={() => setBoltPatch(selectedBolt.id, clearImageMarkerCalloutTip())}
                    >
                      矢視削除
                    </Button>
                    <ImageMarkerPositionNudge
                      position={selectedBolt}
                      disabled={busy || readOnly}
                      groupLabel="締結マーカーの位置調整"
                      className="min-w-0 flex-1 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
                      onChange={(patch) => setBoltPatch(selectedBolt.id, patch)}
                    />
                  </div>
                  <label className="flex min-h-8 min-w-0 items-center gap-2 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-[0.7rem] font-semibold text-white/80">
                    <input
                      type="checkbox"
                      checked={inheritCondition}
                      disabled={busy || readOnly}
                      onChange={(event) => setInheritCondition(event.target.checked)}
                    />
                    次の丸数字へこの条件を引き継ぐ
                  </label>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1 rounded border border-cyan-300/20 bg-cyan-950/20 p-1.5">
                    <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold text-white/70">
                      反映開始
                      <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" type="number" min={1} value={rangeStart} onChange={(e) => setRangeStart(Number(e.target.value))} />
                    </label>
                    <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold text-white/70">
                      反映終了
                      <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" type="number" min={1} value={rangeEnd} onChange={(e) => setRangeEnd(Number(e.target.value))} />
                    </label>
                    <Button type="button" variant="ghostOnDark" className="min-h-8 whitespace-nowrap !px-2 !py-1 text-[0.68rem]" disabled={busy || readOnly} onClick={applySelectedConditionToRange}>
                      条件反映
                    </Button>
                  </div>
                  <div data-testid="assembly-editor-bolt-fields" className="grid min-w-0 gap-1.5">
                    <div className="grid min-w-0 grid-cols-[minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,1.5fr)] gap-1.5">
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        呼び径
                        <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" value={selectedBolt.nominalDiameter ?? ''} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { nominalDiameter: e.target.value, capabilityGroupId: null })} />
                      </label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        長さ (mm)
                        <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" type="number" min={0} value={selectedBolt.boltLengthMm ?? ''} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { boltLengthMm: Number(e.target.value), capabilityGroupId: null })} />
                      </label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        材質
                        <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" value={selectedBolt.material ?? ''} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { material: e.target.value, capabilityGroupId: null })} />
                      </label>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-1.5">
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        強度区分
                        <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" value={selectedBolt.strengthClass ?? ''} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { strengthClass: e.target.value, capabilityGroupId: null })} />
                      </label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        表示用ボルト仕様
                        <Input className="h-8 min-w-0 !px-2 !py-1 text-sm" value={selectedBolt.boltSpec} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { boltSpec: e.target.value })} />
                      </label>
                    </div>
                    <div className="grid min-w-0 grid-cols-4 gap-1.5">
                      {([
                        ['lowerLimit', '下限'],
                        ['nominalTorque', '規定'],
                        ['upperLimit', '上限']
                      ] as const).map(([key, label]) => (
                        <label key={key} className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                          {label}
                          <Input
                            className="h-8 min-w-0 !px-2 !py-1 text-sm"
                            type="number"
                            value={selectedBolt[key]}
                            disabled={busy || readOnly}
                            onChange={(e) => setBoltPatch(selectedBolt.id, { [key]: Number(e.target.value) })}
                          />
                        </label>
                      ))}
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                        単位
                        <select
                          className="h-8 min-w-0 w-full rounded border border-white/10 bg-slate-950 px-1.5 text-xs text-white"
                          value={selectedBolt.unit}
                          disabled={busy || readOnly}
                          onChange={(e) => setBoltPatch(selectedBolt.id, { unit: e.target.value })}
                        >
                          <option value="N·m">N·m</option>
                          <option value="kgf·cm">kgf·cm</option>
                        </select>
                      </label>
                    </div>
                    <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold text-white/70">
                      適合トルクレンチグループ
                      <select
                        className="h-8 min-w-0 w-full rounded border border-white/10 bg-slate-950 px-2 text-sm text-white"
                        value={selectedBolt.capabilityGroupId ?? ''}
                        disabled={busy || readOnly}
                        onChange={(e) => setBoltPatch(selectedBolt.id, { capabilityGroupId: e.target.value || null })}
                      >
                        <option value="">締結条件を入力して選択</option>
                        {capabilityGroups.map((group) => (
                          <option key={group.id} value={group.id}>{group.name}（{group.models.length}型番）</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
                  手順書上の締結マーカーを選択
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[1.02rem] font-bold">チェック項目</h2>
                  {selectedCheckItem ? <div className="mt-1 truncate text-sm font-bold">チェック {selectedCheckItem.markerNo}</div> : null}
                </div>
                {selectedCheckItem ? (
                  <Button type="button" variant="danger" className="min-h-8 shrink-0 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={deleteSelectedCheckItem}>
                    削除
                  </Button>
                ) : null}
              </div>
              {selectedCheckItem ? (
                <div className="mt-3 grid min-w-0 gap-3">
                  <div className="flex min-h-9 items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/60 px-2">
                    <span className="text-xs font-semibold text-white/70">
                      {imageMarkerHasCalloutTip(selectedCheckItem) ? '矢視 あり' : '矢視 なし'}
                    </span>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-8 !px-2 !py-1 text-xs"
                      disabled={busy || readOnly || !imageMarkerHasCalloutTip(selectedCheckItem)}
                      onClick={() => setCheckItemPatch(selectedCheckItem.id, clearImageMarkerCalloutTip())}
                    >
                      矢視削除
                    </Button>
                  </div>
                  <ImageMarkerPositionNudge
                    position={selectedCheckItem}
                    disabled={busy || readOnly}
                    groupLabel="チェックマーカーの位置調整"
                    className="min-w-0 [&>button]:min-w-0 [&>button]:flex-1"
                    onChange={(patch) => setCheckItemPatch(selectedCheckItem.id, patch)}
                  />
                  <label className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
                    ラベル
                    <Input
                      className="min-w-0"
                      value={selectedCheckItem.label ?? ''}
                      disabled={busy || readOnly}
                      onChange={(e) => setCheckItemPatch(selectedCheckItem.id, { label: e.target.value })}
                    />
                  </label>
                  <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-white/80">
                    <input
                      type="checkbox"
                      checked={selectedCheckItem.required ?? true}
                      disabled={busy || readOnly}
                      onChange={(event) => setCheckItemPatch(selectedCheckItem.id, { required: event.target.checked })}
                    />
                    必須チェック
                  </label>
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
                  手順書上のチェックマーカーを選択
                </div>
              )}
            </>
          )}
        </section>
        ) : null}
      </div>

      <AssemblyTemplateDocumentLibraryDialog
        open={documentLibraryOpen}
        documents={documents}
        procedureItems={procedureItems}
        search={documentSearch}
        readOnly={readOnly}
        onSearchChange={setDocumentSearch}
        onAdd={addProcedureDocument}
        onClose={() => setDocumentLibraryOpen(false)}
      />
    </div>
  );
}
