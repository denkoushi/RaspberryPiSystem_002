import { useEffect, useMemo, useReducer, useState } from 'react';

import {
  canRemoveProcedureStep,
  createCropStepDraft,
  createFullPageStepDraft,
  findMarkerWithoutVisibleProcedureStep,
  findPageForProcedureStep,
  getPrimaryAssemblyDocumentIdFromSteps,
  isMarkerVisibleInProcedureStep,
  orderProcedureItemsForDisplay,
  templateToProcedureStepDrafts
, assemblyProcedureStepDraftReducer } from '../assemblyProcedureStepDraft';
import {
  appendAssemblyProcedureDocument,
  assemblyTemplateProcedureDraftReducer,
  buildProcedureDraftPageOptions,
  canRemoveAssemblyTemplateProcedureItem,
  getPrimaryAssemblyProcedureDocumentId,
  hasAssemblyProcedureDocument,
  templateToProcedureDraftItems
} from '../assemblyTemplateProcedureDraft';

import { useAssemblyTemplateEditorPageOptions } from './useAssemblyTemplateEditorData';

import type {
  AssemblyProcedureStepDraft,
  AssemblyProcedureStepDraftAction
} from '../assemblyProcedureStepDraft';
import type {
  AssemblyDraftBolt,
  AssemblyDraftCheckItem
} from '../assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from '../assemblyTemplateProcedureDraft';
import type {
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateDto
} from '../types';

type ProcedureDraftInput = {
  documents: AssemblyProcedureDocumentSummaryDto[];
  initialDocumentId?: string | null;
  loadedTemplate: AssemblyTemplateDto | null;
  loading: boolean;
  onMessage: (message: string | null) => void;
  onStepFocused: () => void;
  templateId?: string;
};

