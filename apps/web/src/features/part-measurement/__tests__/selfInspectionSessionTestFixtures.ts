import type {
  PartMeasurementTemplateItemDto,
  SelfInspectionLotEntryDto,
  SelfInspectionSessionDetailDto
} from '../types';

export function makeSelfInspectionTemplateItemForTest(
  overrides: Partial<PartMeasurementTemplateItemDto> & { id: string; sortOrder: number }
): PartMeasurementTemplateItemDto {
  return {
    datumSurface: '',
    measurementPoint: '',
    measurementLabel: '測定',
    displayMarker: String(overrides.sortOrder + 1),
    unit: 'mm',
    allowNegative: false,
    decimalPlaces: 2,
    markerXRatio: '0.5',
    markerYRatio: '0.5',
    nominalValue: '10',
    lowerLimit: '9',
    upperLimit: '11',
    ...overrides
  };
}

export function makeSelfInspectionLotEntryForTest(
  overrides: Partial<SelfInspectionLotEntryDto> & Pick<SelfInspectionLotEntryDto, 'entryIndex'>
): SelfInspectionLotEntryDto {
  const now = '2026-06-04T00:00:00.000Z';
  return {
    id: `entry-${overrides.entryIndex}`,
    entrySlotKind: 'fixed',
    entrySlotLabel: String(overrides.entryIndex + 1),
    persistenceStatus: 'confirmed',
    createdByEmployeeId: null,
    createdByEmployeeNameSnapshot: null,
    measuringInstrumentId: null,
    measuringInstrumentManagementNumberSnapshot: null,
    measuringInstrumentNameSnapshot: null,
    measuringInstrumentTagUidSnapshot: null,
    instrumentUsages: [],
    createdAt: now,
    updatedAt: now,
    values: [],
    ...overrides
  };
}

export type MakeSelfInspectionSessionDetailOptions = {
  id?: string;
  items: PartMeasurementTemplateItemDto[];
  expectedEntryCount?: number;
  selfInspectionMode?: SelfInspectionSessionDetailDto['selfInspectionMode'];
};

/** 自主検査 hook / 純関数テスト用。`SelfInspectionSessionDetailDto` の必須フィールドを満たす。 */
export function makeSelfInspectionSessionDetailForTest(
  options: MakeSelfInspectionSessionDetailOptions
): SelfInspectionSessionDetailDto {
  const expectedEntryCount = options.expectedEntryCount ?? 1;
  const templateId = 'tpl-1';
  const now = '2026-06-04T00:00:00.000Z';

  return {
    id: options.id ?? 'session-1',
    sessionBusinessKey: 'business-key-1',
    templateId,
    templateName: 'テストテンプレ',
    productNo: 'P1',
    fseiban: 'S1',
    fhincd: 'H1',
    fhinmei: '品名',
    processGroup: 'cutting',
    resourceCd: 'R1',
    scheduleRowId: 'schedule-row-1',
    machineName: null,
    plannedQuantity: expectedEntryCount,
    expectedEntryCount,
    requiredEntryCount: expectedEntryCount,
    completedEntryCount: 0,
    pendingReviewCount: 0,
    participantEmployeeNames: [],
    entryCountBlockedReason: null,
    selfInspectionMode: options.selfInspectionMode ?? 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    status: 'in_progress',
    startedAt: now,
    completedAt: null,
    recordApprovalRequiredAt: null,
    recordApprovalWorkflowStartedAt: null,
    decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
    inspectorRemeasurementRequiredAt: null,
    inspectorMeasurementState: 'not_required',
    inspectorRequiredEntryCount: expectedEntryCount,
    inspectorCompletedRequiredEntryCount: 0,
    inspectorMissingRequiredEntryCount: 0,
    inspectorIncompleteValueEntryCount: 0,
    recordApproval: null,
    updatedAt: now,
    template: {
      id: templateId,
      fhincd: 'H1',
      resourceCd: 'R1',
      processGroup: 'cutting',
      templateScope: 'three_key',
      candidateFhinmei: null,
      name: 'tpl',
      version: 1,
      isActive: true,
      selfInspectionMode: options.selfInspectionMode ?? 'full',
      selfInspectionFixedCount: null,
      selfInspectionSampleSize: null,
      visualTemplateId: 'vt-1',
      visualTemplate: null,
      siblingGroupId: null,
      siblingGroup: null,
      items: options.items
    },
    entries: [],
    focusedEntry: null
  };
}
