import { useEffect, useMemo, useState } from 'react';

import {
  createAssemblyTemplate,
  reviseAssemblyTemplate,
  verifyAssemblyTemplateAccessPassword
} from '../../../api/client';
import { useImageCanvasZoom } from '../../kiosk/image-canvas';
import { useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';
import { procedureStepDraftToInput } from '../assemblyProcedureStepDraft';
import { draftCheckItemsToInput } from '../assemblyTemplateDraft';
import { buildAssemblyTemplateSuggestedName } from '../assemblyTemplateInputAssistance';
import { assemblyTemplateProcedureDraftToInput } from '../assemblyTemplateProcedureDraft';
import { evaluateAssemblyTemplateReadiness } from '../assemblyTemplateReadiness';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';


import { buildAssemblyTemplateSaveInput } from './buildAssemblyTemplateSaveInput';
import { useAssemblyTemplateEditorData } from './useAssemblyTemplateEditorData';
import { useAssemblyTemplateEditorRecovery } from './useAssemblyTemplateEditorRecovery';
import { useAssemblyTemplateMarkerDraft } from './useAssemblyTemplateMarkerDraft';
import { useAssemblyTemplateProcedureDraft } from './useAssemblyTemplateProcedureDraft';

import type { AssemblyProcedureStepDraft } from '../assemblyProcedureStepDraft';
import type { AssemblyTemplateEditorRecoveryDraft } from '../assemblyTemplateEditorRecovery';
import type {
  AssemblyTemplateReadinessIssue,
  AssemblyTemplateReadinessStage
} from '../assemblyTemplateReadiness';
import type { AssemblyTemplateDto } from '../types';

type EditorQuery = {
  procedureDocumentId?: string | null;
  sourceTemplateId?: string | null;
};

export function useAssemblyTemplateEditorController(input: {
  onSaved: (template: AssemblyTemplateDto) => void;
  query: EditorQuery;
  templateId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateNameMode, setTemplateNameMode] = useState<'auto' | 'manual'>('auto');
  const [modelCode, setModelCode] = useState('');
  const [procedurePattern, setProcedurePattern] = useState('');
  const [metadataInitialized, setMetadataInitialized] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<'closed' | 'step' | 'markers'>('closed');
  const [machineNamePickerOpen, setMachineNamePickerOpen] = useState(false);
  const [expandedAreaDetails, setExpandedAreaDetails] = useState<Set<string>>(() => new Set());
  const data = useAssemblyTemplateEditorData({
    sourceTemplateId: input.query.sourceTemplateId,
    templateId: input.templateId
  });
  const readOnly = Boolean(
    input.templateId && data.loadedTemplate && !data.loadedTemplate.isActive
  );
  const procedure = useAssemblyTemplateProcedureDraft({
    documents: data.documents,
    initialDocumentId: input.query.procedureDocumentId,
    loadedTemplate: data.loadedTemplate,
    loading: data.loading,
    onMessage: setMessage,
    onStepFocused: () => setInspectorMode('step'),
    templateId: input.templateId
  });
  const marker = useAssemblyTemplateMarkerDraft({
    loadedTemplate: data.loadedTemplate,
    loading: data.loading,
    onMessage: setMessage,
    onOpenInspector: () => setInspectorMode('markers'),
    pageOptions: procedure.pageOptions,
    procedureSteps: procedure.procedureSteps,
    readOnly,
    selectedDocumentId: procedure.selectedDocumentId,
    selectedPage: procedure.selectedPage,
    selectedPageKey: procedure.selectedPageKey,
    selectedStep: procedure.selectedStep
  });
  const canvasZoom = useImageCanvasZoom();
  const fitCanvasToView = canvasZoom.fitToView;

  useEffect(() => {
    if (data.loading) {
      setMessage(null);
      setBaselineSnapshot(null);
      setAccessPassword(null);
      setPasswordInput('');
      setInspectorMode('closed');
      setMetadataInitialized(false);
      setExpandedAreaDetails(new Set());
      return;
    }
    if (data.loadedTemplate) {
      if (input.templateId) {
        setTemplateName(data.loadedTemplate.name);
        setTemplateNameMode('manual');
        setModelCode(data.loadedTemplate.modelCode);
        setProcedurePattern(data.loadedTemplate.procedurePattern);
      } else {
        setTemplateName(`${data.loadedTemplate.name} 複製`);
        setTemplateNameMode('manual');
        setModelCode('');
        setProcedurePattern(data.loadedTemplate.procedurePattern);
      }
    } else {
      setTemplateName('');
      setTemplateNameMode('auto');
      setModelCode('');
      setProcedurePattern('');
    }
    setMetadataInitialized(true);
  }, [data.loadedTemplate, data.loading, input.templateId]);

  useEffect(() => {
    if (data.loadError) {
      setMessage(
        readAssemblyApiErrorMessage(
          data.loadError,
          'テンプレート編集データの取得に失敗しました。'
        )
      );
    }
  }, [data.loadError]);

  useEffect(() => {
    fitCanvasToView();
  }, [fitCanvasToView, procedure.selectedPageKey]);

  const draftSnapshot = useMemo(
    () =>
      JSON.stringify({
        templateName,
        modelCode,
        procedurePattern,
        procedureItems: assemblyTemplateProcedureDraftToInput(procedure.procedureItems),
        procedureSteps: procedureStepDraftToInput(procedure.procedureSteps),
        areas: marker.areas,
        checkItems: draftCheckItemsToInput(marker.checkItems)
      }),
    [
      marker.areas,
      marker.checkItems,
      modelCode,
      procedure.procedureItems,
      procedure.procedureSteps,
      procedurePattern,
      templateName
    ]
  );
  const initialized = metadataInitialized && procedure.initialized && marker.initialized;
  useEffect(() => {
    if (initialized && baselineSnapshot == null) setBaselineSnapshot(draftSnapshot);
  }, [baselineSnapshot, draftSnapshot, initialized]);

  const isDirty = baselineSnapshot != null && baselineSnapshot !== draftSnapshot;
  useUnsavedChangesGuard(isDirty && !busy && !readOnly);

  const recoveryDraft = useMemo<AssemblyTemplateEditorRecoveryDraft>(
    () => ({
      templateName,
      modelCode,
      procedurePattern,
      procedureItems: procedure.procedureItems,
      procedureSteps: procedure.procedureSteps,
      areas: marker.areas,
      checkItems: marker.checkItems
    }),
    [
      marker.areas,
      marker.checkItems,
      modelCode,
      procedure.procedureItems,
      procedure.procedureSteps,
      procedurePattern,
      templateName
    ]
  );
  const accessGranted = readOnly || accessPassword != null;
  const recovery = useAssemblyTemplateEditorRecovery({
    accessGranted,
    initialized,
    readOnly,
    isDirty,
    mode: input.templateId ? 'revise' : 'new',
    templateId: input.templateId,
    isActive: data.loadedTemplate?.isActive ?? true,
    sourceTemplateId: input.query.sourceTemplateId,
    procedureDocumentId: input.query.procedureDocumentId,
    baseUpdatedAt: data.loadedTemplate?.updatedAt ?? null,
    draft: recoveryDraft,
    restoreDraft: (draft) => {
      setTemplateName(draft.templateName);
      setTemplateNameMode('manual');
      setModelCode(draft.modelCode);
      setProcedurePattern(draft.procedurePattern);
      procedure.dispatchProcedureItems({ type: 'replace', items: draft.procedureItems });
      procedure.dispatchSteps({ type: 'replace', steps: draft.procedureSteps });
      marker.replaceDraft(draft.areas, draft.checkItems);
      setMessage('途中内容を復元しました。内容を確認して保存してください。');
    },
    onStorageError: () =>
      setMessage('途中復元を保存できませんでした。この画面の編集は続行できます。')
  });

  const markerSettingsOpen = Boolean(marker.selectedBolt || marker.selectedCheckItem);
  useEffect(() => {
    if (inspectorMode === 'markers' && !markerSettingsOpen) {
      setInspectorMode('closed');
    }
  }, [inspectorMode, markerSettingsOpen]);

  const capabilityCatalog = data.capabilityCatalog;
  const readiness = useMemo(
    () =>
      evaluateAssemblyTemplateReadiness({
        modelCode,
        procedurePattern,
        templateName,
        procedureItems: procedure.procedureItems,
        procedureSteps: procedure.procedureSteps,
        pageOptions: procedure.pageOptions,
        areas: marker.areas,
        checkItems: marker.checkItems,
        documents: data.documents,
        capabilityCatalog
      }),
    [
      capabilityCatalog,
      data.documents,
      marker.areas,
      marker.checkItems,
      modelCode,
      procedure.pageOptions,
      procedure.procedureItems,
      procedure.procedureSteps,
      procedurePattern,
      templateName
    ]
  );
  const incompleteAreaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of readiness.issues) {
      if (issue.target.kind === 'area' && issue.target.id) ids.add(issue.target.id);
      if (issue.target.kind === 'bolt' && issue.target.id) {
        const area = marker.areas.find((candidate) =>
          candidate.bolts.some((bolt) => bolt.id === issue.target.id)
        );
        if (area) ids.add(area.id);
      }
    }
    return ids;
  }, [marker.areas, readiness.issues]);

  const focusElementById = (id: string) => {
    window.setTimeout(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      if (element instanceof HTMLElement) element.focus();
    }, 0);
  };

  const focusProcedureStep = (step: AssemblyProcedureStepDraft) => {
    procedure.focusStep(step);
    setInspectorMode('step');
  };

  const focusReadinessIssue = (issue: AssemblyTemplateReadinessIssue) => {
    if (issue.target.kind === 'basic') {
      procedure.setProcedurePaneOpen(true);
      procedure.setLeftPaneTab('documents');
      const idByField: Record<string, string> = {
        modelCode: 'assembly-template-model-code',
        procedurePattern: 'assembly-template-procedure-pattern',
        templateName: 'assembly-template-name'
      };
      focusElementById(idByField[issue.target.field ?? ''] ?? 'assembly-template-basic-settings');
      return;
    }
    if (issue.target.kind === 'document') {
      procedure.setProcedurePaneOpen(true);
      procedure.setLeftPaneTab('documents');
      const item = procedure.procedureItems.find(
        (candidate) => candidate.localId === issue.target.id
      );
      if (item) procedure.focusItem(item);
      if (issue.target.id) focusElementById(`assembly-document-${issue.target.id}`);
      return;
    }
    if (issue.target.kind === 'step') {
      procedure.setProcedurePaneOpen(true);
      procedure.setLeftPaneTab('steps');
      const step = procedure.procedureSteps.find(
        (candidate) => candidate.localId === issue.target.id
      );
      if (step) focusProcedureStep(step);
      return;
    }
    if (issue.target.kind === 'area') {
      procedure.setProcedurePaneOpen(true);
      procedure.setLeftPaneTab('documents');
      if (issue.target.id) {
        marker.selectArea(issue.target.id);
        const areaId = issue.target.id;
        setExpandedAreaDetails((current) => new Set(current).add(areaId));
        focusElementById(
          issue.target.field
            ? `assembly-area-${issue.target.id}-${issue.target.field}`
            : `assembly-area-${issue.target.id}`
        );
      }
      return;
    }
    if (issue.target.kind !== 'bolt' || !issue.target.id) return;
    const area = marker.areas.find((candidate) =>
      candidate.bolts.some((bolt) => bolt.id === issue.target.id)
    );
    const bolt = area?.bolts.find((candidate) => candidate.id === issue.target.id);
    if (!area || !bolt) return;
    marker.setSelectedAreaId(area.id);
    marker.selectBolt(bolt.id);
    const page = procedure.pageOptions.find(
      (candidate) =>
        candidate.source ===
          (bolt.kioskDocumentId ? 'kiosk_document' : 'assembly_procedure_document') &&
        candidate.documentId ===
          (bolt.kioskDocumentId ?? bolt.assemblyProcedureDocumentId ?? procedure.selectedDocumentId) &&
        candidate.pageIndex === (bolt.pageIndex ?? 0)
    );
    if (page) procedure.setSelectedPageKey(page.key);
    const conditionFields = new Set([
      'nominalDiameter',
      'boltLengthMm',
      'material',
      'strengthClass',
      'capabilityGroupId'
    ]);
    const targetField = conditionFields.has(issue.target.field ?? '')
      ? 'capabilityGroupId'
      : issue.target.field;
    focusElementById(
      targetField
        ? `assembly-bolt-${bolt.id}-${targetField}`
        : `assembly-bolt-${bolt.id}-capabilityGroupId`
    );
  };

  const handleGuideStageClick = (stage: AssemblyTemplateReadinessStage) => {
    if (stage === 'review') return;
    const issue = readiness.issues.find((candidate) => candidate.stage === stage);
    if (issue) return focusReadinessIssue(issue);
    if (stage === 'basic' || stage === 'areas') {
      procedure.setProcedurePaneOpen(true);
      procedure.setLeftPaneTab('documents');
      focusElementById(
        stage === 'basic'
          ? 'assembly-template-basic-settings'
          : marker.selectedArea
            ? `assembly-area-${marker.selectedArea.id}`
            : 'assembly-procedure-pane'
      );
      return;
    }
    procedure.setProcedurePaneOpen(true);
    procedure.setLeftPaneTab('steps');
  };

  const verifyEditorPassword = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await verifyAssemblyTemplateAccessPassword({ password: passwordInput });
      if (!result.success) return setMessage('パスワードが違います。');
      setAccessPassword(passwordInput);
      setPasswordInput('');
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '認証に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (readOnly) return;
    const result = buildAssemblyTemplateSaveInput({
      accessPassword,
      areas: marker.areas,
      capabilityCatalog,
      checkItems: marker.checkItems,
      documents: data.documents,
      machineNameSelectionRequired: !input.templateId,
      markers: marker.allStepMarkers,
      modelCode,
      pageOptions: procedure.pageOptions,
      procedureItems: procedure.procedureItems,
      procedurePattern,
      procedureSteps: procedure.procedureSteps,
      selectedDocument: procedure.selectedDocument,
      templateName
    });
    if (!result.ok) {
      setMessage(result.message);
      if (result.readinessIssue) focusReadinessIssue(result.readinessIssue);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = input.templateId
        ? await reviseAssemblyTemplate(input.templateId, result.payload)
        : await createAssemblyTemplate(result.payload);
      setBaselineSnapshot(draftSnapshot);
      recovery.clear();
      input.onSaved(saved);
    } catch (error: unknown) {
      setMessage(
        readAssemblyApiErrorMessage(
          error,
          error instanceof Error ? error.message : 'テンプレートの保存に失敗しました。'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  return {
    ...data,
    ...procedure,
    ...marker,
    accessGranted,
    addCurrentCropStep: (crop: NonNullable<AssemblyProcedureStepDraft['crop']>) => {
      marker.setPlacementAction('place');
      procedure.addCurrentCropStep(crop);
    },
    busy,
    canvasZoom,
    capabilityCatalogStatus: data.capabilityCatalog.status,
    capabilityGroups: data.capabilityCatalog.groups,
    changeModelCode: (value: string) => {
      setModelCode(value);
      if (templateNameMode === 'auto') {
        setTemplateName(buildAssemblyTemplateSuggestedName(value, procedurePattern));
      }
    },
    changeProcedurePattern: (value: string) => {
      setProcedurePattern(value);
      if (templateNameMode === 'auto') {
        setTemplateName(buildAssemblyTemplateSuggestedName(modelCode, value));
      }
    },
    changeTemplateName: (value: string) => {
      setTemplateNameMode('manual');
      setTemplateName(value);
    },
    focusProcedureStep,
    focusReadinessIssue,
    expandedAreaDetails,
    toggleAreaDetails: (areaId: string) => {
      setExpandedAreaDetails((current) => {
        const next = new Set(current);
        if (next.has(areaId)) next.delete(areaId);
        else next.add(areaId);
        return next;
      });
    },
    handleGuideStageClick,
    incompleteAreaIds,
    inspectorMode,
    isDirty,
    machineNamePickerOpen,
    machineNameSelectionRequired: !input.templateId,
    markerSettingsOpen,
    message,
    modelCode,
    passwordInput,
    patchProcedureStep: (localId: string, patch: Partial<AssemblyProcedureStepDraft>) =>
      procedure.patchStep(localId, patch, marker.allStepMarkers),
    procedurePattern,
    readOnly,
    readiness,
    recoveryPending: recovery.pending,
    restoreRecovery: recovery.restore,
    discardRecovery: recovery.discard,
    reloadCapabilityCatalog: data.reloadCapabilityCatalog,
    removeProcedureItem: (localId: string) =>
      procedure.removeDocument(localId, marker.allStepMarkers),
    removeProcedureStep: (localId: string) =>
      procedure.removeStep(localId, marker.allStepMarkers),
    restoreSuggestedTemplateName: () => {
      setTemplateNameMode('auto');
      setTemplateName(buildAssemblyTemplateSuggestedName(modelCode, procedurePattern));
    },
    saveTemplate,
    selectedPageIndex: procedure.selectedPage
      ? procedure.pageOptions.findIndex((option) => option.key === procedure.selectedPage?.key)
      : -1,
    setInspectorMode,
    setMachineNamePickerOpen,
    setMessage,
    setPasswordInput,
    settingsPaneOpen: inspectorMode !== 'closed',
    showSelectedCrop:
      procedure.selectedStep?.viewMode === 'crop' &&
      procedure.selectedStep.crop != null &&
      procedure.selectedStepPage?.key === procedure.selectedPage?.key &&
      !procedure.showFullPage &&
      marker.placementAction !== 'crop',
    templateId: input.templateId,
    templateName,
    templateNameAutomatic: templateNameMode === 'auto',
    verifyEditorPassword
  };
}

export type AssemblyTemplateEditorController = ReturnType<
  typeof useAssemblyTemplateEditorController
>;
