import { ASSEMBLY_PROCEDURE_STEP_MAX_COUNT } from '@raspi-system/shared-types';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  canRemoveProcedureStep,
  createCropStepDraft,
  createFullPageStepDraft,
  findMarkerWithoutVisibleProcedureStep,
  findPageForProcedureStep,
  getPrimaryAssemblyDocumentIdFromSteps,
  isMarkerVisibleInProcedureStep,
  orderProcedureItemsForDisplay,
  templateToProcedureStepDrafts,
  assemblyProcedureStepDraftReducer
} from '../assemblyProcedureStepDraft';
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

type DocumentAddMode = 'all_pages' | 'document_only';

type PendingDocumentAdd = {
  documentId: string;
  mode: DocumentAddMode;
};

function procedureDocumentKey(source: 'kiosk_document' | 'assembly_procedure_document', documentId: string) {
  return `${source}:${documentId}`;
}

function procedureItemDocumentKey(item: AssemblyTemplateProcedureDraftItem) {
  return item.kioskDocumentId
    ? procedureDocumentKey('kiosk_document', item.kioskDocumentId)
    : procedureDocumentKey('assembly_procedure_document', item.assemblyProcedureDocumentId ?? '');
}

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
  const [leftPaneTab, setLeftPaneTab] = useState<'steps' | 'documents'>(
    input.templateId ? 'steps' : 'documents'
  );
  const [procedurePaneOpen, setProcedurePaneOpen] = useState(true);
  const [documentLibraryOpen, setDocumentLibraryOpen] = useState(false);
  const [documentSearch, setDocumentSearch] = useState('');
  const [showFullPage, setShowFullPage] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [addingDocumentId, setAddingDocumentId] = useState<string | null>(null);
  const [procedureSearchResetToken, setProcedureSearchResetToken] = useState(0);
  const autoHydrateDocumentKeysRef = useRef<Set<string> | null>(null);
  const addingDocumentRef = useRef<string | null>(null);
  const pendingDocumentAddRef = useRef<PendingDocumentAdd | null>(null);
  const pageOptions = useAssemblyTemplateEditorPageOptions({
    documents: input.documents,
    procedureItems
  });

  useEffect(() => {
    if (input.loading) {
      autoHydrateDocumentKeysRef.current = null;
      pendingDocumentAddRef.current = null;
      addingDocumentRef.current = null;
      setAddingDocumentId(null);
      setInitialized(false);
      return;
    }
    if (input.loadedTemplate) {
      const nextItems = templateToProcedureDraftItems(input.loadedTemplate);
      const nextSteps = templateToProcedureStepDrafts(input.loadedTemplate);
      autoHydrateDocumentKeysRef.current =
        nextSteps.length === 0 && nextItems.length > 0
          ? new Set(nextItems.map(procedureItemDocumentKey))
          : null;
      dispatchProcedureItems({ type: 'replace', items: nextItems });
      dispatchProcedureSteps({ type: 'replace', steps: nextSteps });
      setSelectedStepId(nextSteps[0]?.localId ?? null);
      setProcedurePaneOpen(!input.templateId || nextItems.length > 1);
      setLeftPaneTab(
        !input.templateId
          ? 'documents'
          : typeof window !== 'undefined' && window.innerWidth >= 1280
            ? 'steps'
            : 'documents'
      );
      setInitialized(true);
      return;
    }
    const initialDocument = input.documents.find(
      (document) => document.id === (input.initialDocumentId ?? '')
    );
    const initialItem = initialDocument
      ? appendAssemblyProcedureDocument([], initialDocument)[0]!
      : null;
    autoHydrateDocumentKeysRef.current = initialItem
      ? new Set([procedureItemDocumentKey(initialItem)])
      : null;
    dispatchProcedureItems({
      type: 'replace',
      items: initialItem ? [initialItem] : []
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
    const autoHydrateDocumentKeys = autoHydrateDocumentKeysRef.current;
    if (!autoHydrateDocumentKeys || pageOptions.length === 0) return;
    if (procedureSteps.length > 0) {
      autoHydrateDocumentKeysRef.current = null;
      return;
    }
    const initialPages = pageOptions.filter((page) =>
      autoHydrateDocumentKeys.has(procedureDocumentKey(page.source, page.documentId))
    );
    autoHydrateDocumentKeysRef.current = null;
    if (initialPages.length === 0) return;
    const initialSteps = initialPages.map(createFullPageStepDraft);
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
    setLeftPaneTab('steps');
    setShowFullPage(false);
    const page = findPageForProcedureStep(step, pageOptions);
    if (page) setSelectedPageKey(page.key);
    input.onStepFocused();
  };

  const addDocument = (
    document: AssemblyProcedureDocumentSummaryDto,
    mode: DocumentAddMode
  ) => {
    if (input.loading) {
      input.onMessage('文書を読み込み中です。');
      return;
    }
    if (addingDocumentRef.current) {
      input.onMessage('文書追加を処理中です。');
      return;
    }
    if (hasAssemblyProcedureDocument(procedureItems, document.id)) {
      input.onMessage('同じ組立手順書は新たに重複追加できません。');
      return;
    }
    if (procedureItems.length >= 50) {
      input.onMessage('文書順は50件までです。');
      return;
    }
    const draftItem = appendAssemblyProcedureDocument([], document)[0];
    if (!draftItem) {
      input.onMessage('この手順書は追加できません。');
      return;
    }
    const pages = buildProcedureDraftPageOptions({
      items: [draftItem],
      assemblyDocuments: [document],
      kioskPagesByDocumentId: new Map()
    });
    if (pages.length === 0) {
      input.onMessage('ページを読み込めない手順書は追加できません。');
      return;
    }
    if (
      mode === 'all_pages' &&
      procedureSteps.length + pages.length > ASSEMBLY_PROCEDURE_STEP_MAX_COUNT
    ) {
      input.onMessage('全ページ追加後の表示手順が300件を超えるため追加できません。');
      return;
    }
    addingDocumentRef.current = document.id;
    pendingDocumentAddRef.current = { documentId: document.id, mode };
    setAddingDocumentId(document.id);
    dispatchProcedureItems({ type: 'append_assembly_document', document });
    setProcedurePaneOpen(true);
    if (mode === 'all_pages') {
      dispatchProcedureSteps({ type: 'append_pages', pages });
      setLeftPaneTab('steps');
      setProcedureSearchResetToken((current) => current + 1);
    } else {
      setLeftPaneTab('documents');
    }
    setDocumentLibraryOpen(false);
  };

  useEffect(() => {
    const pending = pendingDocumentAddRef.current;
    if (!pending) return;
    const item = procedureItems.find(
      (candidate) => candidate.assemblyProcedureDocumentId === pending.documentId
    );
    if (!item) return;

    if (pending.mode === 'document_only') {
      const firstPage = pageOptions.find(
        (page) =>
          page.source === 'assembly_procedure_document' &&
          page.documentId === pending.documentId
      );
      if (!firstPage) return;
      pendingDocumentAddRef.current = null;
      addingDocumentRef.current = null;
      setAddingDocumentId(null);
      setLeftPaneTab('documents');
      setSelectedPageKey(firstPage.key);
      input.onMessage(
        '文書を追加しました。未使用文書は保存できません。中央の「全体追加」または「矩形追加」で手順化してください。'
      );
      return;
    }

    const firstStep = procedureSteps.find(
      (step) =>
        step.kioskDocumentId == null &&
        step.assemblyProcedureDocumentId === pending.documentId
    );
    const firstStepPage = firstStep
      ? findPageForProcedureStep(firstStep, pageOptions)
      : null;
    if (!firstStep || !firstStepPage) return;
    pendingDocumentAddRef.current = null;
    addingDocumentRef.current = null;
    setAddingDocumentId(null);
    setLeftPaneTab('steps');
    setSelectedStepId(firstStep.localId);
    setShowFullPage(false);
    setSelectedPageKey(firstStepPage.key);
    input.onStepFocused();
    input.onMessage('全ページを手順へ追加しました。追加文書の先頭手順を選択しています。');
  }, [input, pageOptions, procedureItems, procedureSteps]);

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
    autoHydrateDocumentKeysRef.current = null;
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
    autoHydrateDocumentKeysRef.current = null;
    dispatchProcedureSteps({ type: 'remove', localId });
    input.onMessage(null);
  };

  const dispatchProcedureItemsForDraft = (
    action: Parameters<typeof dispatchProcedureItems>[0]
  ) => {
    autoHydrateDocumentKeysRef.current = null;
    dispatchProcedureItems(action);
  };

  const dispatchSteps = (action: AssemblyProcedureStepDraftAction) => {
    autoHydrateDocumentKeysRef.current = null;
    dispatchProcedureSteps(action);
  };

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
    addingDocumentId,
    dispatchProcedureItems: dispatchProcedureItemsForDraft,
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
    procedureSearchResetToken,
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