export function useAssemblyTemplateProcedureDraft(input: ProcedureDraftInput) {
  const [selectedDocumentId, setSelectedDocumentId] = useState(input.initialDocumentId ?? '');
  const [procedureItems, dispatchProcedureItems] = useReducer(
    assemblyTemplateProcedureDraftReducer,
    []
  );
  const [procedureSteps, dispatchProcedureSteps] = useReducer(
    assemblyProcedureStepDraftReducer,
    []
  );
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState('');
  const [leftPaneTab, setLeftPaneTab] = useState<'steps' | 'documents'>('steps');
  const [procedurePaneOpen, setProcedurePaneOpen] = useState(true);
  const [documentLibraryOpen, setDocumentLibraryOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState('');
  const [showFullPage, setShowFullPage] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const pageOptions = useAssemblyTemplateEditorPageOptions({
    documents: input.documents,
    procedureItems
  });

  useEffect(() => {
    if (input.loading) {
      setInitialized(false);
      return;
    }
    if (input.loadedTemplate) {
      const nextItems = templateToProcedureDraftItems(input.loadedTemplate);
      const nextSteps = templateToProcedureStepDrafts(input.loadedTemplate);
      dispatchProcedureItems({ type: 'replace', items: nextItems });
      dispatchProcedureSteps({ type: 'replace', steps: nextSteps });
      setSelectedStepId(nextSteps[0]?.localId ?? null);
      setProcedurePaneOpen(!input.templateId || nextItems.length > 1);
      setLeftPaneTab(
        !input.templateId
          ? 'documents'
          : typeof window !== 'undefined' && window.innerWidth >= 1366
            ? 'steps'
            : 'documents'
      );
      setInitialized(true);
      return;
    }
    const initialDocument = input.documents.find(
      (document) => document.id === (input.initialDocumentId ?? '')
    );
    dispatchProcedureItems({
      type: 'replace',
      items: initialDocument
        ? [appendAssemblyProcedureDocument([], initialDocument)[0]!]
        : []
    });
    dispatchProcedureSteps({ type: 'replace', steps: [] });
    setSelectedStepId(null);
    setProcedurePaneOpen(true);
    setLeftPaneTab('documents');
    setInitialized(true);
  }, [
    input.documents,
    input.initialDocumentId,
    input.loadedTemplate,
    input.loading,
    input.templateId
  ]);

  useEffect(() => {
    const primaryDocumentId =
      getPrimaryAssemblyDocumentIdFromSteps(procedureSteps) ??
      getPrimaryAssemblyProcedureDocumentId(procedureItems) ??
      '';
    setSelectedDocumentId(primaryDocumentId);
  }, [procedureItems, procedureSteps]);

  useEffect(() => {
    setSelectedPageKey((current) =>
      pageOptions.some((option) => option.key === current)
        ? current
        : (pageOptions[0]?.key ?? '')
    );
  }, [pageOptions]);

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

  const selectedDocument = useMemo(
    () => {
      const loadedProcedureDocument = input.loadedTemplate?.procedureDocument;
      if (loadedProcedureDocument?.id === selectedDocumentId) return loadedProcedureDocument;
      return input.documents.find((document) => document.id === selectedDocumentId) ?? loadedProcedureDocument ?? null;
    },
    [
      input.documents,
      input.loadedTemplate?.procedureDocument,
      selectedDocumentId
    ]
  );
  const selectedPage =
    pageOptions.find((option) => option.key === selectedPageKey) ?? pageOptions[0] ?? null;
  const selectedStep =
    procedureSteps.find((step) => step.localId === selectedStepId) ??
    procedureSteps[0] ??
    null;
  const selectedStepPage = selectedStep
    ? findPageForProcedureStep(selectedStep, pageOptions)
    : null;
  const displayProcedureItems = useMemo(
    () => orderProcedureItemsForDisplay(procedureItems, procedureSteps),
    [procedureItems, procedureSteps]
  );

  const focusStep = (step: AssemblyProcedureStepDraft) => {
    setSelectedStepId(step.localId);
    setShowFullPage(false);
    const page = findPageForProcedureStep(step, pageOptions);
    if (page) setSelectedPageKey(page.key);
    input.onStepFocused();
  };

  const addDocument = (
    document: AssemblyProcedureDocumentSummaryDto,
    mode: 'all_pages' | 'document_only'
  ) => {
    if (hasAssemblyProcedureDocument(procedureItems, document.id)) {
      input.onMessage('同じ組立手順書は新たに重複追加できません。');
      return;
    }
    if (procedureItems.length >= 50) {
      input.onMessage('文書順は50件までです。');
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
    input.onMessage(null);
  };

  const removeDocument = (
    localId: string,
    markers: Array<AssemblyDraftBolt | AssemblyDraftCheckItem>
  ) => {
    const index = procedureItems.findIndex((item) => item.localId === localId);
    const item = procedureItems[index];
    if (
      item &&
      procedureSteps.some(
        (step) =>
          step.kioskDocumentId === item.kioskDocumentId &&
          step.assemblyProcedureDocumentId === item.assemblyProcedureDocumentId
      )
    ) {
      input.onMessage('この文書を使う表示ステップを先に削除してください。');
      return;
    }
    const markerRefs = markers.map((marker) =>
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
      input.onMessage(result.message);
      return;
    }
    dispatchProcedureItems({ type: 'remove', index });
    input.onMessage(null);
  };

  const patchStep = (
    localId: string,
    patch: Partial<AssemblyProcedureStepDraft>,
    markers: Array<AssemblyDraftBolt | AssemblyDraftCheckItem>
  ) => {
    const currentStep = procedureSteps.find((step) => step.localId === localId);
    const nextSteps = procedureSteps.map((step) =>
      step.localId === localId ? { ...step, ...patch } : step
    );
    const hiddenMarker = findMarkerWithoutVisibleProcedureStep(nextSteps, markers);
    if (hiddenMarker) {
      input.onMessage(`丸数字／チェック${hiddenMarker.markerNo}が見える最後の範囲は外せません。`);
      return;
    }
    dispatchProcedureSteps({ type: 'update', localId, patch });
    const nextStep = nextSteps.find((step) => step.localId === localId);
    const removedMarkerCount =
      currentStep && nextStep
        ? markers.filter(
            (marker) =>
              isMarkerVisibleInProcedureStep(marker, currentStep) &&
              !isMarkerVisibleInProcedureStep(marker, nextStep)
          ).length
        : 0;
    input.onMessage(
      removedMarkerCount > 0
        ? `${removedMarkerCount}件の丸数字／チェックがこの矩形手順から見えなくなります。`
        : null
    );
  };

  const removeStep = (
    localId: string,
    markers: Array<AssemblyDraftBolt | AssemblyDraftCheckItem>
  ) => {
    const result = canRemoveProcedureStep({
      steps: procedureSteps,
      localId,
      markers
    });
    if (!result.allowed) {
      input.onMessage(result.message);
      return;
    }
    dispatchProcedureSteps({ type: 'remove', localId });
    input.onMessage(null);
  };

  const dispatchSteps = (action: AssemblyProcedureStepDraftAction) =>
    dispatchProcedureSteps(action);

  return {
    addCurrentCropStep: (crop: NonNullable<AssemblyProcedureStepDraft['crop']>) => {
      if (!selectedPage || procedureSteps.length >= 300) return;
      const step = createCropStepDraft(selectedPage, crop);
      dispatchProcedureSteps({ type: 'insert', step, afterLocalId: selectedStep?.localId });
      focusStep(step);
    },
    addCurrentFullPageStep: () => {
      if (!selectedPage || procedureSteps.length >= 300) return;
      const step = createFullPageStepDraft(selectedPage);
      dispatchProcedureSteps({ type: 'insert', step, afterLocalId: selectedStep?.localId });
      focusStep(step);
    },
    addDocument,
    dispatchProcedureItems,
    dispatchSteps,
    displayProcedureItems,
    documentLibraryOpen,
    documentSearch,
    focusItem: (item: AssemblyTemplateProcedureDraftItem) => {
      const firstPage = pageOptions.find((option) => option.key.startsWith(`${item.localId}:`));
      if (firstPage) setSelectedPageKey(firstPage.key);
    },
    focusStep,
    initialized,
    leftPaneTab,
    pageOptions,
    patchStep,
    procedureItems,
    procedurePaneOpen,
    procedureSteps,
    removeDocument,
    removeStep,
    selectedDocument,
    selectedDocumentId,
    selectedPage,
    selectedPageKey,
    selectedStep,
    selectedStepPage,
    setDocumentLibraryOpen,
    setDocumentSearch,
    setLeftPaneTab,
    setProcedurePaneOpen,
    setSelectedDocumentId,
    setSelectedPageKey,
    setShowFullPage,
    showFullPage
  };
}
