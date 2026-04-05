import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateScope
} from '../types';

/** 管理画面テンプレフォームの1行（ページの state と同一形状） */
export type AdminTemplateFormItemRow = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker: string;
  unit: string;
  allowNegative: boolean;
  decimalPlaces: number;
};

export type AdminTemplateFormFields = {
  templateScope: PartMeasurementTemplateScope;
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  candidateFhinmei: string;
  name: string;
  items: AdminTemplateFormItemRow[];
  visualChoice: 'none' | 'pick' | 'upload';
  pickedVisualId: string;
};

export function mapTemplateDtoToAdminFormFields(t: PartMeasurementTemplateDto): AdminTemplateFormFields {
  const processGroup: PartMeasurementProcessGroup = t.processGroup ?? 'cutting';
  let visualChoice: 'none' | 'pick' | 'upload' = 'none';
  let pickedVisualId = '';
  if (t.visualTemplateId) {
    visualChoice = 'pick';
    pickedVisualId = t.visualTemplateId;
  }
  return {
    templateScope: t.templateScope,
    fhincd: t.fhincd,
    resourceCd: t.resourceCd,
    processGroup,
    candidateFhinmei: t.candidateFhinmei ?? '',
    name: t.name,
    items: t.items.map((it, idx) => ({
      sortOrder: idx,
      datumSurface: it.datumSurface,
      measurementPoint: it.measurementPoint,
      measurementLabel: it.measurementLabel,
      displayMarker: it.displayMarker ?? '',
      unit: it.unit ?? '',
      allowNegative: it.allowNegative,
      decimalPlaces: it.decimalPlaces
    })),
    visualChoice,
    pickedVisualId
  };
}

export type ReviseApiItem = {
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
};

/** 登録・改版API共通の items 組み立て（空行除去・sortOrder 振り直し） */
export function buildTemplateItemsPayload(
  items: AdminTemplateFormItemRow[]
): ReviseApiItem[] | { error: string } {
  const trimmedItems = items
    .map((it, idx) => ({
      sortOrder: idx,
      datumSurface: it.datumSurface.trim(),
      measurementPoint: it.measurementPoint.trim(),
      measurementLabel: it.measurementLabel.trim(),
      displayMarker: it.displayMarker.trim() || null,
      unit: it.unit.trim() || null,
      allowNegative: it.allowNegative,
      decimalPlaces: Math.min(6, Math.max(0, Math.floor(it.decimalPlaces)))
    }))
    .filter((it) => it.datumSurface && it.measurementPoint && it.measurementLabel);
  if (trimmedItems.length === 0) {
    return { error: '測定項目を1行以上入力してください。' };
  }
  return trimmedItems.map((it, idx) => ({ ...it, sortOrder: idx }));
}
