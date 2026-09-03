import { normalizeFastenerText } from '@raspi-system/shared-types';

import {
  assemblyProcedureStepDocumentKey,
  findMarkerWithoutVisibleProcedureStep,
  getPrimaryAssemblyDocumentIdFromSteps
} from './assemblyProcedureStepDraft';
import { resolveAssemblyBoltSpec } from './assemblyTemplateDraft';

import type { AssemblyProcedureStepDraft } from './assemblyProcedureStepDraft';
import type {
  AssemblyDraftArea,
  AssemblyDraftCheckItem,
  AssemblyEditorPageOption
} from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';
import type { AssemblyProcedureDocumentSummaryDto } from './types';
import type { TorqueWrenchCapabilityGroupApi } from '../../api/domains/torque-wrenches';

export type AssemblyTemplateReadinessStage =
  | 'basic'
  | 'procedure'
  | 'areas'
  | 'review';

export type AssemblyTemplateReadinessTarget = {
  kind: 'basic' | 'document' | 'step' | 'area' | 'bolt';
  id?: string;
  field?: string;
};

export type AssemblyTemplateReadinessIssue = {
  code: string;
  stage: AssemblyTemplateReadinessStage;
  message: string;
  target: AssemblyTemplateReadinessTarget;
  missingFields?: string[];
};

export type AssemblyTemplateReadinessStatus =
  | 'complete'
  | 'incomplete'
  | 'checking';

export type AssemblyTemplateReadiness = {
  isReady: boolean;
  issues: AssemblyTemplateReadinessIssue[];
  stages: Record<AssemblyTemplateReadinessStage, AssemblyTemplateReadinessStatus>;
};

export type AssemblyCapabilityCatalogState =
  | { status: 'loading'; groups: TorqueWrenchCapabilityGroupApi[] }
  | { status: 'ready'; groups: TorqueWrenchCapabilityGroupApi[] }
  | { status: 'error'; groups: TorqueWrenchCapabilityGroupApi[] };

export type AssemblyTemplateReadinessInput = {
  modelCode: string;
  procedurePattern: string;
  templateName: string;
  procedureItems: AssemblyTemplateProcedureDraftItem[];
  procedureSteps: AssemblyProcedureStepDraft[];
  pageOptions: AssemblyEditorPageOption[];
  areas: AssemblyDraftArea[];
  checkItems: AssemblyDraftCheckItem[];
  documents: AssemblyProcedureDocumentSummaryDto[];
  capabilityCatalog: AssemblyCapabilityCatalogState;
};

const documentKey = (reference: {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
}) => assemblyProcedureStepDocumentKey(reference);

export function isAssemblyCapabilityGroupCompatible(
  group: TorqueWrenchCapabilityGroupApi,
  bolt: AssemblyDraftArea['bolts'][number]
): boolean {
  return (
    group.isActive &&
    normalizeFastenerText(group.nominalDiameter) ===
      normalizeFastenerText(bolt.nominalDiameter ?? '') &&
    Number(group.boltLengthMm) === bolt.boltLengthMm &&
    normalizeFastenerText(group.material) === normalizeFastenerText(bolt.material ?? '') &&
    normalizeFastenerText(group.strengthClass) ===
      normalizeFastenerText(bolt.strengthClass ?? '')
  );
}

function pushTextIssue(
  issues: AssemblyTemplateReadinessIssue[],
  input: {
    code: string;
    value: string;
    label: string;
    max: number;
    target: AssemblyTemplateReadinessTarget;
  }
) {
  const trimmed = input.value.trim();
  if (!trimmed) {
    issues.push({
      code: `${input.code}.required`,
      stage: 'basic',
      message: `${input.label}を入力してください。`,
      target: input.target
    });
  } else if (trimmed.length > input.max) {
    issues.push({
      code: `${input.code}.too_long`,
      stage: 'basic',
      message: `${input.label}は${input.max}文字以内にしてください。`,
      target: input.target
    });
  }
}

