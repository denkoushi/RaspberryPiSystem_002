// @vitest-environment node
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type * as SelfInspectionApi from '../../../../api/src/routes/part-measurement/self-inspection';
import type * as Api from '../../../../api/src/routes/part-measurement/shared';
import type * as SheetsApi from '../../../../api/src/routes/part-measurement/sheets';
import type * as VisualApi from '../../../../api/src/routes/part-measurement/visual-templates';
import type { patchInspectionDrawingEvaluationSheetBodySchema } from '../../../../api/src/services/part-measurement/part-measurement-evaluation-sheet.contract';
import type * as Drawing from '../../features/part-measurement/inspection-drawing/types';
import type * as Web from '../../features/part-measurement/types';
import type * as Client from '../domains/part-measurement';
import type { z } from 'zod';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type ApiInputs = {
  placementQuery: z.input<typeof VisualApi.drawingPlacementProposalsQuerySchema>;
  placementDecisions: z.input<typeof VisualApi.drawingPlacementDecisionsBodySchema>;
  listDraftSheetsQuerySchema: z.input<typeof SheetsApi.listDraftSheetsQuerySchema>;
  listFinalizedSheetsQuerySchema: z.input<typeof SheetsApi.listFinalizedSheetsQuerySchema>;
  createEvaluationSheetBodySchema: z.input<typeof SheetsApi.createEvaluationSheetBodySchema>;
  transferSheetEditLockBodySchema: z.input<typeof SheetsApi.transferSheetEditLockBodySchema>;
  cancelSheetBodySchema: z.input<typeof SheetsApi.cancelSheetBodySchema>;
  resolveSelfInspectionNfcTagBodySchema: z.input<typeof SelfInspectionApi.resolveSelfInspectionNfcTagBodySchema>;
  listVisualTemplatesQuerySchema: z.input<typeof VisualApi.listVisualTemplatesQuerySchema>;
  updateVisualTemplateNameBodySchema: z.input<typeof VisualApi.updateVisualTemplateNameBodySchema>;
  getSelfInspectionSessionQuerySchema: z.input<typeof Api.getSelfInspectionSessionQuerySchema>;

  evaluationCreate: z.input<typeof Api.createInspectionDrawingEvaluationTemplateBodySchema>;
  activeTemplateExistsQuerySchema: z.input<typeof Api.activeTemplateExistsQuerySchema>;
  addInspectionDrawingTemplateGroupResourcesBodySchema: z.input<typeof Api.addInspectionDrawingTemplateGroupResourcesBodySchema>;
  approveSelfInspectionOutOfToleranceReviewBodySchema: z.input<typeof Api.approveSelfInspectionOutOfToleranceReviewBodySchema>;
  approveSelfInspectionRecordApprovalBodySchema: z.input<typeof Api.approveSelfInspectionRecordApprovalBodySchema>;
  changeInspectionDrawingTemplateProcessGroupBodySchema: z.input<typeof Api.changeInspectionDrawingTemplateProcessGroupBodySchema>;
  cloneTemplateForScheduleBodySchema: z.input<typeof Api.cloneTemplateForScheduleBodySchema>;
  confirmSelfInspectionPaperOcrReviewBodySchema: z.input<typeof Api.confirmSelfInspectionPaperOcrReviewBodySchema>;
  createInspectionDrawingTemplateGroupBodySchema: z.input<typeof Api.createInspectionDrawingTemplateGroupBodySchema>;
  createSelfInspectionPaperOcrReviewBodySchema: z.input<typeof Api.createSelfInspectionPaperOcrReviewBodySchema>;
  createSheetBodySchema: z.input<typeof Api.createSheetBodySchema>;
  createTemplateBodySchema: z.input<typeof Api.createTemplateBodySchema>;
  drawingOcrCandidateBodySchema: z.input<typeof Api.drawingOcrCandidateBodySchema>;
  findOrOpenSheetBodySchema: z.input<typeof Api.findOrOpenSheetBodySchema>;
  inspectionDrawingFhincdCandidatesQuerySchema: z.input<typeof Api.inspectionDrawingFhincdCandidatesQuerySchema>;
  inspectionDrawingToleranceKindSchema: z.input<typeof Api.inspectionDrawingToleranceKindSchema>;
  invalidateSelfInspectionItemBodySchema: z.input<typeof Api.invalidateSelfInspectionItemBodySchema>;
  issueSelfInspectionPaperReportBodySchema: z.input<typeof Api.issueSelfInspectionPaperReportBodySchema>;
  kioskInspectionDrawingTemplatesQuerySchema: z.input<typeof Api.kioskInspectionDrawingTemplatesQuerySchema>;
  listSelfInspectionInvalidationsQuerySchema: z.input<typeof Api.listSelfInspectionInvalidationsQuerySchema>;
  listSelfInspectionRecordApprovalsQuerySchema: z.input<typeof Api.listSelfInspectionRecordApprovalsQuerySchema>;
  listSelfInspectionSessionsQuerySchema: z.input<typeof Api.listSelfInspectionSessionsQuerySchema>;
  listTemplateCandidatesQuerySchema: z.input<typeof Api.listTemplateCandidatesQuerySchema>;
  listTemplatesQuerySchema: z.input<typeof Api.listTemplatesQuerySchema>;
  patchSheetBodySchema: z.input<typeof Api.patchSheetBodySchema>;
  processGroupSchema: z.input<typeof Api.processGroupSchema>;
  resolveSelfInspectionRecordApprovalApproverBodySchema: z.input<typeof Api.resolveSelfInspectionRecordApprovalApproverBodySchema>;
  resolveTicketBodySchema: z.input<typeof Api.resolveTicketBodySchema>;
  reviseTemplateBodySchema: z.input<typeof Api.reviseTemplateBodySchema>;
  selfInspectionCreateEntryBodySchema: z.input<typeof Api.selfInspectionCreateEntryBodySchema>;
  selfInspectionCreateInspectorEntryBodySchema: z.input<typeof Api.selfInspectionCreateInspectorEntryBodySchema>;
  selfInspectionInspectorJudgementsBodySchema: z.input<typeof Api.selfInspectionInspectorJudgementsBodySchema>;
  selfInspectionInstrumentPreUseInspectionBodySchema: z.input<typeof Api.selfInspectionInstrumentPreUseInspectionBodySchema>;
  selfInspectionMeasurementActorAuthenticationBodySchema: z.input<typeof Api.selfInspectionMeasurementActorAuthenticationBodySchema>;
  selfInspectionModeSchema: z.input<typeof Api.selfInspectionModeSchema>;
  selfInspectionPaperQrPayloadBodySchema: z.input<typeof Api.selfInspectionPaperQrPayloadBodySchema>;
  selfInspectionRecordApprovalStateSchema: z.input<typeof Api.selfInspectionRecordApprovalStateSchema>;
  selfInspectionRegistrationPolicyBodySchema: z.input<typeof Api.selfInspectionRegistrationPolicyBodySchema>;
  selfInspectionResetSessionBodySchema: z.input<typeof Api.selfInspectionResetSessionBodySchema>;
  selfInspectionSessionResolveBodySchema: z.input<typeof Api.selfInspectionSessionResolveBodySchema>;
  selfInspectionUpdateEntryBodySchema: z.input<typeof Api.selfInspectionUpdateEntryBodySchema>;
  selfInspectionUpdateInspectorEntryBodySchema: z.input<typeof Api.selfInspectionUpdateInspectorEntryBodySchema>;
  selfInspectionUpsertDraftEntryBodySchema: z.input<typeof Api.selfInspectionUpsertDraftEntryBodySchema>;
  templateItemSchema: z.input<typeof Api.templateItemSchema>;
  templateScopeSchema: z.input<typeof Api.templateScopeSchema>;
  updateInspectionDrawingMeasurementLabelSettingsBodySchema: z.input<typeof Api.updateInspectionDrawingMeasurementLabelSettingsBodySchema>;
  evaluationPatch: z.input<typeof patchInspectionDrawingEvaluationSheetBodySchema>;
};
// 各 API 入力を個別に検査し、Prisma 未生成などによる any 化で一致検査が空振りするのを防ぐ。
expectTypeOf<{ [K in keyof ApiInputs]: IsAny<ApiInputs[K]> }>().toEqualTypeOf<{
  [K in keyof ApiInputs]: false;
}>();

