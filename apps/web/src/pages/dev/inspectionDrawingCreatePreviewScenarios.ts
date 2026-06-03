import type { InspectionDrawingCreateMetadataRowProps } from '../../features/part-measurement/inspection-drawing/InspectionDrawingCreateMetadataRow';
import type { PartMeasurementProcessGroup, SelfInspectionMode } from '../../features/part-measurement/types';

/** 正本 HTML / DEV / E2E で共通の長い資源ラベル */
export const INSPECTION_DRAWING_CREATE_PREVIEW_LONG_RESOURCE_LABEL =
  '033 (三井HS3A(25号機) / 横型)';

export type InspectionDrawingCreatePreviewScenario = 'revise' | 'fixed_count' | 'create_new';

const LONG_RESOURCE_OPTIONS = [
  { value: '033', label: INSPECTION_DRAWING_CREATE_PREVIEW_LONG_RESOURCE_LABEL }
] as const;

export function parseInspectionDrawingCreatePreviewScenario(
  raw: string | null
): InspectionDrawingCreatePreviewScenario {
  if (raw === 'fixed_count' || raw === 'create_new') return raw;
  return 'revise';
}

export type InspectionDrawingCreatePreviewScenarioConfig = {
  lineageLocked: boolean;
  fhincd: string;
  resourceCd: string;
  resourceSelectOptions: ReadonlyArray<{ value: string; label: string }>;
  processGroup: PartMeasurementProcessGroup;
  templateProcessGroup: PartMeasurementProcessGroup;
  templateName: string;
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: string;
  templateVersion: number;
  templateIsActive: boolean;
  showProcessGroupInToolbar: boolean;
};

export function getInspectionDrawingCreatePreviewScenarioConfig(
  scenario: InspectionDrawingCreatePreviewScenario
): InspectionDrawingCreatePreviewScenarioConfig {
  const base = {
    fhincd: 'SD000107240',
    resourceCd: '033',
    resourceSelectOptions: LONG_RESOURCE_OPTIONS,
    processGroup: 'cutting' as PartMeasurementProcessGroup,
    templateProcessGroup: 'cutting' as PartMeasurementProcessGroup,
    templateName: 'test01',
    templateVersion: 2,
    templateIsActive: true
  };

  switch (scenario) {
    case 'fixed_count':
      return {
        ...base,
        lineageLocked: true,
        selfInspectionMode: 'fixed_count',
        selfInspectionFixedCount: '3',
        showProcessGroupInToolbar: false
      };
    case 'create_new':
      return {
        ...base,
        lineageLocked: false,
        selfInspectionMode: 'first_last',
        selfInspectionFixedCount: '',
        showProcessGroupInToolbar: true
      };
    case 'revise':
    default:
      return {
        ...base,
        lineageLocked: true,
        selfInspectionMode: 'single',
        selfInspectionFixedCount: '',
        showProcessGroupInToolbar: false
      };
  }
}

/** MetadataRow props のうち DEV プレビュー固定分 */
export function toPreviewMetadataRowProps(
  config: InspectionDrawingCreatePreviewScenarioConfig
): Pick<
  InspectionDrawingCreateMetadataRowProps,
  | 'lineageLocked'
  | 'fhincd'
  | 'resourceCd'
  | 'resourceSelectOptions'
  | 'processGroup'
  | 'templateProcessGroup'
  | 'templateName'
  | 'selfInspectionMode'
  | 'selfInspectionFixedCount'
  | 'templateVersion'
  | 'templateIsActive'
> {
  return {
    lineageLocked: config.lineageLocked,
    fhincd: config.fhincd,
    resourceCd: config.resourceCd,
    resourceSelectOptions: config.resourceSelectOptions,
    processGroup: config.processGroup,
    templateProcessGroup: config.templateProcessGroup,
    templateName: config.templateName,
    selfInspectionMode: config.selfInspectionMode,
    selfInspectionFixedCount: config.selfInspectionFixedCount,
    templateVersion: config.templateVersion,
    templateIsActive: config.templateIsActive
  };
}