function isFiniteNumber(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

export function evaluateAssemblyTemplateReadiness(
  input: AssemblyTemplateReadinessInput
): AssemblyTemplateReadiness {
  const issues: AssemblyTemplateReadinessIssue[] = [];

  pushTextIssue(issues, {
    code: 'basic.machine_name',
    value: input.modelCode,
    label: '機種名',
    max: 120,
    target: { kind: 'basic', field: 'modelCode' }
  });
  pushTextIssue(issues, {
    code: 'basic.procedure_pattern',
    value: input.procedurePattern,
    label: '手順パターン',
    max: 120,
    target: { kind: 'basic', field: 'procedurePattern' }
  });
  pushTextIssue(issues, {
    code: 'basic.template_name',
    value: input.templateName,
    label: 'テンプレート名',
    max: 200,
    target: { kind: 'basic', field: 'templateName' }
  });

  if (input.procedureItems.length === 0) {
    issues.push({
      code: 'procedure.documents.required',
      stage: 'procedure',
      message: '公開済みの手順書を1件以上追加してください。',
      target: { kind: 'document' }
    });
  } else if (input.procedureItems.length > 50) {
    issues.push({
      code: 'procedure.documents.too_many',
      stage: 'procedure',
      message: '使用文書は50件以下にしてください。',
      target: { kind: 'document' }
    });
  }

  if (input.procedureSteps.length === 0) {
    issues.push({
      code: 'procedure.steps.required',
      stage: 'procedure',
      message: '表示手順を1件以上追加してください。',
      target: { kind: 'step' }
    });
  } else if (input.procedureSteps.length > 300) {
    issues.push({
      code: 'procedure.steps.too_many',
      stage: 'procedure',
      message: '表示手順は300件以下にしてください。',
      target: { kind: 'step' }
    });
  }

  const usedDocumentKeys = new Set(input.procedureSteps.map(documentKey));
  for (const item of input.procedureItems) {
    const assemblyDocument = item.assemblyProcedureDocumentId
      ? input.documents.find(
          (document) => document.id === item.assemblyProcedureDocumentId
        )
      : null;
    if (
      (item.assemblyProcedureDocumentId &&
        (!assemblyDocument ||
          !assemblyDocument.isActive ||
          assemblyDocument.status !== 'published')) ||
      (item.kioskDocumentId && !item.document.enabled)
    ) {
      issues.push({
        code: 'procedure.document.unavailable',
        stage: 'procedure',
        message: `「${item.label.trim() || item.document.title}」は現在利用できません。`,
        target: { kind: 'document', id: item.localId }
      });
    }
    if (!usedDocumentKeys.has(documentKey(item))) {
      issues.push({
        code: 'procedure.document.unused',
        stage: 'procedure',
        message: `「${item.label.trim() || item.document.title}」を表示手順で1回以上使用してください。`,
        target: { kind: 'document', id: item.localId }
      });
    }
    if (item.label.length > 120) {
      issues.push({
        code: 'procedure.document.label_too_long',
        stage: 'procedure',
        message: '文書の表示ラベルは120文字以内にしてください。',
        target: { kind: 'document', id: item.localId, field: 'label' }
      });
    }
  }

  for (const step of input.procedureSteps) {
    const pageExists = input.pageOptions.some(
      (page) =>
        page.source ===
          (step.kioskDocumentId ? 'kiosk_document' : 'assembly_procedure_document') &&
        page.documentId ===
          (step.kioskDocumentId ?? step.assemblyProcedureDocumentId) &&
        page.pageIndex === step.pageIndex
    );
    if (!pageExists) {
      issues.push({
        code: 'procedure.step.page_missing',
        stage: 'procedure',
        message: '参照できないページを使う表示手順があります。',
        target: { kind: 'step', id: step.localId }
      });
    } else if (step.title.length > 120 || step.instructionText.length > 1000) {
      issues.push({
        code: 'procedure.step.text_too_long',
        stage: 'procedure',
        message: '表示手順のタイトルまたは指示文が長すぎます。',
        target: { kind: 'step', id: step.localId }
      });
    }
  }

  const primaryDocumentId = getPrimaryAssemblyDocumentIdFromSteps(input.procedureSteps);
  if (!primaryDocumentId) {
    issues.push({
      code: 'procedure.primary_document.required',
      stage: 'procedure',
      message: '主手順書となる組立手順書を表示手順へ追加してください。',
      target: { kind: 'step' }
    });
  } else {
    const primary = input.documents.find((document) => document.id === primaryDocumentId);
    if (!primary || !primary.isActive || primary.status !== 'published') {
      issues.push({
        code: 'procedure.primary_document.unavailable',
        stage: 'procedure',
        message: '主手順書は公開済みで有効な文書を指定してください。',
        target: {
          kind: 'document',
          id: input.procedureItems.find(
            (item) => item.assemblyProcedureDocumentId === primaryDocumentId
          )?.localId
        }
      });
    }
  }

  const markers = [
    ...input.areas.flatMap((area) => area.bolts),
    ...input.checkItems
  ].map((marker) =>
    marker.kioskDocumentId || marker.assemblyProcedureDocumentId
      ? marker
      : {
          ...marker,
          kioskDocumentId: null,
          assemblyProcedureDocumentId: primaryDocumentId,
          pageIndex: marker.pageIndex ?? 0
        }
  );
  const hiddenMarker = findMarkerWithoutVisibleProcedureStep(
    input.procedureSteps,
    markers
  );
  if (hiddenMarker) {
    const bolt = input.areas
      .flatMap((area) => area.bolts)
      .find((candidate) => candidate.id === hiddenMarker.id);
    issues.push({
      code: 'procedure.marker.hidden',
      stage: 'procedure',
      message: `丸数字／チェック${hiddenMarker.markerNo}が見える表示手順を残してください。`,
      target: bolt
        ? { kind: 'bolt', id: bolt.id }
        : { kind: 'step' }
    });
  }

  if (input.areas.length === 0) {
    issues.push({
      code: 'areas.required',
      stage: 'areas',
      message: '工程を1件以上追加してください。',
      target: { kind: 'area' }
    });
  }

  for (const [areaIndex, area] of input.areas.entries()) {
    const areaTooLongField =
      area.processNo.trim().length > 80
        ? 'processNo'
        : area.areaCode.trim().length > 80
          ? 'areaCode'
          : area.unitCode.trim().length > 80
            ? 'unitCode'
            : area.areaName.trim().length > 200
              ? 'areaName'
              : undefined;
    if (areaTooLongField) {
      issues.push({
        code: 'area.fields_too_long',
        stage: 'areas',
        message: '工程の入力値が最大文字数を超えています。',
        target: {
          kind: 'area',
          id: area.id,
          field: areaTooLongField
        },
        missingFields: []
      });
    }

    if (area.bolts.length === 0) {
      issues.push({
        code: 'area.bolts.required',
        stage: 'areas',
        message: `${area.areaName.trim() || `工程${areaIndex + 1}`}に締付点を1件以上配置してください。`,
        target: { kind: 'area', id: area.id }
      });
    }

    for (const bolt of area.bolts) {
      const missingBoltFieldEntries = [
        !bolt.nominalDiameter?.trim()
          ? { field: 'nominalDiameter', label: '呼び径' }
          : null,
        !isFiniteNumber(bolt.boltLengthMm) || bolt.boltLengthMm <= 0
          ? { field: 'boltLengthMm', label: '長さ' }
          : null,
        !bolt.material?.trim() ? { field: 'material', label: '材質' } : null,
        !bolt.strengthClass?.trim()
          ? { field: 'strengthClass', label: '強度区分' }
          : null,
        !isFiniteNumber(bolt.lowerLimit)
          ? { field: 'lowerLimit', label: '下限' }
          : null,
        !isFiniteNumber(bolt.nominalTorque)
          ? { field: 'nominalTorque', label: '規定' }
          : null,
        !isFiniteNumber(bolt.upperLimit)
          ? { field: 'upperLimit', label: '上限' }
          : null,
        !bolt.unit.trim() ? { field: 'unit', label: '単位' } : null,
        !bolt.capabilityGroupId
          ? { field: 'capabilityGroupId', label: '適合グループ' }
          : null
      ].filter(
        (value): value is { field: string; label: string } => value != null
      );
      const missingBoltFields = missingBoltFieldEntries.map(
        (entry) => entry.label
      );

      if (missingBoltFields.length > 0) {
        issues.push({
          code: 'bolt.fields_required',
          stage: 'areas',
          message: `丸数字${bolt.markerNo}の${missingBoltFields.join('、')}を入力してください。`,
          target: {
            kind: 'bolt',
            id: bolt.id,
            field: missingBoltFieldEntries[0]?.field
          },
          missingFields: missingBoltFields
        });
        continue;
      }

      const calloutPairIsInvalid =
        (bolt.calloutTipXRatio == null) !== (bolt.calloutTipYRatio == null);
      if (
        !Number.isInteger(bolt.markerNo) ||
        bolt.markerNo < 1 ||
        bolt.markerNo > 999 ||
        !Number.isFinite(bolt.xRatio) ||
        bolt.xRatio < 0 ||
        bolt.xRatio > 1 ||
        !Number.isFinite(bolt.yRatio) ||
        bolt.yRatio < 0 ||
        bolt.yRatio > 1 ||
        calloutPairIsInvalid
      ) {
        issues.push({
          code: 'bolt.marker_invalid',
          stage: 'areas',
          message: `丸数字${bolt.markerNo}の位置情報が不正です。`,
          target: { kind: 'bolt', id: bolt.id }
        });
      }

      if (
        bolt.nominalDiameter!.trim().length > 40 ||
        bolt.material!.trim().length > 80 ||
        bolt.strengthClass!.trim().length > 80 ||
        resolveAssemblyBoltSpec(bolt).length > 200
      ) {
        issues.push({
          code: 'bolt.fields_too_long',
          stage: 'areas',
          message: `丸数字${bolt.markerNo}の締結条件が最大文字数を超えています。`,
          target: { kind: 'bolt', id: bolt.id }
        });
      }

      if (
        bolt.lowerLimit! > bolt.nominalTorque! ||
        bolt.nominalTorque! > bolt.upperLimit!
      ) {
        issues.push({
          code: 'bolt.torque_order_invalid',
          stage: 'areas',
          message: `丸数字${bolt.markerNo}は「下限 ≤ 規定 ≤ 上限」にしてください。`,
          target: { kind: 'bolt', id: bolt.id, field: 'nominalTorque' }
        });
      }

      if (bolt.unit !== 'N·m' && bolt.unit !== 'kgf·cm') {
        issues.push({
          code: 'bolt.unit_invalid',
          stage: 'areas',
          message: `丸数字${bolt.markerNo}の単位を選び直してください。`,
          target: { kind: 'bolt', id: bolt.id, field: 'unit' }
        });
      }

      if (input.capabilityCatalog.status === 'ready') {
        const group = input.capabilityCatalog.groups.find(
          (candidate) => candidate.id === bolt.capabilityGroupId
        );
        if (!group || !isAssemblyCapabilityGroupCompatible(group, bolt)) {
          issues.push({
            code: 'bolt.capability_group_invalid',
            stage: 'areas',
            message: `丸数字${bolt.markerNo}の適合グループが現在の締結条件と一致しません。`,
            target: { kind: 'bolt', id: bolt.id, field: 'capabilityGroupId' }
          });
        }
      }
    }
  }

  const duplicateBoltMarkerNos = new Set<number>();
  const seenBoltMarkerNos = new Set<number>();
  for (const bolt of input.areas.flatMap((area) => area.bolts)) {
    if (seenBoltMarkerNos.has(bolt.markerNo)) {
      duplicateBoltMarkerNos.add(bolt.markerNo);
    }
    seenBoltMarkerNos.add(bolt.markerNo);
  }
  for (const markerNo of duplicateBoltMarkerNos) {
    const bolt = input.areas
      .flatMap((area) => area.bolts)
      .find((candidate) => candidate.markerNo === markerNo);
    issues.push({
      code: 'bolt.marker_duplicate',
      stage: 'areas',
      message: `丸数字${markerNo}がテンプレート内で重複しています。`,
      target: { kind: 'bolt', id: bolt?.id }
    });
  }

  const checkMarkerNos = new Set<number>();
  for (const item of input.checkItems) {
    if (
      !Number.isInteger(item.markerNo) ||
      item.markerNo < 1 ||
      item.markerNo > 999 ||
      !Number.isFinite(item.xRatio) ||
      item.xRatio < 0 ||
      item.xRatio > 1 ||
      !Number.isFinite(item.yRatio) ||
      item.yRatio < 0 ||
      item.yRatio > 1 ||
      (item.calloutTipXRatio == null) !== (item.calloutTipYRatio == null) ||
      (item.label?.trim().length ?? 0) > 200 ||
      checkMarkerNos.has(item.markerNo)
    ) {
      issues.push({
        code: 'procedure.check_item_invalid',
        stage: 'procedure',
        message: `チェック${item.markerNo}の内容または位置情報が不正です。`,
        target: { kind: 'step' }
      });
    }
    checkMarkerNos.add(item.markerNo);
  }

  const hasBolts = input.areas.some((area) => area.bolts.length > 0);
  if (hasBolts && input.capabilityCatalog.status === 'error') {
    issues.push({
      code: 'capability_catalog.unavailable',
      stage: 'areas',
      message: '適合グループを確認できません。再読込してください。',
      target: { kind: 'area' }
    });
  }

  const basicIncomplete = issues.some((issue) => issue.stage === 'basic');
  const procedureIncomplete = issues.some((issue) => issue.stage === 'procedure');
  const areasIncomplete = issues.some((issue) => issue.stage === 'areas');
  const catalogChecking = hasBolts && input.capabilityCatalog.status === 'loading';
  const isReady =
    !basicIncomplete &&
    !procedureIncomplete &&
    !areasIncomplete &&
    !catalogChecking;

  return {
    isReady,
    issues,
    stages: {
      basic: basicIncomplete ? 'incomplete' : 'complete',
      procedure: procedureIncomplete ? 'incomplete' : 'complete',
      areas: areasIncomplete
        ? 'incomplete'
        : catalogChecking
          ? 'checking'
          : 'complete',
      review: catalogChecking ? 'checking' : isReady ? 'complete' : 'incomplete'
    }
  };
}
