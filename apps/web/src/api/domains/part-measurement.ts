import { api, apiBase } from '../http';

import type {
  FindOrOpenPartMeasurementResponse,
  KioskInspectionDrawingTemplateSummaryDto,
  PartMeasurementProcessGroup,
  PartMeasurementSheetDto,
  PartMeasurementSheetWithSession,
  SelfInspectionEntryValuePayload,
  SelfInspectionLotEntryDto,
  SelfInspectionOutOfToleranceReviewsListDto,
  SelfInspectionPaperOcrReviewDto,
  SelfInspectionPaperOcrValueDto,
  SelfInspectionPaperReportDto,
  SelfInspectionPaperReportPageDto,
  SelfInspectionPaperReportPrintDto,
  SelfInspectionRecordApprovalSessionDetailDto,
  SelfInspectionRecordApprovalsListDto,
  SelfInspectionRecordApprovalState,
  SelfInspectionRegistrationPolicyDto,
  SelfInspectionSessionDetailDto,
  SelfInspectionSessionsListDto,
  SelfInspectionSessionSummaryDto,
  SelfInspectionStatus,
  PartMeasurementDrawingOcrCandidateResponseDto,
  PartMeasurementDrawingOcrStatusDto,
  PartMeasurementTemplateCandidateDto,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateSiblingGroupDto,
  PartMeasurementTemplateScope,
  PartMeasurementVisualTemplateDto,
  ResolveTicketResponse,
} from '../../features/part-measurement/types';
import type { InspectionDrawingMeasurementLabelSetting } from '@raspi-system/shared-types';
export async function resolvePartMeasurementTicket(
  body: {
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    scannedFhincd?: string | null;
    scannedBarcodeRaw?: string | null;
    resourceCd?: string | null;
  },
  clientKey?: string
): Promise<ResolveTicketResponse> {
  const { data } = await api.post<ResolveTicketResponse>('/part-measurement/resolve-ticket', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function findOrOpenPartMeasurementSheet(
  body: {
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId?: string | null;
    fseiban?: string | null;
    fhincd?: string | null;
    fhinmei?: string | null;
    machineName?: string | null;
    scannedBarcodeRaw?: string | null;
  },
  clientKey?: string
): Promise<FindOrOpenPartMeasurementResponse> {
  const { data } = await api.post<FindOrOpenPartMeasurementResponse>(
    '/part-measurement/sheets/find-or-open',
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function createPartMeasurementSheet(
  body: {
    productNo: string;
    fseiban: string;
    fhincd: string;
    fhinmei: string;
    machineName?: string | null;
    resourceCdSnapshot?: string | null;
    processGroup: PartMeasurementProcessGroup;
    templateId: string;
    scannedBarcodeRaw?: string | null;
    scheduleRowId?: string;
    allowAlternateResourceTemplate?: boolean;
    sessionId?: string | null;
  },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>('/part-measurement/sheets', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function getPartMeasurementSheet(
  sheetId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.get<PartMeasurementSheetWithSession>(`/part-measurement/sheets/${sheetId}`, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function patchPartMeasurementSheet(
  sheetId: string,
  body: {
    quantity?: number | null;
    employeeTagUid?: string | null;
    clearEmployee?: boolean;
    results?: Array<{ pieceIndex: number; templateItemId: string; value?: string | number | null }>;
  },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.patch<PartMeasurementSheetWithSession>(`/part-measurement/sheets/${sheetId}`, body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function finalizePartMeasurementSheet(
  sheetId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/finalize`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

/** 検査図面実験用UI: 評価用テンプレート由来・数量1の記録表のみ */
export async function patchInspectionDrawingEvaluationSheet(
  sheetId: string,
  body: {
    quantity?: number | null;
    employeeTagUid?: string | null;
    clearEmployee?: boolean;
    results?: Array<{ pieceIndex: number; templateItemId: string; value?: string | number | null }>;
  },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.patch<PartMeasurementSheetWithSession>(
    `/part-measurement/inspection-drawing/evaluation-sheets/${sheetId}`,
    body,
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

export async function finalizeInspectionDrawingEvaluationSheet(
  sheetId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/inspection-drawing/evaluation-sheets/${sheetId}/finalize`,
    {},
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

export async function listPartMeasurementDrafts(
  params: { limit?: number; cursor?: string },
  clientKey?: string
): Promise<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }> {
  const { data } = await api.get<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }>(
    '/part-measurement/sheets/drafts',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function listPartMeasurementFinalized(
  params: {
    limit?: number;
    cursor?: string;
    productNo?: string;
    fseiban?: string;
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    dateFrom?: string;
    dateTo?: string;
    includeCancelled?: boolean;
    includeInvalidated?: boolean;
  },
  clientKey?: string
): Promise<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }> {
  const { data } = await api.get<{ sheets: PartMeasurementSheetDto[]; nextCursor: string | null }>(
    '/part-measurement/sheets/finalized',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function transferPartMeasurementEditLock(
  sheetId: string,
  body: { confirm?: boolean },
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/transfer-edit-lock`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function cancelPartMeasurementSheet(
  sheetId: string,
  reason: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    `/part-measurement/sheets/${sheetId}/cancel`,
    { reason },
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function downloadPartMeasurementSheetCsv(sheetId: string, clientKey: string, filename?: string): Promise<void> {
  const res = await fetch(`${apiBase}/part-measurement/sheets/${sheetId}/export.csv`, {
    headers: { 'x-client-key': clientKey }
  });
  if (!res.ok) {
    throw new Error(`CSV export failed: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `part-measurement-${sheetId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function listPartMeasurementTemplates(
  params?: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto[]> {
  const { data } = await api.get<{ templates: PartMeasurementTemplateDto[] }>('/part-measurement/templates', {
    params,
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.templates;
}

/** 本番 THREE_KEY の有効テンプレ存在確認（items/visual を取得しない） */
export async function existsActivePartMeasurementTemplate(
  params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
  },
  clientKey?: string
): Promise<boolean> {
  const { data } = await api.get<{ exists: boolean }>('/part-measurement/templates/active-exists', {
    params,
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.exists;
}

/** キオスク検査図面一覧（本番図面テンプレのみ・要約。fhincd は部分一致） */
export async function listKioskInspectionDrawingTemplates(
  params: {
    fhincd?: string;
    processGroup?: PartMeasurementProcessGroup;
    resourceCd?: string;
    includeInactive?: boolean;
    visualName?: string;
  },
  clientKey?: string
): Promise<KioskInspectionDrawingTemplateSummaryDto[]> {
  const { data } = await api.get<{ templates: KioskInspectionDrawingTemplateSummaryDto[] }>(
    '/part-measurement/inspection-drawing/templates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.templates;
}

export async function listInspectionDrawingMeasurementLabelSettings(
  clientKey?: string
): Promise<InspectionDrawingMeasurementLabelSetting[]> {
  const { data } = await api.get<{ settings: InspectionDrawingMeasurementLabelSetting[] }>(
    '/part-measurement/inspection-drawing/measurement-label-settings',
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.settings;
}

export async function updateInspectionDrawingMeasurementLabelSettings(
  body: { settings: InspectionDrawingMeasurementLabelSetting[] }
): Promise<InspectionDrawingMeasurementLabelSetting[]> {
  const { data } = await api.patch<{ settings: InspectionDrawingMeasurementLabelSetting[] }>(
    '/part-measurement/inspection-drawing/measurement-label-settings',
    body
  );
  return data.settings;
}

export async function resolveOrCreateSelfInspectionSession(
  body: {
    templateId: string;
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    /** 互換用。指示数はサーバーが日程行の補助データから取得する */
    plannedQuantity?: number;
    scheduleRowId: string;
    fseiban: string;
    fhincd: string;
    fhinmei: string;
    machineName?: string | null;
  },
  clientKey?: string
): Promise<SelfInspectionSessionSummaryDto> {
  const { data } = await api.post<{ session: SelfInspectionSessionSummaryDto }>(
    '/part-measurement/self-inspection/sessions/resolve-or-create',
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.session;
}

export async function listSelfInspectionSessions(
  params?: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    status?: SelfInspectionStatus;
  },
  clientKey?: string
): Promise<SelfInspectionSessionsListDto> {
  const { data } = await api.get<SelfInspectionSessionsListDto>(
    '/part-measurement/self-inspection/sessions',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function listSelfInspectionOutOfToleranceReviews(): Promise<SelfInspectionOutOfToleranceReviewsListDto> {
  const { data } = await api.get<SelfInspectionOutOfToleranceReviewsListDto>(
    '/part-measurement/self-inspection/out-of-tolerance-reviews'
  );
  return data;
}

export async function getSelfInspectionRegistrationPolicy(): Promise<SelfInspectionRegistrationPolicyDto> {
  const { data } = await api.get<{ policy: SelfInspectionRegistrationPolicyDto }>(
    '/part-measurement/self-inspection/registration-policy'
  );
  return data.policy;
}

export async function updateSelfInspectionRegistrationPolicy(payload: {
  requireMeasuringInstrumentTag: boolean;
}): Promise<SelfInspectionRegistrationPolicyDto> {
  const { data } = await api.put<{ policy: SelfInspectionRegistrationPolicyDto }>(
    '/part-measurement/self-inspection/registration-policy',
    payload
  );
  return data.policy;
}

export async function listSelfInspectionRecordApprovals(params?: {
  state?: 'active' | SelfInspectionRecordApprovalState;
  productNo?: string;
  resourceCd?: string;
  processGroup?: PartMeasurementProcessGroup;
}): Promise<SelfInspectionRecordApprovalsListDto> {
  const { data } = await api.get<SelfInspectionRecordApprovalsListDto>(
    '/part-measurement/self-inspection/record-approvals',
    { params }
  );
  return data;
}

export async function getSelfInspectionRecordApprovalSession(
  sessionId: string
): Promise<SelfInspectionRecordApprovalSessionDetailDto> {
  const { data } = await api.get<{ session: SelfInspectionRecordApprovalSessionDetailDto }>(
    `/part-measurement/self-inspection/record-approvals/sessions/${sessionId}`
  );
  return data.session;
}

export type SelfInspectionRecordApprovalApproverResolveResult =
  | {
      kind: 'employee';
      employee: { id: string; employeeCode: string; displayName: string; nfcTagUid: string };
    }
  | { kind: 'unknown' }
  | { kind: 'inactive'; status: string }
  | { kind: 'instrument' }
  | { kind: 'duplicate' };

export async function resolveSelfInspectionRecordApprovalApprover(
  uid: string
): Promise<SelfInspectionRecordApprovalApproverResolveResult> {
  const { data } = await api.post<{ result: SelfInspectionRecordApprovalApproverResolveResult }>(
    '/part-measurement/self-inspection/record-approvals/approver/resolve',
    { uid }
  );
  return data.result;
}

export async function getSelfInspectionSession(
  sessionId: string,
  options?: { entryIndex?: number; clientKey?: string }
): Promise<SelfInspectionSessionDetailDto> {
  const clientKey = options?.clientKey;
  const { data } = await api.get<{ session: SelfInspectionSessionDetailDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}`,
    {
      params:
        options?.entryIndex != null && Number.isFinite(options.entryIndex)
          ? { entryIndex: Math.floor(options.entryIndex) }
          : undefined,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.session;
}

export async function getSelfInspectionInspectorMeasurementSession(
  sessionId: string,
  options?: { entryIndex?: number; clientKey?: string }
): Promise<SelfInspectionSessionDetailDto> {
  const clientKey = options?.clientKey;
  const { data } = await api.get<{ session: SelfInspectionSessionDetailDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/inspector-measurements`,
    {
      params:
        options?.entryIndex != null && Number.isFinite(options.entryIndex)
          ? { entryIndex: Math.floor(options.entryIndex) }
          : undefined,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.session;
}

export type SelfInspectionNfcTagResolveResult =
  | {
      kind: 'employee';
      employee: { id: string; displayName: string; nfcTagUid: string };
    }
  | {
      kind: 'instrument';
      instrument: {
        id: string;
        name: string;
        managementNumber: string;
        tagUid: string;
      };
    }
  | { kind: 'unknown' }
  | { kind: 'duplicate' }
  | { kind: 'instrument_unavailable'; reason: 'retired' };

export async function resolveSelfInspectionNfcTagUid(
  uid: string,
  clientKey?: string
): Promise<SelfInspectionNfcTagResolveResult> {
  const { data } = await api.post<{ result: SelfInspectionNfcTagResolveResult }>(
    '/part-measurement/self-inspection/nfc-tags/resolve',
    { uid },
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.result;
}

export async function createSelfInspectionEntry(
  sessionId: string,
  body: {
    entryIndex: number;
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    values: SelfInspectionEntryValuePayload[];
  },
  clientKey?: string
): Promise<SelfInspectionLotEntryDto> {
  const { data } = await api.post<{ entry: SelfInspectionLotEntryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/entries`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.entry;
}

export async function updateSelfInspectionEntry(
  sessionId: string,
  entryId: string,
  body: {
    ifUnmodifiedSince: string;
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    values: SelfInspectionEntryValuePayload[];
  },
  clientKey?: string
): Promise<SelfInspectionLotEntryDto> {
  const { data } = await api.patch<{ entry: SelfInspectionLotEntryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/entries/${entryId}`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.entry;
}

export async function createSelfInspectionInspectorEntry(
  sessionId: string,
  body: {
    entryIndex: number;
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    values: SelfInspectionEntryValuePayload[];
  },
  clientKey?: string
): Promise<SelfInspectionLotEntryDto> {
  const { data } = await api.post<{ entry: SelfInspectionLotEntryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/inspector-entries`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.entry;
}

export async function updateSelfInspectionInspectorEntry(
  sessionId: string,
  entryId: string,
  body: {
    entryIndex: number;
    ifUnmodifiedSince: string;
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    values: SelfInspectionEntryValuePayload[];
  },
  clientKey?: string
): Promise<SelfInspectionLotEntryDto> {
  const { data } = await api.patch<{ entry: SelfInspectionLotEntryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/inspector-entries/${entryId}`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.entry;
}

export async function recordSelfInspectionInstrumentPreUseInspection(
  sessionId: string,
  entryIndex: number,
  body: {
    instrumentTagUid: string;
    employeeTagUid: string;
  },
  clientKey?: string
): Promise<{
  entry: SelfInspectionLotEntryDto;
  usage: SelfInspectionLotEntryDto['instrumentUsages'][number];
  loan: { id: string; reused: boolean } | null;
  reusedExistingUsage: boolean;
}> {
  const { data } = await api.post<{
    entry: SelfInspectionLotEntryDto;
    usage: SelfInspectionLotEntryDto['instrumentUsages'][number];
    loan: { id: string; reused: boolean } | null;
    reusedExistingUsage: boolean;
  }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/entries/${entryIndex}/instrument-usages/pre-use-inspection`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function recordSelfInspectionInspectorInstrumentPreUseInspection(
  sessionId: string,
  entryIndex: number,
  body: {
    instrumentTagUid: string;
    employeeTagUid: string;
  },
  clientKey?: string
): Promise<{
  entry: SelfInspectionLotEntryDto;
  usage: SelfInspectionLotEntryDto['instrumentUsages'][number];
  loan: { id: string; reused: boolean } | null;
  reusedExistingUsage: boolean;
}> {
  const { data } = await api.post<{
    entry: SelfInspectionLotEntryDto;
    usage: SelfInspectionLotEntryDto['instrumentUsages'][number];
    loan: { id: string; reused: boolean } | null;
    reusedExistingUsage: boolean;
  }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/inspector-entries/${entryIndex}/instrument-usages/pre-use-inspection`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function completeSelfInspectionSession(
  sessionId: string,
  clientKey?: string
): Promise<SelfInspectionSessionSummaryDto> {
  const { data } = await api.post<{ session: SelfInspectionSessionSummaryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/complete`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.session;
}

export async function approveSelfInspectionOutOfToleranceReview(
  sessionId: string,
  body: { comment?: string | null } = {}
): Promise<SelfInspectionSessionSummaryDto> {
  const { data } = await api.post<{ session: SelfInspectionSessionSummaryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/out-of-tolerance-review/approve`,
    body
  );
  return data.session;
}

export async function approveSelfInspectionRecordApproval(
  sessionId: string,
  body: { approverEmployeeTagUid: string; comment?: string | null }
): Promise<SelfInspectionSessionSummaryDto> {
  const { data } = await api.post<{ session: SelfInspectionSessionSummaryDto }>(
    `/part-measurement/self-inspection/sessions/${sessionId}/record-approval/approve`,
    body
  );
  return data.session;
}

export async function verifyKioskSelfInspectionRecordApprovalAccessPassword(payload: { password: string }) {
  const { data } = await api.post<{ success: boolean }>(
    '/kiosk/part-measurement/self-inspection/record-approvals/verify-access-password',
    payload
  );
  return data;
}

export type SelfInspectionResetNewSessionDto = {
  id: string;
  templateId: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string | null;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
};

export type SelfInspectionResetSessionResult = {
  deletedSessionId: string;
  deletedEntryCount: number;
  deletedValueCount: number;
  newSession: SelfInspectionResetNewSessionDto;
};

export async function resetSelfInspectionSession(
  sessionId: string,
  body: {
    confirmDestructiveReset: true;
    confirmCompletedSessionReset: boolean;
    requestId: string;
    reason?: string | null;
  },
  clientKey?: string
): Promise<SelfInspectionResetSessionResult> {
  const { data } = await api.post<SelfInspectionResetSessionResult>(
    `/part-measurement/self-inspection/sessions/${sessionId}/reset`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function issueSelfInspectionPaperReport(
  body: {
    templateId: string;
    productNo: string;
    scheduleRowId: string;
    fseiban: string;
    fhincd: string;
    fhinmei: string;
    resourceCd: string;
    machineName?: string | null;
  },
  clientKey?: string
): Promise<SelfInspectionPaperReportPrintDto> {
  const { data } = await api.post<SelfInspectionPaperReportPrintDto>(
    '/part-measurement/self-inspection/paper-reports/issue',
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function getSelfInspectionPaperReportPrint(
  reportId: string,
  clientKey?: string
): Promise<SelfInspectionPaperReportPrintDto> {
  const { data } = await api.get<SelfInspectionPaperReportPrintDto>(
    `/part-measurement/self-inspection/paper-reports/${reportId}/print`,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export type SelfInspectionPaperReportResolvePageResult =
  | {
      valid: true;
      page: SelfInspectionPaperReportPageDto;
      report: Omit<SelfInspectionPaperReportDto, 'pages'>;
    }
  | {
      valid: false;
      reason: 'invalid_qr' | 'not_found' | 'superseded' | 'imported' | 'cancelled';
      message: string;
    };

export async function resolveSelfInspectionPaperReportPage(
  qrPayload: string,
  clientKey?: string
): Promise<SelfInspectionPaperReportResolvePageResult> {
  const { data } = await api.post<SelfInspectionPaperReportResolvePageResult>(
    '/part-measurement/self-inspection/paper-reports/resolve-page',
    { qrPayload },
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function createSelfInspectionPaperOcrReview(
  body: {
    qrPayload: string;
    candidateValues?: SelfInspectionPaperOcrValueDto[];
    imageStoragePath?: string | null;
  },
  clientKey?: string
): Promise<{
  review: SelfInspectionPaperOcrReviewDto;
  page: SelfInspectionPaperReportPageDto;
  report: Omit<SelfInspectionPaperReportDto, 'pages'>;
}> {
  const { data } = await api.post<{
    review: SelfInspectionPaperOcrReviewDto;
    page: SelfInspectionPaperReportPageDto;
    report: Omit<SelfInspectionPaperReportDto, 'pages'>;
  }>('/part-measurement/self-inspection/paper-reports/ocr-reviews', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function confirmSelfInspectionPaperOcrReview(
  reviewId: string,
  body: {
    values: Array<SelfInspectionPaperOcrValueDto & { overwriteExisting?: boolean }>;
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    confirmedByActorId?: string | null;
    confirmedByActorName?: string | null;
  },
  clientKey?: string
): Promise<{
  review: SelfInspectionPaperOcrReviewDto;
  report: Omit<SelfInspectionPaperReportDto, 'pages'>;
}> {
  const { data } = await api.post<{
    review: SelfInspectionPaperOcrReviewDto;
    report: Omit<SelfInspectionPaperReportDto, 'pages'>;
  }>(`/part-measurement/self-inspection/paper-reports/ocr-reviews/${reviewId}/confirm`, body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

/** キオスク検査図面テンプレ編集用（本番 + 図面・全マーカー必須。履歴版も閲覧可） */
export async function getKioskInspectionDrawingTemplate(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.get<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/inspection-drawing/templates/${templateId}`,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export type InspectionDrawingFhincdCandidateDto = {
  fhincd: string;
  fhinmei: string | null;
};

export async function listInspectionDrawingFhincdCandidates(
  params: { prefix: string; limit?: number },
  clientKey?: string
): Promise<InspectionDrawingFhincdCandidateDto[]> {
  const { data } = await api.get<{ candidates: InspectionDrawingFhincdCandidateDto[] }>(
    '/part-measurement/inspection-drawing/fhincd-candidates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.candidates;
}

export async function changeKioskInspectionDrawingTemplateProcessGroup(
  templateId: string,
  body: { processGroup: PartMeasurementProcessGroup },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/inspection-drawing/templates/${templateId}/change-process-group`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export async function reviseKioskInspectionDrawingTemplate(
  templateId: string,
  body: {
    name: string;
    visualTemplateId?: string | null;
    selfInspectionMode?: 'full' | 'single' | 'first_last' | 'fixed_count' | 'sample';
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
    detachFromSiblingGroup?: boolean;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/inspection-drawing/templates/${templateId}/revise`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export async function createKioskInspectionDrawingTemplateGroup(
  body: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCds: string[];
    name: string;
    displayName?: string | null;
    visualTemplateId: string;
    selfInspectionMode?: 'full' | 'single' | 'first_last' | 'fixed_count' | 'sample';
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<{ group: PartMeasurementTemplateSiblingGroupDto; templates: PartMeasurementTemplateDto[] }> {
  const { data } = await api.post<{
    group: PartMeasurementTemplateSiblingGroupDto;
    templates: PartMeasurementTemplateDto[];
  }>('/part-measurement/inspection-drawing/template-groups', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function reviseKioskInspectionDrawingTemplateGroup(
  siblingGroupId: string,
  body: {
    name: string;
    visualTemplateId?: string | null;
    selfInspectionMode?: 'full' | 'single' | 'first_last' | 'fixed_count' | 'sample';
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<{ group: PartMeasurementTemplateSiblingGroupDto; templates: PartMeasurementTemplateDto[] }> {
  const { data } = await api.post<{
    group: PartMeasurementTemplateSiblingGroupDto;
    templates: PartMeasurementTemplateDto[];
  }>(`/part-measurement/inspection-drawing/template-groups/${siblingGroupId}/revise`, body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function addKioskInspectionDrawingTemplateGroupResources(
  siblingGroupId: string,
  body: {
    resourceCds: string[];
    sourceTemplateId?: string | null;
  },
  clientKey?: string
): Promise<{ group: PartMeasurementTemplateSiblingGroupDto; templates: PartMeasurementTemplateDto[] }> {
  const { data } = await api.post<{
    group: PartMeasurementTemplateSiblingGroupDto;
    templates: PartMeasurementTemplateDto[];
  }>(`/part-measurement/inspection-drawing/template-groups/${siblingGroupId}/resources`, body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function listPartMeasurementTemplateCandidates(
  params: {
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    fhinmei?: string;
    q?: string;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateCandidateDto[]> {
  const { data } = await api.get<{ candidates: PartMeasurementTemplateCandidateDto[] }>(
    '/part-measurement/templates/candidates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.candidates;
}

/** 候補テンプレを日程の FIHNCD+工程+資源CD 用に複製（既存 active があればその ID を返す） */
export async function clonePartMeasurementTemplateForScheduleKey(
  body: {
    sourceTemplateId: string;
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{
    template: PartMeasurementTemplateDto;
    reusedExistingActive: boolean;
    didClone: boolean;
  }>('/part-measurement/templates/clone-for-schedule-key', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.template;
}

export async function listPartMeasurementVisualTemplates(
  params?: {
    includeInactive?: boolean;
    q?: string;
    limit?: number;
    sort?: 'name' | 'recentlyUpdated';
  },
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto[]> {
  const { data } = await api.get<{ visualTemplates: PartMeasurementVisualTemplateDto[] }>(
    '/part-measurement/visual-templates',
    {
      params,
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.visualTemplates;
}

export async function getPartMeasurementVisualTemplate(
  visualTemplateId: string,
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto | null> {
  try {
    const { data } = await api.get<{ visualTemplate: PartMeasurementVisualTemplateDto }>(
      `/part-measurement/visual-templates/${visualTemplateId}`,
      {
        headers: clientKey ? { 'x-client-key': clientKey } : undefined
      }
    );
    return data.visualTemplate;
  } catch (e: unknown) {
    const err = e as { response?: { status?: number } };
    if (err.response?.status === 404) return null;
    throw e;
  }
}

export async function getPartMeasurementVisualTemplateOcrStatus(
  visualTemplateId: string,
  clientKey?: string
): Promise<PartMeasurementDrawingOcrStatusDto> {
  const { data } = await api.get<{ ocr: PartMeasurementDrawingOcrStatusDto }>(
    `/part-measurement/visual-templates/${visualTemplateId}/ocr`,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.ocr;
}

export async function listPartMeasurementDrawingOcrCandidates(
  visualTemplateId: string,
  body: {
    xRatio: number;
    yRatio: number;
    markerNo?: number | null;
    limit?: number;
  },
  clientKey?: string
): Promise<PartMeasurementDrawingOcrCandidateResponseDto> {
  const { data } = await api.post<PartMeasurementDrawingOcrCandidateResponseDto>(
    `/part-measurement/visual-templates/${visualTemplateId}/ocr/candidates`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

export async function retryPartMeasurementVisualTemplateOcr(
  visualTemplateId: string,
  clientKey?: string
): Promise<PartMeasurementDrawingOcrStatusDto> {
  const { data } = await api.post<{ ocr: PartMeasurementDrawingOcrStatusDto }>(
    `/part-measurement/visual-templates/${visualTemplateId}/ocr/retry`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.ocr;
}

export type PartMeasurementVisualTemplateCreateResult = {
  visualTemplate: PartMeasurementVisualTemplateDto;
  /** 作成直後の未参照回収に必要（他図面の削除には使えない） */
  cleanupToken: string;
};

export async function updatePartMeasurementVisualTemplateName(
  visualTemplateId: string,
  name: string,
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto> {
  const { data } = await api.patch<{ visualTemplate: PartMeasurementVisualTemplateDto }>(
    `/part-measurement/visual-templates/${visualTemplateId}`,
    { name: name.trim() },
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.visualTemplate;
}

export async function createPartMeasurementVisualTemplate(
  name: string,
  file: File,
  clientKey?: string
): Promise<PartMeasurementVisualTemplateCreateResult> {
  const form = new FormData();
  form.append('name', name.trim() || '図面テンプレート');
  form.append('file', file);
  const { data } = await api.post<PartMeasurementVisualTemplateCreateResult>(
    '/part-measurement/visual-templates',
    form,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

/** 未参照の visual template と図面ファイルを回収する（テンプレ作成失敗時など） */
export async function deleteUnusedPartMeasurementVisualTemplate(
  visualTemplateId: string,
  cleanupToken: string,
  clientKey?: string
): Promise<void> {
  await api.delete(`/part-measurement/visual-templates/${visualTemplateId}`, {
    headers: {
      'X-Visual-Cleanup-Token': cleanupToken,
      ...(clientKey ? { 'x-client-key': clientKey } : {})
    },
    validateStatus: (status) => status === 204 || status === 404 || status === 409
  });
}

/** 図面プレビュー（PDF→JPEG 変換含む）。storage / DB 書き込みなし。 */
export async function previewPartMeasurementDrawing(
  file: File,
  clientKey?: string,
  signal?: AbortSignal
): Promise<Blob> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<Blob>('/part-measurement/drawings/preview', form, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
    responseType: 'blob',
    signal
  });
  return data;
}

export async function createPartMeasurementTemplate(
  body: {
    templateScope?: PartMeasurementTemplateScope;
    fhincd: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    name: string;
    visualTemplateId?: string | null;
    candidateFhinmei?: string | null;
    selfInspectionMode?: 'full' | 'single' | 'first_last' | 'fixed_count' | 'sample';
    selfInspectionFixedCount?: number | null;
    /** @deprecated API 互換。fixed_count 時は fixedCount を優先 */
    selfInspectionSampleSize?: number | null;
    /** true のとき同一キーに active があると API が 409 */
    failIfActiveExists?: boolean;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>('/part-measurement/templates', body, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.template;
}

/** 検査図面 MVP: 評価用テンプレ（図面＋テンプレを一括保存。本番 active テンプレを差し替えない） */
export async function createInspectionDrawingEvaluationTemplate(
  body: {
    referenceFhincd: string;
    referenceResourceCd: string;
    referenceProcessGroup: PartMeasurementProcessGroup;
    name: string;
    file: File;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<{ template: PartMeasurementTemplateDto; sheet: PartMeasurementSheetDto }> {
  const form = new FormData();
  form.append('referenceFhincd', body.referenceFhincd.trim());
  form.append('referenceResourceCd', body.referenceResourceCd.trim());
  form.append('referenceProcessGroup', body.referenceProcessGroup);
  form.append('name', body.name.trim());
  form.append('items', JSON.stringify(body.items));
  form.append('file', body.file);
  const { data } = await api.post<{
    template: PartMeasurementTemplateDto;
    sheet: PartMeasurementSheetDto;
  }>('/part-measurement/inspection-drawing/evaluation-templates', form, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return { template: data.template, sheet: data.sheet };
}

/** 評価用テンプレのみ既にある場合の記録表作成（通常は evaluation-templates が sheet も返す） */
export async function createInspectionDrawingEvaluationSheet(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementSheetWithSession> {
  const { data } = await api.post<PartMeasurementSheetWithSession>(
    '/part-measurement/inspection-drawing/evaluation-sheets',
    { templateId },
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

/** 有効テンプレの系譜固定で次版を作成（FHINMEI_ONLY のとき候補キーも変更可） */
export async function revisePartMeasurementTemplate(
  templateId: string,
  body: {
    name: string;
    visualTemplateId?: string | null;
    candidateFhinmei?: string | null;
    selfInspectionMode?: 'full' | 'single' | 'first_last' | 'fixed_count' | 'sample';
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
    items: Array<{
      sortOrder: number;
      datumSurface: string;
      measurementPoint: string;
      measurementLabel: string;
      displayMarker?: string | null;
      unit?: string | null;
      allowNegative?: boolean;
      decimalPlaces?: number;
      markerXRatio?: number | null;
      markerYRatio?: number | null;
      nominalValue?: number | null;
      lowerLimit?: number | null;
      upperLimit?: number | null;
    }>;
  },
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/revise`,
    body,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

/** 最新の有効版のみ論理削除（isActive を false。旧版は自動で有効化しない） */
export async function retirePartMeasurementTemplate(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/retire`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}

export async function activatePartMeasurementTemplate(
  templateId: string,
  clientKey?: string
): Promise<PartMeasurementTemplateDto> {
  const { data } = await api.post<{ template: PartMeasurementTemplateDto }>(
    `/part-measurement/templates/${templateId}/activate`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data.template;
}
