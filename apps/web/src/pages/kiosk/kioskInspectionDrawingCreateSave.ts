import {
  createKioskInspectionDrawingTemplateGroup,
  createPartMeasurementTemplate,
  createPartMeasurementVisualTemplate,
  deleteUnusedPartMeasurementVisualTemplate,
  reviseKioskInspectionDrawingTemplate,
  reviseKioskInspectionDrawingTemplateGroup
} from '../../api/client';
import {
  drawingPointToTemplateItemInput,
  kioskInspectionDrawingTemplateEditPath
} from '../../features/part-measurement/inspection-drawing';
import {
  resolveInspectionDrawingPointSaveError,
  sortInspectionDrawingPointsByMarkerNo
} from '../../features/part-measurement/inspection-drawing/markerNumbering';
import { buildSelfInspectionTemplateApiBody } from '../../features/part-measurement/selfInspectionTemplateForm';

import type { parseKioskInspectionDrawingReturnFromLocation } from './kioskInspectionDrawingReturnNavigation';
import type { getResolvedClientKey } from '../../api/client';
import type { resolveInspectionDrawingCreateKeyCollisionForResources } from '../../features/part-measurement/inspection-drawing';
import type { InspectionDrawingVisualSource } from '../../features/part-measurement/inspection-drawing/inspectionDrawingCreateDraft';
import type { InspectionDrawingPoint } from '../../features/part-measurement/inspection-drawing/types';
import type { useInspectionDrawingPlacementProposals } from '../../features/part-measurement/inspection-drawing/useInspectionDrawingPlacementProposals';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  SelfInspectionMode
} from '../../features/part-measurement/types';
import type { usePartMeasurementDrawingLocalPreview } from '../../features/part-measurement/usePartMeasurementDrawingLocalPreview';
import type { InspectionDrawingMeasurementLabelSetting } from '@raspi-system/shared-types';
import type { Dispatch, SetStateAction } from 'react';
import type { useNavigate } from 'react-router-dom';

export type InspectionDrawingCreateSaveContext = {
  contentReadOnly: boolean;
  setMessage: Dispatch<SetStateAction<string | null>>;
  keyCollision: ReturnType<typeof resolveInspectionDrawingCreateKeyCollisionForResources>;
  keyCollisionMessage: string | null;
  saveBlockedByPreview: boolean;
  hasUnsavedChanges: boolean;
  fhincd: string;
  selectedResourceCds: string[];
  effectiveTemplateName: string;
  points: InspectionDrawingPoint[];
  measurementLabelSettings: InspectionDrawingMeasurementLabelSetting[];
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: string;
  isEditing: boolean;
  visualSource: InspectionDrawingVisualSource;
  saveFile: ReturnType<typeof usePartMeasurementDrawingLocalPreview>['saveFile'];
  selectedVisualTemplateId: string | null;
  previewError: ReturnType<typeof usePartMeasurementDrawingLocalPreview>['previewError'];
  hasLocalRenderablePreview: boolean;
  template: PartMeasurementTemplateDto | null;
  setBusy: Dispatch<SetStateAction<boolean>>;
  clientKey: ReturnType<typeof getResolvedClientKey>;
  templateId: string | undefined;
  groupSaveMode: 'group' | 'single';
  placement: ReturnType<typeof useInspectionDrawingPlacementProposals>;
  applyLoadedTemplate: (t: PartMeasurementTemplateDto) => void;
  navigate: ReturnType<typeof useNavigate>;
  inspectionReturn: ReturnType<typeof parseKioskInspectionDrawingReturnFromLocation>;
  processGroup: PartMeasurementProcessGroup;
  fkojun: string;
};

export async function runInspectionDrawingCreateSave(ctx: InspectionDrawingCreateSaveContext): Promise<void> {
  const {
    contentReadOnly,
    setMessage,
    keyCollision,
    keyCollisionMessage,
    saveBlockedByPreview,
    hasUnsavedChanges,
    fhincd,
    selectedResourceCds,
    effectiveTemplateName,
    points,
    measurementLabelSettings,
    selfInspectionMode,
    selfInspectionFixedCount,
    isEditing,
    visualSource,
    saveFile,
    selectedVisualTemplateId,
    previewError,
    hasLocalRenderablePreview,
    template,
    setBusy,
    clientKey,
    templateId,
    groupSaveMode,
    placement,
    applyLoadedTemplate,
    navigate,
    inspectionReturn,
    processGroup,
    fkojun
  } = ctx;
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
    const pointError = resolveInspectionDrawingPointSaveError(pt, { measurementLabelSettings });
    if (pointError) {
      setMessage(`「${pt.name}」: ${pointError}`);
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

    const items = sortInspectionDrawingPointsByMarkerNo(points).map((pt, idx) =>
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
      placement.flushApprovals(points);
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
          fkojun: fkojun.trim(),
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
      placement.flushApprovals(points);
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
          fkojun: fkojun.trim(),
          name,
          visualTemplateId,
          selfInspectionMode: selfInspectionPayload.selfInspectionMode,
          selfInspectionFixedCount: selfInspectionPayload.selfInspectionFixedCount,
          failIfActiveExists: true,
          items
        },
        clientKey
      );
      placement.flushApprovals(points);
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
}
