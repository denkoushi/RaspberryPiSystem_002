import { serializeProcedureDocument } from './procedure-documents.js';
import { normalizeTorqueWrenchSettingVerificationMode } from '../../services/torque-wrenches/index.js';
import {
  AssemblyWorkSessionService,
  serializeAssemblyWorkSessionApproval,
  resolveAssemblyTraceabilityMode,
  type AssemblyProcedureSequenceDocumentSummary,
  type AssemblyProcedureSequence,
  type AssemblySeibanCandidate,
  type AssemblyLotSummary,
  type AssemblyTemplateDetail,
  type AssemblyTemplateDetailRow,
  type AssemblyTemplateSummary,
  type AssemblyWorkSessionDetail,
  type AssemblyWorkSessionSummary
} from '../../services/assembly/index.js';

function decimalToString(value: { toString(): string } | number | string | null | undefined): string | null {
  return value == null ? null : value.toString();
}

export function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeTemplateSummary(template: AssemblyTemplateSummary) {
  return {
    id: template.id,
    modelCode: template.modelCode,
    procedurePattern: template.procedurePattern,
    name: template.name,
    version: template.version,
    isActive: template.isActive,
    traceabilityMode: template.traceabilityMode,
    procedureDocumentId: template.procedureDocumentId,
    procedureDocumentName: template.procedureDocumentName,
    procedureItemCount: template.procedureItemCount,
    usesLegacyProcedureSequence: template.procedureItemCount === 0,
    areaCount: template.areaCount,
    boltCount: template.boltCount,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

export function serializeSeibanCandidate(candidate: AssemblySeibanCandidate) {
  return {
    fseiban: candidate.fseiban,
    machineName: candidate.machineName,
    machineNameSource: candidate.machineNameSource,
    activeTemplate: candidate.activeTemplate
  };
}

function serializeProcedureSequenceDocumentSummary(
  document: AssemblyProcedureSequenceDocumentSummary
) {
  return {
    id: document.id,
    documentType: document.documentType,
    title: document.title,
    displayTitle: document.displayTitle,
    filename: document.filename,
    confirmedDocumentNumber: document.confirmedDocumentNumber,
    confirmedSummaryText: document.confirmedSummaryText,
    pageCount: document.pageCount,
    enabled: document.enabled,
    updatedAt: document.updatedAt.toISOString(),
    imageRelativePath: document.imageRelativePath
  };
}

export function serializeProcedureSequence(sequence: AssemblyProcedureSequence) {
  return {
    mode: sequence.mode,
    source: sequence.source,
    reason: sequence.mode === 'fallback' ? sequence.reason : null,
    machineName: sequence.machineName,
    machineNameKey: sequence.machineNameKey,
    stepSource: sequence.stepSource,
    steps: sequence.steps.map((step) => ({
      ...step,
      viewMode: step.viewMode === 'CROP' ? 'crop' : 'full_page',
      emphasis: step.emphasis.toLowerCase()
    })),
    documents: sequence.documents.map((document) => ({
      ...(document.lastApproval !== undefined ? { lastApproval: document.lastApproval } : {}),
      orderItemId: document.orderItemId,
      sortOrder: document.sortOrder,
      label: document.label,
      documentType: document.documentType,
      kioskDocumentId: document.kioskDocumentId,
      assemblyProcedureDocumentId: document.assemblyProcedureDocumentId,
      title: document.title,
      displayTitle: document.displayTitle,
      filename: document.filename,
      confirmedDocumentNumber: document.confirmedDocumentNumber,
      confirmedSummaryText: document.confirmedSummaryText,
      pageCount: document.pageCount,
      updatedAt: document.updatedAt.toISOString(),
      pageUrls: document.pageUrls,
      pages: document.pages,
      overlays: document.overlays,
      assets: document.assets
    })),
    fallbackProcedureDocument: sequence.fallbackProcedureDocument
  };
}

function serializeLotSerialStatus(status: AssemblyLotSummary['serials'][number]['status']) {
  return status === 'NOT_STARTED' ? 'not_started' : status.toLowerCase();
}

export function serializeAssemblyLotSummary(lot: AssemblyLotSummary) {
  return {
    id: lot.id,
    templateId: lot.templateId,
    productNo: lot.productNo,
    expectedQuantity: lot.expectedQuantity,
    registeredSerialCount: lot.registeredSerialCount,
    notStartedCount: lot.notStartedCount,
    inProgressCount: lot.inProgressCount,
    completedCount: lot.completedCount,
    cancelledCount: lot.cancelledCount,
    approvedCount: lot.approvedCount,
    isWorkComplete: lot.isWorkComplete,
    isFullyApproved: lot.isFullyApproved,
    operatorEmployeeId: lot.operatorEmployeeId,
    operatorNameSnapshot: lot.operatorNameSnapshot,
    targetUnit: lot.targetUnit,
    torqueWrenchId: lot.torqueWrenchId,
    clientDeviceId: lot.clientDeviceId,
    clientDeviceNameSnapshot: lot.clientDeviceNameSnapshot,
    createdAt: lot.createdAt.toISOString(),
    updatedAt: lot.updatedAt.toISOString(),
    template: lot.template,
    serials: lot.serials.map((serial) => ({
      id: serial.id,
      lotId: serial.lotId,
      workUnitId: serial.workUnitId,
      sortOrder: serial.sortOrder,
      workId: serial.workId,
      serialNo: serial.serialNo,
      status: serializeLotSerialStatus(serial.status),
      workSessionId: serial.workSessionId,
      startedAt: dateToIso(serial.startedAt),
      completedAt: dateToIso(serial.completedAt),
      cancelledAt: dateToIso(serial.cancelledAt),
      updatedAt: serial.updatedAt.toISOString(),
      approval: serializeAssemblyWorkSessionApproval(serial.approval)
    }))
  };
}

export function serializeCheckSummary(summary: {
  requiredTotal: number;
  requiredCompleted: number;
  allRequiredCompleted: boolean;
}) {
  return summary;
}

export function serializeCheckRecord(record: {
  checkItemId: string;
  checked: boolean;
  checkedByOperatorName: string | null;
  checkedAt: Date | null;
}) {
  return {
    checkItemId: record.checkItemId,
    checked: record.checked,
    checkedByOperatorName: record.checkedByOperatorName,
    checkedAt: record.checked ? dateToIso(record.checkedAt) : null
  };
}

export function serializeTemplate(template: AssemblyTemplateDetail | AssemblyTemplateDetailRow) {
  const procedureSequence =
    'procedureSequence' in template
      ? {
          source: template.procedureSequence.source,
          stepSource: template.procedureSequence.stepSource,
          steps: template.procedureSequence.steps.map((step) => ({
            ...step,
            viewMode: step.viewMode === 'CROP' ? 'crop' : 'full_page',
            emphasis: step.emphasis.toLowerCase()
          })),
          items: template.procedureSequence.items.map((item) => ({
            id: item.id,
            sortOrder: item.sortOrder,
            label: item.label,
            documentType: item.documentType,
            kioskDocumentId: item.kioskDocumentId,
            assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
            document: serializeProcedureSequenceDocumentSummary(item.document)
          }))
        }
      : null;
  return {
    id: template.id,
    modelCode: template.modelCode,
    procedurePattern: template.procedurePattern,
    name: template.name,
    version: template.version,
    isActive: template.isActive,
    traceabilityMode: resolveAssemblyTraceabilityMode(template.traceabilityMode),
    procedureDocumentId: template.procedureDocumentId,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    procedureDocument: serializeProcedureDocument(template.procedureDocument),
    ...(procedureSequence ? { procedureSequence } : {}),
    checkItems: template.checkItems.map((item) => ({
      id: item.id,
      markerNo: item.markerNo,
      label: item.label,
      required: item.required,
      xRatio: item.xRatio,
      yRatio: item.yRatio,
      calloutTipXRatio: item.calloutTipXRatio,
      calloutTipYRatio: item.calloutTipYRatio,
      sortOrder: item.sortOrder,
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      pageIndex: item.pageIndex,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    areas: template.areas.map((area) => ({
      id: area.id,
      templateId: area.templateId,
      sortOrder: area.sortOrder,
      processNo: area.processNo,
      areaCode: area.areaCode,
      areaName: area.areaName,
      unitCode: area.unitCode,
      requireManualAdvance: area.requireManualAdvance,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
      bolts: area.bolts.map((bolt) => ({
        id: bolt.id,
        areaId: bolt.areaId,
        templateId: bolt.templateId ?? area.templateId,
        sortOrder: bolt.sortOrder,
        tighteningId: bolt.tighteningId,
        markerNo: bolt.markerNo,
        xRatio: decimalToString(bolt.xRatio),
        yRatio: decimalToString(bolt.yRatio),
        calloutTipXRatio: decimalToString(bolt.calloutTipXRatio),
        calloutTipYRatio: decimalToString(bolt.calloutTipYRatio),
        boltSpec: bolt.boltSpec,
        nominalDiameter: bolt.nominalDiameter,
        boltLengthMm: decimalToString(bolt.boltLengthMm),
        material: bolt.material,
        strengthClass: bolt.strengthClass,
        capabilityGroupId: bolt.capabilityGroupId,
        nominalTorque: decimalToString(bolt.nominalTorque),
        lowerLimit: decimalToString(bolt.lowerLimit),
        upperLimit: decimalToString(bolt.upperLimit),
        unit: bolt.unit,
        kioskDocumentId: bolt.kioskDocumentId,
        assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId,
        pageIndex: bolt.pageIndex,
        createdAt: bolt.createdAt.toISOString(),
        updatedAt: bolt.updatedAt.toISOString()
      }))
    }))
  };
}

export function serializeSessionSummary(session: AssemblyWorkSessionSummary) {
  return {
    id: session.id,
    workUnitId: session.workUnitId,
    lotSerialId: session.lotSerialId,
    templateId: session.templateId,
    status: session.status.toLowerCase(),
    productNo: session.productNo,
    workId: session.workId,
    serialNo: session.workId,
    nameplateNo: session.nameplateNo,
    operatorNameSnapshot: session.operatorNameSnapshot,
    targetUnit: session.targetUnit,
    torqueWrenchId: session.torqueWrenchId,
    startedAt: session.startedAt.toISOString(),
    completedAt: dateToIso(session.completedAt),
    cancelledAt: dateToIso(session.cancelledAt),
    updatedAt: session.updatedAt.toISOString(),
    templateModelCode: session.templateModelCode,
    templateProcedurePattern: session.templateProcedurePattern,
    templateName: session.templateName,
    templateVersion: session.templateVersion,
    currentAreaId: session.currentAreaId,
    currentAreaName: session.currentAreaName,
    currentBoltId: session.currentBoltId,
    currentBoltMarkerNo: session.currentBoltMarkerNo,
    acceptedBoltCount: session.acceptedBoltCount,
    totalBoltCount: session.totalBoltCount,
    approval: serializeAssemblyWorkSessionApproval(session.approval),
    isTopLevel: session.isTopLevel,
    formalId: session.formalId
  };
}

function buildAreaTorqueSummaries(session: AssemblyWorkSessionDetail) {
  return [...session.template.areas]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((area) => {
      const boltIds = new Set(area.bolts.map((bolt) => bolt.id));
      const records = session.torqueRecords.filter((record) => boltIds.has(record.templateBoltId));
      const acceptedOkCount = records.filter((record) => record.accepted && record.judgement === 'OK').length;
      const ngCount = records.filter((record) => record.judgement === 'NG').length;
      const ignoredCount = records.filter((record) => record.judgement === 'IGNORED').length;
      return {
        areaId: area.id,
        areaCode: area.areaCode,
        areaName: area.areaName,
        processNo: area.processNo,
        totalBoltCount: area.bolts.length,
        acceptedOkCount,
        ngCount,
        ignoredCount
      };
    });
}

export function serializeSession(session: AssemblyWorkSessionDetail, sessionService: AssemblyWorkSessionService) {
  const checkItems = sessionService.buildCheckItemsWithRecords(session);
  const checkSummary = sessionService.buildCheckSummary(session);
  return {
    id: session.id,
    workUnitId: session.workUnitId,
    lotSerialId: session.lotSerialId,
    templateId: session.templateId,
    status: session.status.toLowerCase(),
    productNo: session.productNo,
    workId: session.workId,
    serialNo: session.workId,
    nameplateNo: session.nameplateNo,
    operatorEmployeeId: session.operatorEmployeeId,
    operatorNameSnapshot: session.operatorNameSnapshot,
    targetUnit: session.targetUnit,
    torqueWrenchId: session.torqueWrenchId,
    clientDeviceId: session.clientDeviceId,
    clientDeviceNameSnapshot: session.clientDeviceNameSnapshot,
    currentAreaId: session.currentAreaId,
    currentBoltId: session.currentBoltId,
    startedAt: session.startedAt.toISOString(),
    completedAt: dateToIso(session.completedAt),
    cancelledAt: dateToIso(session.cancelledAt),
    cancelReason: session.cancelReason,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    template: serializeTemplate(session.template),
    torqueRecords: session.torqueRecords.map((record) => ({
      id: record.id,
      sessionId: record.sessionId,
      templateBoltId: record.templateBoltId,
      attempt: record.attempt,
      inputSource: record.inputSource.toLowerCase(),
      rawPayload: record.rawPayload,
      value: decimalToString(record.value),
      inputUnit: record.inputUnit,
      valueNm: decimalToString(record.valueNm),
      judgement: record.judgement.toLowerCase(),
      accepted: record.accepted,
      ignoredReason: record.ignoredReason,
      torqueWrenchProfileId: record.torqueWrenchProfileId,
      confirmationId: record.confirmationId,
      settingHistoryId: record.settingHistoryId,
      settingVerificationMode: normalizeTorqueWrenchSettingVerificationMode(record.settingVerificationMode),
      serialNumberSnapshot: record.serialNumberSnapshot,
      manufacturerSnapshot: record.manufacturerSnapshot,
      modelNumberSnapshot: record.modelNumberSnapshot,
      settingLowerLimitSnapshot: decimalToString(record.settingLowerLimitSnapshot),
      settingNominalTorqueSnapshot: decimalToString(record.settingNominalTorqueSnapshot),
      settingUpperLimitSnapshot: decimalToString(record.settingUpperLimitSnapshot),
      settingUnitSnapshot: record.settingUnitSnapshot,
      sourceClientDeviceId: record.sourceClientDeviceId,
      sourceEventKey: record.sourceEventKey,
      expectedTemplateBoltId: record.expectedTemplateBoltId,
      deviceRecordedAt: dateToIso(record.deviceRecordedAt),
      deviceMemoryCounter: record.deviceMemoryCounter,
      deviceJudgement: record.deviceJudgement,
      connectionLeaseId: record.connectionLeaseId,
      connectionLeaseGeneration: record.connectionLeaseGeneration,
      overrideActorUsername: record.overrideActorUsername,
      overrideReason: record.overrideReason,
      recordedAt: record.recordedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      tighteningId: record.templateBolt.tighteningId,
      markerNo: record.templateBolt.markerNo,
      areaId: record.templateBolt.areaId,
      areaName: record.templateBolt.area.areaName
    })),
    restartLogs: session.restartLogs.map((log) => ({
      id: log.id,
      sessionId: log.sessionId,
      areaId: log.areaId,
      reason: log.reason,
      createdAt: log.createdAt.toISOString()
    })),
    approval: serializeAssemblyWorkSessionApproval(session.approval),
    areaTorqueSummaries: buildAreaTorqueSummaries(session),
    checkItems: checkItems.map((item) => ({
      id: item.id,
      markerNo: item.markerNo,
      label: item.label,
      required: item.required,
      xRatio: item.xRatio,
      yRatio: item.yRatio,
      calloutTipXRatio: item.calloutTipXRatio,
      calloutTipYRatio: item.calloutTipYRatio,
      sortOrder: item.sortOrder,
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      pageIndex: item.pageIndex,
      record: item.record ? serializeCheckRecord(item.record) : null
    })),
    checkSummary: serializeCheckSummary(checkSummary)
  };
}
