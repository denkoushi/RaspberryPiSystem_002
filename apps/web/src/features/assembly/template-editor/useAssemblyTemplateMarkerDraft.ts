import { useEffect, useMemo, useState } from 'react';

import {
  clearImageMarkerCalloutTip,
  setImageMarkerCalloutTip
} from '../../kiosk/image-canvas';
import {
  assemblyProcedureViewPointToSourcePoint,
  projectAssemblyProcedureMarkersToCrop
} from '../assemblyProcedureMarkerProjection';
import {
  findPageForProcedureStep,
  isMarkerVisibleInProcedureStep
} from '../assemblyProcedureStepDraft';
import {
  applyAssemblyBoltConditionRange,
  createAssemblyBoltAt,
  createAssemblyCheckItemAt,
  emptyAssemblyArea,
  filterDraftBoltsForPage,
  filterDraftCheckItemsForPage,
  renumberDraftCheckItems,
  templateToDraftAreas,
  templateToDraftCheckItems
} from '../assemblyTemplateDraft';

import type { AssemblyProcedureStepDraft } from '../assemblyProcedureStepDraft';
import type {
  AssemblyDraftArea,
  AssemblyDraftBolt,
  AssemblyDraftCheckItem,
  AssemblyEditorPageOption
} from '../assemblyTemplateDraft';
import type { AssemblyTemplateDto } from '../types';

export type PendingMarkerDelete =
  | { kind: 'bolt'; id: string; markerNo: number; affectedStepCount: number }
  | { kind: 'check'; id: string; markerNo: number; affectedStepCount: number };

export type PendingAreaDelete = {
  id: string;
  label: string;
  boltCount: number;
};

type MarkerDraftInput = {
  loadedTemplate: AssemblyTemplateDto | null;
  loading: boolean;
  onMessage: (message: string | null) => void;
  onOpenInspector: () => void;
  pageOptions: AssemblyEditorPageOption[];
  procedureSteps: AssemblyProcedureStepDraft[];
  readOnly: boolean;
  selectedDocumentId: string;
  selectedPage: AssemblyEditorPageOption | null;
  selectedPageKey: string;
  selectedStep: AssemblyProcedureStepDraft | null;
};