// 引数の undefined は省略指定なので、送信する body / query オブジェクト本体を比較する。
expectTypeOf<NonNullable<Parameters<typeof Client.resolvePartMeasurementTicket>[0]>>().toEqualTypeOf<ApiInputs['resolveTicketBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.findOrOpenPartMeasurementSheet>[0]>>().toEqualTypeOf<ApiInputs['findOrOpenSheetBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.createPartMeasurementSheet>[0]>>().toEqualTypeOf<ApiInputs['createSheetBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.patchPartMeasurementSheet>[1]>>().toEqualTypeOf<ApiInputs['patchSheetBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.resolveOrCreateSelfInspectionSession>[0]>>().toEqualTypeOf<ApiInputs['selfInspectionSessionResolveBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.listSelfInspectionSessions>[0]>>().toEqualTypeOf<ApiInputs['listSelfInspectionSessionsQuerySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.invalidateSelfInspectionItem>[0]>>().toEqualTypeOf<ApiInputs['invalidateSelfInspectionItemBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.listSelfInspectionInvalidations>[0]>>().toEqualTypeOf<ApiInputs['listSelfInspectionInvalidationsQuerySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.updateSelfInspectionRegistrationPolicy>[0]>>().toEqualTypeOf<ApiInputs['selfInspectionRegistrationPolicyBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.listSelfInspectionRecordApprovals>[0]>>().toEqualTypeOf<ApiInputs['listSelfInspectionRecordApprovalsQuerySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.authenticateSelfInspectionMeasurementActor>[1]>>().toEqualTypeOf<ApiInputs['selfInspectionMeasurementActorAuthenticationBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.createSelfInspectionEntry>[1]>>().toEqualTypeOf<ApiInputs['selfInspectionCreateEntryBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.upsertSelfInspectionDraftEntry>[1]>>().toEqualTypeOf<ApiInputs['selfInspectionUpsertDraftEntryBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.updateSelfInspectionEntry>[2]>>().toEqualTypeOf<ApiInputs['selfInspectionUpdateEntryBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.createSelfInspectionInspectorEntry>[1]>>().toEqualTypeOf<ApiInputs['selfInspectionCreateInspectorEntryBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.updateSelfInspectionInspectorEntry>[2]>>().toEqualTypeOf<ApiInputs['selfInspectionUpdateInspectorEntryBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.saveSelfInspectionInspectorJudgements>[2]>>().toEqualTypeOf<ApiInputs['selfInspectionInspectorJudgementsBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.recordSelfInspectionInstrumentPreUseInspection>[2]>>().toEqualTypeOf<ApiInputs['selfInspectionInstrumentPreUseInspectionBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.recordSelfInspectionInspectorInstrumentPreUseInspection>[2]>>().toEqualTypeOf<ApiInputs['selfInspectionInstrumentPreUseInspectionBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.approveSelfInspectionOutOfToleranceReview>[1]>>().toEqualTypeOf<ApiInputs['approveSelfInspectionOutOfToleranceReviewBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.approveSelfInspectionRecordApproval>[1]>>().toEqualTypeOf<ApiInputs['approveSelfInspectionRecordApprovalBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.resetSelfInspectionSession>[1]>>().toEqualTypeOf<ApiInputs['selfInspectionResetSessionBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.issueSelfInspectionPaperReport>[0]>>().toEqualTypeOf<ApiInputs['issueSelfInspectionPaperReportBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.createSelfInspectionPaperOcrReview>[0]>>().toEqualTypeOf<ApiInputs['createSelfInspectionPaperOcrReviewBodySchema']>();
// web の配列要素は交差型なので、キーを展開して同じオブジェクト表現に揃える。
type ConfirmBody = Parameters<typeof Client.confirmSelfInspectionPaperOcrReview>[1];
type ConfirmValue = ConfirmBody['values'][number];
expectTypeOf<Omit<ConfirmBody, 'values'>>().toEqualTypeOf<Omit<ApiInputs['confirmSelfInspectionPaperOcrReviewBodySchema'], 'values'>>();
expectTypeOf<{ [K in keyof ConfirmValue]: ConfirmValue[K] }>().toEqualTypeOf<ApiInputs['confirmSelfInspectionPaperOcrReviewBodySchema']['values'][number]>();
expectTypeOf<NonNullable<Parameters<typeof Client.changeKioskInspectionDrawingTemplateProcessGroup>[1]>>().toEqualTypeOf<ApiInputs['changeInspectionDrawingTemplateProcessGroupBodySchema']>();
// 未決: 共通 schema の candidateFhinmei を図面単体改版ルートは service に渡さず、対応判断が必要。
expectTypeOf<Parameters<typeof Client.reviseKioskInspectionDrawingTemplate>[1]>().toEqualTypeOf<Omit<ApiInputs['reviseTemplateBodySchema'], 'candidateFhinmei'>>();
expectTypeOf<NonNullable<Parameters<typeof Client.createKioskInspectionDrawingTemplateGroup>[0]>>().toEqualTypeOf<ApiInputs['createInspectionDrawingTemplateGroupBodySchema']>();
// 未決: 共通 schema の candidateFhinmei / detachFromSiblingGroup をグループ改版ルートは service に渡さず、対応判断が必要。
expectTypeOf<Parameters<typeof Client.reviseKioskInspectionDrawingTemplateGroup>[1]>().toEqualTypeOf<Omit<ApiInputs['reviseTemplateBodySchema'], 'candidateFhinmei' | 'detachFromSiblingGroup'>>();
expectTypeOf<NonNullable<Parameters<typeof Client.addKioskInspectionDrawingTemplateGroupResources>[1]>>().toEqualTypeOf<ApiInputs['addInspectionDrawingTemplateGroupResourcesBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.listPartMeasurementTemplateCandidates>[0]>>().toEqualTypeOf<ApiInputs['listTemplateCandidatesQuerySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.clonePartMeasurementTemplateForScheduleKey>[0]>>().toEqualTypeOf<ApiInputs['cloneTemplateForScheduleBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.listPartMeasurementDrawingOcrCandidates>[1]>>().toEqualTypeOf<ApiInputs['drawingOcrCandidateBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.createPartMeasurementTemplate>[0]>>().toEqualTypeOf<ApiInputs['createTemplateBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.revisePartMeasurementTemplate>[1]>>().toEqualTypeOf<ApiInputs['reviseTemplateBodySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.existsActivePartMeasurementTemplate>[0]>>().toEqualTypeOf<ApiInputs['activeTemplateExistsQuerySchema']>();
expectTypeOf<NonNullable<Parameters<typeof Client.updateInspectionDrawingMeasurementLabelSettings>[0]>>().toEqualTypeOf<ApiInputs['updateInspectionDrawingMeasurementLabelSettingsBodySchema']>();
expectTypeOf<Parameters<typeof Client.patchInspectionDrawingEvaluationSheet>[1]>().toEqualTypeOf<ApiInputs['evaluationPatch']>();
// sample は旧入力名のみ。serializeSelfInspectionMode は SAMPLE も fixed_count として返す。
expectTypeOf<Web.SelfInspectionMode>().toEqualTypeOf<Exclude<ApiInputs['selfInspectionModeSchema'], 'sample'>>();
// active は一覧 query 専用で、serializeRecordApprovalSessionListItem の返却状態には含まれない。
expectTypeOf<Web.SelfInspectionRecordApprovalState>().toEqualTypeOf<Exclude<ApiInputs['selfInspectionRecordApprovalStateSchema'], 'active'>>();
expectTypeOf<Web.PartMeasurementProcessGroup>().toEqualTypeOf<ApiInputs['processGroupSchema']>();
expectTypeOf<Web.PartMeasurementTemplateScope>().toEqualTypeOf<ApiInputs['templateScopeSchema']>();
expectTypeOf<Web.SelfInspectionStatus>().toEqualTypeOf<NonNullable<ApiInputs['listSelfInspectionSessionsQuerySchema']['status']>>();
expectTypeOf<Web.SelfInspectionRecordApprovalScope>().toEqualTypeOf<NonNullable<ApiInputs['listSelfInspectionRecordApprovalsQuerySchema']['scope']>>();
expectTypeOf<Drawing.InspectionDrawingDepthMode>().toEqualTypeOf<NonNullable<ApiInputs['templateItemSchema']['depthMode']>>();
expectTypeOf<Drawing.InspectionDrawingValueKind>().toEqualTypeOf<NonNullable<ApiInputs['templateItemSchema']['valueKind']>>();
expectTypeOf<Web.SelfInspectionEntryValuePayload>().toEqualTypeOf<ApiInputs['selfInspectionCreateEntryBodySchema']['values'][number]>();
expectTypeOf<Parameters<typeof Client.updateInspectionDrawingMeasurementLabelSettings>[0]['settings'][number]['toleranceKind']>().toEqualTypeOf<ApiInputs['inspectionDrawingToleranceKindSchema']>();
// coerce の input は unknown なので当該フィールドだけ比較から外し、残りのキーは完全一致で検査する。
expectTypeOf<Omit<NonNullable<Parameters<typeof Client.listPartMeasurementTemplates>[0]>, 'includeInactive'>>().toEqualTypeOf<Omit<ApiInputs['listTemplatesQuerySchema'], 'includeInactive'>>();
expectTypeOf<Omit<Parameters<typeof Client.listKioskInspectionDrawingTemplates>[0], 'includeInactive'>>().toEqualTypeOf<Omit<ApiInputs['kioskInspectionDrawingTemplatesQuerySchema'], 'includeInactive'>>();
// prefix は API の default で省略可能だが、候補検索 UI は明示した prefix だけを送る。
expectTypeOf<Omit<Parameters<typeof Client.listInspectionDrawingFhincdCandidates>[0], 'limit' | 'prefix'>>().toEqualTypeOf<Omit<ApiInputs['inspectionDrawingFhincdCandidatesQuerySchema'], 'limit' | 'prefix'>>();
expectTypeOf<Parameters<typeof Client.listInspectionDrawingFhincdCandidates>[0]['prefix']>().toEqualTypeOf<NonNullable<ApiInputs['inspectionDrawingFhincdCandidatesQuerySchema']['prefix']>>();
// web は multipart(file 付き)だけを使う。visualTemplateId は API の JSON 経路専用なので比較から外す。
expectTypeOf<Omit<Parameters<typeof Client.createInspectionDrawingEvaluationTemplate>[0], 'file'>>().toEqualTypeOf<Omit<ApiInputs['evaluationCreate'], 'visualTemplateId'>>();
// uid / qrPayload は client 関数内で JSON オブジェクトに包んで送る。
expectTypeOf<{ uid: Parameters<typeof Client.resolveSelfInspectionRecordApprovalApprover>[0] }>().toEqualTypeOf<ApiInputs['resolveSelfInspectionRecordApprovalApproverBodySchema']>();
expectTypeOf<{ qrPayload: Parameters<typeof Client.resolveSelfInspectionPaperReportPage>[0] }>().toEqualTypeOf<ApiInputs['selfInspectionPaperQrPayloadBodySchema']>();

expectTypeOf<Parameters<typeof Client.transferPartMeasurementEditLock>[1]>().toEqualTypeOf<ApiInputs['transferSheetEditLockBodySchema']>();
expectTypeOf<{ reason: Parameters<typeof Client.cancelPartMeasurementSheet>[1] }>().toEqualTypeOf<ApiInputs['cancelSheetBodySchema']>();
expectTypeOf<{ templateId: Parameters<typeof Client.createInspectionDrawingEvaluationSheet>[0] }>().toEqualTypeOf<ApiInputs['createEvaluationSheetBodySchema']>();
expectTypeOf<{ uid: Parameters<typeof Client.resolveSelfInspectionNfcTagUid>[0] }>().toEqualTypeOf<ApiInputs['resolveSelfInspectionNfcTagBodySchema']>();
expectTypeOf<{ name: Parameters<typeof Client.updatePartMeasurementVisualTemplateName>[1] }>().toEqualTypeOf<ApiInputs['updateVisualTemplateNameBodySchema']>();
// coerce の limit / entryIndex / boolean 入力は unknown なので、そのフィールドだけ比較対象外。
expectTypeOf<Omit<Parameters<typeof Client.listPartMeasurementDrafts>[0], 'limit'>>().toEqualTypeOf<Omit<ApiInputs['listDraftSheetsQuerySchema'], 'limit'>>();
expectTypeOf<Omit<Parameters<typeof Client.listPartMeasurementFinalized>[0], 'limit' | 'includeCancelled' | 'includeInvalidated'>>().toEqualTypeOf<Omit<ApiInputs['listFinalizedSheetsQuerySchema'], 'limit' | 'includeCancelled' | 'includeInvalidated'>>();
expectTypeOf<Omit<NonNullable<Parameters<typeof Client.getSelfInspectionSession>[1]>, 'clientKey' | 'entryIndex'>>().toEqualTypeOf<Omit<ApiInputs['getSelfInspectionSessionQuerySchema'], 'entryIndex'>>();
expectTypeOf<Omit<NonNullable<Parameters<typeof Client.getSelfInspectionInspectorMeasurementSession>[1]>, 'clientKey' | 'entryIndex'>>().toEqualTypeOf<Omit<ApiInputs['getSelfInspectionSessionQuerySchema'], 'entryIndex'>>();
// clientKey は HTTP ヘッダー専用。includeInactive は web が boolean だけ送り、API は文字列も受ける。
expectTypeOf<Omit<NonNullable<Parameters<typeof Client.listPartMeasurementVisualTemplates>[0]>, 'limit' | 'includeInactive'>>().toEqualTypeOf<Omit<ApiInputs['listVisualTemplatesQuerySchema'], 'limit' | 'includeInactive'>>();
expectTypeOf<NonNullable<Parameters<typeof Client.listPartMeasurementVisualTemplates>[0]>['includeInactive']>().toEqualTypeOf<Exclude<ApiInputs['listVisualTemplatesQuerySchema']['includeInactive'], string>>();

// 再 export する placement API も対象。query の工程は API に default があるが web は常に指定する。
expectTypeOf<{ processGroup: Parameters<typeof Client.getInspectionDrawingPlacementProposals>[1] }>().toEqualTypeOf<Required<ApiInputs['placementQuery']>>();
expectTypeOf<Parameters<typeof Client.postInspectionDrawingPlacementDecisions>[1]>().toEqualTypeOf<ApiInputs['placementDecisions']>();

const compilerOptions: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  types: ['vitest/globals', 'node', 'vite/client']
};
const testFile = fileURLToPath(import.meta.url);

function checkFile(fileName: string, source?: string) {
  const host = ts.createCompilerHost(compilerOptions);
  if (source !== undefined) {
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === fileName
        ? ts.createSourceFile(name, source, languageVersion, true)
        : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  }
  const program = ts.createProgram([fileName], compilerOptions, host);
  // CI で Prisma 未生成の API 側に出る診断は対象外。このファイルの型アサーションだけを数える。
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) throw new Error(`型検査対象が見つかりません: ${fileName}`);
  return [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => '\n'
  });
}

describe('part-measurement の API / web 型契約', () => {
  it('このファイル自身の一致アサーションを TypeScript で検査する', () => {
    const diagnostics = checkFile(testFile);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  }, 60_000);

  it('仮想ファイルの意図的に誤った一致アサーションを検出する', () => {
    const virtualFile = testFile.replace('.test.ts', '.negative.test.ts');
    const diagnostics = checkFile(virtualFile, `
      import type { z } from 'zod';
      import type { selfInspectionModeSchema } from '../../../../api/src/routes/part-measurement/shared';
      import type { SelfInspectionMode } from '../../features/part-measurement/types';
      import { expectTypeOf } from 'vitest';
      type IsAny<T> = 0 extends (1 & T) ? true : false;
      const notAny: IsAny<z.input<typeof selfInspectionModeSchema>> = false;
      expectTypeOf<SelfInspectionMode | 'intentional_mismatch'>().toEqualTypeOf<Exclude<z.input<typeof selfInspectionModeSchema>, 'sample'>>();
    `);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 2344), formatDiagnostics(diagnostics)).not.toHaveLength(0);
  }, 60_000);
});
