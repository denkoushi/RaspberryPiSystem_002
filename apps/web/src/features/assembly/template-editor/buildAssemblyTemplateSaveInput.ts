import {
  findMarkerWithoutVisibleProcedureStep,
  getPrimaryAssemblyDocumentIdFromSteps,
  orderProcedureItemsByFirstStep,
  procedureStepDraftToInput,
  type AssemblyProcedureSourceMarker,
  type AssemblyProcedureStepDraft
} from '../assemblyProcedureStepDraft';
import {
  draftCheckItemsToInput,
  resolveAssemblyDocumentStatus,
  serializeAssemblyTemplateDraftAreas
} from '../assemblyTemplateDraft';
import { assemblyTemplateProcedureDraftToInput } from '../assemblyTemplateProcedureDraft';
import { evaluateAssemblyTemplateReadiness } from '../assemblyTemplateReadiness';

import type { TorqueWrenchCapabilityGroupApi } from '../../../api/domains/torque-wrenches';
import type {
  AssemblyDraftArea,
  AssemblyDraftCheckItem,
  AssemblyEditorPageOption
} from '../assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from '../assemblyTemplateProcedureDraft';
import type { AssemblyTemplateReadinessIssue } from '../assemblyTemplateReadiness';
import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblyTemplateCreateInput
} from '../types';

export type AssemblyTemplateSaveInput = {
  accessPassword: string | null;
  areas: AssemblyDraftArea[];
  capabilityCatalog: {
    status: 'loading' | 'ready' | 'error';
    groups: TorqueWrenchCapabilityGroupApi[];
  };
  checkItems: AssemblyDraftCheckItem[];
  documents: AssemblyProcedureDocumentSummaryDto[];
  machineNameSelectionRequired: boolean;
  markers: AssemblyProcedureSourceMarker[];
  modelCode: string;
  pageOptions: AssemblyEditorPageOption[];
  procedureItems: AssemblyTemplateProcedureDraftItem[];
  procedurePattern: string;
  procedureSteps: AssemblyProcedureStepDraft[];
  selectedDocument:
    | AssemblyProcedureDocumentDto
    | AssemblyProcedureDocumentSummaryDto
    | null;
  templateName: string;
};

export type AssemblyTemplateSaveBuildResult =
  | { ok: true; payload: AssemblyTemplateCreateInput }
  | {
      ok: false;
      message: string;
      readinessIssue?: AssemblyTemplateReadinessIssue;
    };

export function buildAssemblyTemplateSaveInput(
  input: AssemblyTemplateSaveInput
): AssemblyTemplateSaveBuildResult {
  const readiness = evaluateAssemblyTemplateReadiness({
    modelCode: input.modelCode,
    procedurePattern: input.procedurePattern,
    templateName: input.templateName,
    procedureItems: input.procedureItems,
    procedureSteps: input.procedureSteps,
    pageOptions: input.pageOptions,
    areas: input.areas,
    checkItems: input.checkItems,
    documents: input.documents,
    capabilityCatalog: input.capabilityCatalog
  });
  if (!readiness.isReady) {
    return {
      ok: false,
      message: '未完了項目を入力してから保存してください。',
      readinessIssue: readiness.issues[0]
    };
  }
  if (!input.accessPassword) {
    return { ok: false, message: '編集パスワードを認証してください。' };
  }
  if (input.machineNameSelectionRequired && !input.modelCode.trim()) {
    return { ok: false, message: '機種名を選択してください。' };
  }
  if (input.procedureItems.length < 1 || input.procedureItems.length > 50) {
    return { ok: false, message: '文書順は1件以上50件以下にしてください。' };
  }
  if (input.procedureSteps.length < 1 || input.procedureSteps.length > 300) {
    return { ok: false, message: '表示ステップは1件以上300件以下にしてください。' };
  }
  const hiddenMarker = findMarkerWithoutVisibleProcedureStep(
    input.procedureSteps,
    input.markers
  );
  if (hiddenMarker) {
    return {
      ok: false,
      message: `丸数字／チェック${hiddenMarker.markerNo}が見える表示ステップを残してください。`
    };
  }
  const orderedProcedureItems = orderProcedureItemsByFirstStep(
    input.procedureItems,
    input.procedureSteps
  );
  if (orderedProcedureItems.length !== input.procedureItems.length) {
    return { ok: false, message: '各文書を表示ステップで1回以上使用してください。' };
  }
  const primaryDocumentId = getPrimaryAssemblyDocumentIdFromSteps(input.procedureSteps);
  if (!primaryDocumentId) {
    return { ok: false, message: '主手順書となる組立手順書を選択してください。' };
  }
  if (input.selectedDocument && !input.selectedDocument.isActive) {
    return { ok: false, message: '有効な手順書を選択してください。' };
  }
  if (
    input.selectedDocument &&
    resolveAssemblyDocumentStatus(input.selectedDocument) !== 'published'
  ) {
    return { ok: false, message: '手順書を公開してから保存してください。' };
  }
  return {
    ok: true,
    payload: {
      name: input.templateName,
      modelCode: input.modelCode,
      procedurePattern: input.procedurePattern,
      procedureDocumentId: primaryDocumentId,
      areas: serializeAssemblyTemplateDraftAreas(input.areas),
      checkItems: draftCheckItemsToInput(input.checkItems),
      traceabilityMode: 'REQUIRED',
      procedureItems: assemblyTemplateProcedureDraftToInput(orderedProcedureItems),
      procedureSteps: procedureStepDraftToInput(input.procedureSteps),
      accessPassword: input.accessPassword
    }
  };
}