export function useAssemblyTemplateMarkerDraft(input: MarkerDraftInput) {
  const [areas, setAreas] = useState<AssemblyDraftArea[]>(() => [emptyAssemblyArea()]);
  const [checkItems, setCheckItems] = useState<AssemblyDraftCheckItem[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>(null);
  const [selectedCheckItemId, setSelectedCheckItemId] = useState<string | null>(null);
  const [markerMode, setMarkerMode] = useState<'bolt' | 'check'>('bolt');
  const [placementAction, setPlacementAction] =
    useState<'place' | 'callout' | 'crop'>('place');
  const [pendingMarkerDelete, setPendingMarkerDelete] =
    useState<PendingMarkerDelete | null>(null);
  const [pendingAreaDelete, setPendingAreaDelete] = useState<PendingAreaDelete | null>(null);
  const [inheritCondition, setInheritCondition] = useState(true);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(35);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (input.loading) {
      setInitialized(false);
      return;
    }
    if (input.loadedTemplate) {
      const nextAreas = templateToDraftAreas(input.loadedTemplate);
      setAreas(nextAreas.length > 0 ? nextAreas : [emptyAssemblyArea()]);
      setCheckItems(templateToDraftCheckItems(input.loadedTemplate));
      setSelectedAreaId(nextAreas[0]?.id ?? '');
    } else {
      const initialArea = emptyAssemblyArea();
      setAreas([initialArea]);
      setCheckItems([]);
      setSelectedAreaId(initialArea.id);
    }
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
    setInitialized(true);
  }, [input.loadedTemplate, input.loading]);

  useEffect(() => {
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
  }, [input.selectedPageKey]);

  useEffect(() => {
    if (areas.length > 0 && !areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(areas[0]!.id);
      setSelectedBoltId(null);
    }
  }, [areas, selectedAreaId]);

  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0] ?? null;
  const selectedBolt = selectedArea?.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const selectedCheckItem = checkItems.find((item) => item.id === selectedCheckItemId) ?? null;
  const currentPageRef = useMemo(
    () =>
      input.selectedPage
        ? ({
            source: input.selectedPage.source,
            documentId: input.selectedPage.documentId,
            pageIndex: input.selectedPage.pageIndex
          } as const)
        : null,
    [input.selectedPage]
  );
  const visibleBolts = useMemo(
    () =>
      currentPageRef && input.selectedDocumentId
        ? filterDraftBoltsForPage(areas, currentPageRef, input.selectedDocumentId)
        : [],
    [areas, currentPageRef, input.selectedDocumentId]
  );
  const visibleCheckItems = useMemo(
    () =>
      currentPageRef && input.selectedDocumentId
        ? filterDraftCheckItemsForPage(
            checkItems,
            currentPageRef,
            input.selectedDocumentId
          )
        : [],
    [checkItems, currentPageRef, input.selectedDocumentId]
  );
  const allStepMarkers = useMemo(
    () =>
      [...areas.flatMap((area) => area.bolts), ...checkItems].map((marker) =>
        marker.kioskDocumentId || marker.assemblyProcedureDocumentId
          ? marker
          : {
              ...marker,
              kioskDocumentId: null,
              assemblyProcedureDocumentId: input.selectedDocumentId,
              pageIndex: marker.pageIndex ?? 0
            }
      ),
    [areas, checkItems, input.selectedDocumentId]
  );
  const markerProjectionByStepId = useMemo(() => {
    const pageMarkers = new Map(
      input.pageOptions.map((page) => {
        const pageRef = {
          source: page.source,
          documentId: page.documentId,
          pageIndex: page.pageIndex
        } as const;
        return [
          page.key,
          {
            bolts: filterDraftBoltsForPage(areas, pageRef, input.selectedDocumentId),
            checkItems: filterDraftCheckItemsForPage(
              checkItems,
              pageRef,
              input.selectedDocumentId
            )
          }
        ] as const;
      })
    );
    return new Map(
      input.procedureSteps.flatMap((step) => {
        const page = findPageForProcedureStep(step, input.pageOptions);
        const markers = page ? pageMarkers.get(page.key) : null;
        return markers
          ? [
              [
                step.localId,
                {
                  bolts: projectAssemblyProcedureMarkersToCrop(markers.bolts, step.crop),
                  checkItems: projectAssemblyProcedureMarkersToCrop(
                    markers.checkItems,
                    step.crop
                  )
                }
              ] as const
            ]
          : [];
      })
    );
  }, [areas, checkItems, input.pageOptions, input.procedureSteps, input.selectedDocumentId]);

  const countVisibleSteps = (marker: AssemblyDraftBolt | AssemblyDraftCheckItem) => {
    const reference =
      marker.kioskDocumentId || marker.assemblyProcedureDocumentId
        ? marker
        : {
            ...marker,
            assemblyProcedureDocumentId: input.selectedDocumentId,
            pageIndex: marker.pageIndex ?? 0
          };
    return input.procedureSteps.filter((step) =>
      isMarkerVisibleInProcedureStep(reference, step)
    ).length;
  };

  const patchMarker = <T extends AssemblyDraftBolt | AssemblyDraftCheckItem>(
    source: T,
    patch: Partial<T>,
    label: string,
    commit: () => void
  ) => {
    if (patch.xRatio != null || patch.yRatio != null) {
      const nextMarker = { ...source, ...patch };
      const reference =
        nextMarker.kioskDocumentId || nextMarker.assemblyProcedureDocumentId
          ? nextMarker
          : {
              ...nextMarker,
              assemblyProcedureDocumentId: input.selectedDocumentId,
              pageIndex: nextMarker.pageIndex ?? 0
            };
      const beforeCount = countVisibleSteps(source);
      const afterCount = input.procedureSteps.filter((step) =>
        isMarkerVisibleInProcedureStep(reference, step)
      ).length;
      if (afterCount === 0) {
        input.onMessage(`${label}${source.markerNo}が見える表示ステップを1件以上残してください。`);
        return;
      }
      input.onMessage(
        afterCount < beforeCount
          ? `${label}${source.markerNo}が${beforeCount - afterCount}件の矩形手順から見えなくなります。`
          : null
      );
    }
    commit();
  };

  const setBoltPatch = (boltId: string, patch: Partial<AssemblyDraftBolt>) => {
    const source = areas.flatMap((area) => area.bolts).find((bolt) => bolt.id === boltId);
    if (!source) return;
    patchMarker(source, patch, '丸数字', () =>
      setAreas((current) =>
        current.map((area) => ({
          ...area,
          bolts: area.bolts.map((bolt) =>
            bolt.id === boltId ? { ...bolt, ...patch } : bolt
          )
        }))
      )
    );
  };

  const setCheckItemPatch = (id: string, patch: Partial<AssemblyDraftCheckItem>) => {
    const source = checkItems.find((item) => item.id === id);
    if (!source) return;
    patchMarker(source, patch, 'チェック', () =>
      setCheckItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item))
      )
    );
  };

  const addBoltAt = (xRatio: number, yRatio: number) => {
    if (input.readOnly || !selectedArea || !currentPageRef) return;
    const next = createAssemblyBoltAt(selectedArea, xRatio, yRatio, currentPageRef, {
      allAreas: areas,
      inheritFrom: inheritCondition ? selectedBolt : null
    });
    setAreas((current) =>
      current.map((area) =>
        area.id === selectedArea.id ? { ...area, bolts: [...area.bolts, next] } : area
      )
    );
    setSelectedBoltId(next.id);
    setSelectedCheckItemId(null);
    input.onOpenInspector();
  };

  const addCheckItemAt = (xRatio: number, yRatio: number) => {
    if (input.readOnly || !currentPageRef) return;
    const next = createAssemblyCheckItemAt(checkItems, xRatio, yRatio, currentPageRef);
    setCheckItems((current) => renumberDraftCheckItems([...current, next]));
    setSelectedCheckItemId(next.id);
    setSelectedBoltId(null);
    input.onOpenInspector();
  };

  return {
    addArea: () => {
      const next = emptyAssemblyArea(areas.length);
      setAreas((current) => [...current, next]);
      setSelectedAreaId(next.id);
      setSelectedBoltId(null);
      setSelectedCheckItemId(null);
    },
    addBoltAt,
    addCheckItemAt,
    allStepMarkers,
    applySelectedConditionToRange: () => {
      if (!selectedBolt) return;
      const result = applyAssemblyBoltConditionRange(
        areas,
        selectedBolt.id,
        rangeStart,
        rangeEnd
      );
      setAreas(result.areas);
      input.onMessage(`締付条件を${result.updatedCount}件へ反映しました。欠番は${result.missingCount}件です。`);
    },
    areas,
    checkItems,
    clearSelectedCheckItemCallout: () =>
      selectedCheckItem &&
      setCheckItemPatch(selectedCheckItem.id, clearImageMarkerCalloutTip()),
    confirmDeleteArea: () => {
      if (!pendingAreaDelete || areas.length <= 1) return;
      const removedIndex = areas.findIndex((area) => area.id === pendingAreaDelete.id);
      const nextAreas = areas
        .filter((area) => area.id !== pendingAreaDelete.id)
        .map((area, sortOrder) => ({ ...area, sortOrder }));
      setAreas(nextAreas);
      setSelectedAreaId(
        nextAreas[Math.min(Math.max(removedIndex, 0), nextAreas.length - 1)]?.id ?? ''
      );
      setSelectedBoltId(null);
      setSelectedCheckItemId(null);
      setPendingAreaDelete(null);
      input.onMessage(null);
    },
    confirmDeleteMarker: () => {
      if (!pendingMarkerDelete) return;
      if (pendingMarkerDelete.kind === 'bolt') {
        setAreas((current) =>
          current.map((area) => ({
            ...area,
            bolts: area.bolts
              .filter((bolt) => bolt.id !== pendingMarkerDelete.id)
              .map((bolt, sortOrder) => ({ ...bolt, sortOrder }))
          }))
        );
        setSelectedBoltId(null);
      } else {
        setCheckItems((current) =>
          renumberDraftCheckItems(
            current.filter((item) => item.id !== pendingMarkerDelete.id)
          )
        );
        setSelectedCheckItemId(null);
      }
      setPendingMarkerDelete(null);
      input.onMessage(null);
    },
    cropVisibleBolts: projectAssemblyProcedureMarkersToCrop(
      visibleBolts,
      input.selectedStep?.crop ?? null
    ),
    cropVisibleCheckItems: projectAssemblyProcedureMarkersToCrop(
      visibleCheckItems,
      input.selectedStep?.crop ?? null
    ),
    currentPageRef,
    inheritCondition,
    initialized,
    markerMode,
    markerProjectionByStepId,
    moveArea: (areaId: string, delta: -1 | 1) =>
      setAreas((current) => {
        const index = current.findIndex((area) => area.id === areaId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target]!, next[index]!];
        return next.map((area, sortOrder) => ({ ...area, sortOrder }));
      }),
    pendingAreaDelete,
    pendingMarkerDelete,
    placementAction,
    replaceDraft: (nextAreas: AssemblyDraftArea[], nextCheckItems: AssemblyDraftCheckItem[]) => {
      const safeAreas = nextAreas.length > 0 ? nextAreas : [emptyAssemblyArea()];
      setAreas(safeAreas);
      setCheckItems(nextCheckItems);
      setSelectedAreaId(safeAreas[0]?.id ?? '');
      setSelectedBoltId(null);
      setSelectedCheckItemId(null);
    },
    placeOnSelectedCropAt: (xRatio: number, yRatio: number) => {
      if (input.readOnly || !input.selectedStep?.crop) return;
      const point = assemblyProcedureViewPointToSourcePoint(
        { xRatio, yRatio },
        input.selectedStep.crop
      );
      if (placementAction === 'place') {
        markerMode === 'bolt'
          ? addBoltAt(point.xRatio, point.yRatio)
          : addCheckItemAt(point.xRatio, point.yRatio);
      } else if (placementAction === 'callout') {
        const patch = setImageMarkerCalloutTip(point.xRatio, point.yRatio);
        if (markerMode === 'bolt' && selectedBolt) setBoltPatch(selectedBolt.id, patch);
        if (markerMode === 'check' && selectedCheckItem) {
          setCheckItemPatch(selectedCheckItem.id, patch);
        }
      }
    },
    placeSelectedCalloutAt: (xRatio: number, yRatio: number) => {
      const patch = setImageMarkerCalloutTip(xRatio, yRatio);
      if (markerMode === 'bolt' && selectedBolt) setBoltPatch(selectedBolt.id, patch);
      if (markerMode === 'check' && selectedCheckItem) {
        setCheckItemPatch(selectedCheckItem.id, patch);
      }
    },
    rangeEnd,
    rangeStart,
    requestDeleteArea: (areaId: string) => {
      if (areas.length <= 1) return;
      const area = areas.find((candidate) => candidate.id === areaId);
      if (!area) return;
      setPendingAreaDelete({
        id: area.id,
        label:
          area.areaName.trim() ||
          [area.processNo.trim(), area.areaCode.trim()].filter(Boolean).join('-') ||
          `工程${areas.findIndex((candidate) => candidate.id === area.id) + 1}`,
        boltCount: area.bolts.length
      });
    },
    requestDeleteSelectedBolt: () =>
      selectedBolt &&
      setPendingMarkerDelete({
        kind: 'bolt',
        id: selectedBolt.id,
        markerNo: selectedBolt.markerNo,
        affectedStepCount: countVisibleSteps(selectedBolt)
      }),
    requestDeleteSelectedCheckItem: () =>
      selectedCheckItem &&
      setPendingMarkerDelete({
        kind: 'check',
        id: selectedCheckItem.id,
        markerNo: selectedCheckItem.markerNo,
        affectedStepCount: countVisibleSteps(selectedCheckItem)
      }),
    selectedArea,
    selectedAreaId,
    selectedBolt,
    selectedBoltId,
    selectedCheckItem,
    selectedCheckItemId,
    selectArea: (id: string) => {
      setSelectedAreaId(id);
      setSelectedBoltId(null);
      setSelectedCheckItemId(null);
    },
    selectBolt: (id: string) => {
      setMarkerMode('bolt');
      setSelectedBoltId(id);
      setSelectedCheckItemId(null);
      input.onOpenInspector();
    },
    selectCheckItem: (id: string) => {
      setMarkerMode('check');
      setSelectedCheckItemId(id);
      setSelectedBoltId(null);
      input.onOpenInspector();
    },
    setAreaPatch: (areaId: string, patch: Partial<AssemblyDraftArea>) =>
      setAreas((current) =>
        current.map((area) => (area.id === areaId ? { ...area, ...patch } : area))
      ),
    setBoltPatch,
    setCheckItemPatch,
    setInheritCondition,
    setMarkerMode,
    setPendingAreaDelete,
    setPendingMarkerDelete,
    setPlacementAction,
    setRangeEnd,
    setRangeStart,
    setSelectedAreaId,
    setSelectedBoltId,
    setSelectedCheckItemId,
    visibleBolts,
    visibleCheckItems
  };
}
