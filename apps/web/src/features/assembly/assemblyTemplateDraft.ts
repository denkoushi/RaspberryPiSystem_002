import type { AssemblyCanvasBolt, AssemblyCanvasCheckItem } from './AssemblyProcedureCanvas';
import type { AssemblyTorqueMarkerDisplayState } from './assemblyTorquePresentation';
import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblyProcedureSequenceDocumentDto,
  AssemblyProcedureSequencePageDto,
  AssemblyTemplateAreaDto,
  AssemblyTemplateAreaInput,
  AssemblyTemplateBoltDto,
  AssemblyTemplateBoltInput,
  AssemblyTemplateCheckItemDto,
  AssemblyTemplateCheckItemInput,
  AssemblyTemplateDto,
  AssemblyWorkSessionCheckItemDto,
  AssemblyWorkSessionDto
} from './types';

export type AssemblyDraftBolt = AssemblyTemplateBoltInput & {
  id: string;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

export type AssemblyDraftCheckItem = AssemblyTemplateCheckItemInput & { id: string };

export type AssemblyDraftArea = Omit<AssemblyTemplateAreaInput, 'bolts'> & { id: string; bolts: AssemblyDraftBolt[] };

export type AssemblyPageRef = {
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
};

export type AssemblyEditorPageOption = {
  key: string;
  label: string;
  source: AssemblyPageRef['source'];
  documentId: string;
  pageIndex: number;
  imageRelativePath: string;
};

export const toNumber = (raw: string | number | null | undefined, fallback = 0): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export function resolveAssemblyDocumentStatus(
  document: Pick<AssemblyProcedureDocumentDto, 'status'> | null | undefined
): 'draft' | 'published' {
  return document?.status ?? 'published';
}

export function assemblyProcedureDocumentPageCount(
  document: Pick<AssemblyProcedureDocumentDto, 'pages' | 'imageRelativePath'> | null | undefined
): number {
  if (!document) return 0;
  if (document.pages?.length) return document.pages.length;
  return document.imageRelativePath ? 1 : 0;
}

export function assemblyProcedureDocumentPages(
  document: Pick<AssemblyProcedureDocumentDto, 'pages' | 'imageRelativePath'> | null | undefined
): Array<{ pageIndex: number; imageRelativePath: string }> {
  if (!document) return [];
  if (document.pages?.length) {
    return [...document.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  }
  if (document.imageRelativePath) {
    return [{ pageIndex: 0, imageRelativePath: document.imageRelativePath }];
  }
  return [];
}

export function getSequenceDocumentPages(document: AssemblyProcedureSequenceDocumentDto): AssemblyProcedureSequencePageDto[] {
  if (document.pages?.length) {
    return [...document.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  }
  const documentId = document.assemblyProcedureDocumentId ?? document.kioskDocumentId ?? '';
  const source: AssemblyProcedureSequencePageDto['source'] =
    document.documentType === 'kiosk_document' ? 'kiosk_document' : 'assembly_procedure_document';
  return (document.pageUrls ?? []).map((pageUrl, pageIndex) => ({
    source,
    documentId,
    pageIndex,
    pageUrl
  }));
}

export function pageRefKey(ref: AssemblyPageRef): string {
  return `${ref.source}:${ref.documentId}:${ref.pageIndex}`;
}

export function matchesAssemblyMarkerPageRef(
  marker: {
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    pageIndex?: number | null;
  },
  current: AssemblyPageRef,
  templateProcedureDocumentId: string
): boolean {
  const kioskDocumentId = marker.kioskDocumentId ?? null;
  const assemblyProcedureDocumentId = marker.assemblyProcedureDocumentId ?? null;
  const pageIndex = marker.pageIndex ?? 0;

  if (kioskDocumentId) {
    return current.source === 'kiosk_document' && current.documentId === kioskDocumentId && current.pageIndex === pageIndex;
  }
  if (assemblyProcedureDocumentId) {
    return (
      current.source === 'assembly_procedure_document' &&
      current.documentId === assemblyProcedureDocumentId &&
      current.pageIndex === pageIndex
    );
  }
  return (
    current.source === 'assembly_procedure_document' &&
    current.documentId === templateProcedureDocumentId &&
    current.pageIndex === 0
  );
}

export function buildAssemblyEditorPageOptions(input: {
  primaryDocument: AssemblyProcedureDocumentSummaryDto | AssemblyProcedureDocumentDto | null;
  orderAssemblyDocuments?: AssemblyProcedureDocumentSummaryDto[];
  kioskPages?: Array<{ documentId: string; title: string; pageUrls: string[] }>;
}): AssemblyEditorPageOption[] {
  const options: AssemblyEditorPageOption[] = [];
  const seen = new Set<string>();

  const pushDocumentPages = (
    document: Pick<AssemblyProcedureDocumentDto, 'id' | 'name' | 'status' | 'pages' | 'imageRelativePath'>,
    prefix?: string
  ) => {
    if (resolveAssemblyDocumentStatus(document) !== 'published') return;
    for (const page of assemblyProcedureDocumentPages(document)) {
      const ref: AssemblyPageRef = {
        source: 'assembly_procedure_document',
        documentId: document.id,
        pageIndex: page.pageIndex
      };
      const key = pageRefKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        key,
        label: `${prefix ?? ''}${document.name} / ${page.pageIndex + 1}ページ`.trim(),
        source: ref.source,
        documentId: ref.documentId,
        pageIndex: ref.pageIndex,
        imageRelativePath: page.imageRelativePath
      });
    }
  };

  if (input.primaryDocument) {
    pushDocumentPages(input.primaryDocument, '手順書 ');
  }
  for (const document of input.orderAssemblyDocuments ?? []) {
    pushDocumentPages(document, '表示順 ');
  }
  for (const kiosk of input.kioskPages ?? []) {
    kiosk.pageUrls.forEach((pageUrl, pageIndex) => {
      const ref: AssemblyPageRef = {
        source: 'kiosk_document',
        documentId: kiosk.documentId,
        pageIndex
      };
      const key = pageRefKey(ref);
      if (seen.has(key)) return;
      seen.add(key);
      options.push({
        key,
        label: `要領書 ${kiosk.title} / ${pageIndex + 1}ページ`,
        source: ref.source,
        documentId: ref.documentId,
        pageIndex,
        imageRelativePath: pageUrl
      });
    });
  }

  return options;
}

export const emptyAssemblyArea = (index = 0): AssemblyDraftArea => ({
  id: crypto.randomUUID(),
  sortOrder: index,
  processNo: index === 0 ? '7' : String(index + 1),
  areaCode: index === 0 ? '13' : String(index + 1),
  areaName: index === 0 ? 'ストッパー取付' : `工程${index + 1}`,
  unitCode: index === 0 ? 'U1' : `U${index + 1}`,
  requireManualAdvance: true,
  bolts: []
});

export const formatTighteningId = (area: Pick<AssemblyDraftArea, 'processNo' | 'areaCode' | 'unitCode'>, index: number) =>
  `P${area.processNo}-A${area.areaCode}-U${area.unitCode}-B${index + 1}`;

export const ASSEMBLY_BOLT_CONDITION_KEYS = [
  'boltSpec',
  'nominalDiameter',
  'boltLengthMm',
  'material',
  'strengthClass',
  'nominalTorque',
  'lowerLimit',
  'upperLimit',
  'unit',
  'capabilityGroupId'
] as const;

export type AssemblyBoltConditionKey = (typeof ASSEMBLY_BOLT_CONDITION_KEYS)[number];

export function nextAssemblyMarkerNo(areas: AssemblyDraftArea[]): number {
  const used = new Set(areas.flatMap((area) => area.bolts.map((bolt) => bolt.markerNo)));
  let markerNo = 1;
  while (used.has(markerNo)) markerNo += 1;
  return markerNo;
}

export function copyAssemblyBoltCondition(source: AssemblyDraftBolt, target: AssemblyDraftBolt): AssemblyDraftBolt {
  return {
    ...target,
    boltSpec: source.boltSpec,
    nominalDiameter: source.nominalDiameter,
    boltLengthMm: source.boltLengthMm,
    material: source.material,
    strengthClass: source.strengthClass,
    nominalTorque: source.nominalTorque,
    lowerLimit: source.lowerLimit,
    upperLimit: source.upperLimit,
    unit: source.unit,
    capabilityGroupId: source.capabilityGroupId
  };
}

export function applyAssemblyBoltConditionRange(
  areas: AssemblyDraftArea[],
  sourceBoltId: string,
  startMarkerNo: number,
  endMarkerNo: number
): { areas: AssemblyDraftArea[]; updatedCount: number; missingCount: number } {
  const source = areas.flatMap((area) => area.bolts).find((bolt) => bolt.id === sourceBoltId);
  if (!source) return { areas, updatedCount: 0, missingCount: 0 };
  const first = Math.min(startMarkerNo, endMarkerNo);
  const last = Math.max(startMarkerNo, endMarkerNo);
  const targets = new Set(Array.from({ length: last - first + 1 }, (_, index) => first + index));
  let updatedCount = 0;
  const nextAreas = areas.map((area) => ({
    ...area,
    bolts: area.bolts.map((bolt) => {
      if (!targets.has(bolt.markerNo) || bolt.id === source.id) return bolt;
      updatedCount += 1;
      return copyAssemblyBoltCondition(source, bolt);
    })
  }));
  const existingCount = new Set(areas.flatMap((area) => area.bolts.map((bolt) => bolt.markerNo)).filter((no) => targets.has(no))).size;
  return { areas: nextAreas, updatedCount, missingCount: targets.size - existingCount };
}

export function createAssemblyBoltAt(
  area: AssemblyDraftArea,
  xRatio: number,
  yRatio: number,
  pageRef?: AssemblyPageRef | null,
  options?: { allAreas?: AssemblyDraftArea[]; inheritFrom?: AssemblyDraftBolt | null }
): AssemblyDraftBolt {
  const index = area.bolts.length;
  const markerNo = options?.allAreas ? nextAssemblyMarkerNo(options.allAreas) : nextAssemblyMarkerNo([area]);
  const created: AssemblyDraftBolt = {
    id: crypto.randomUUID(),
    sortOrder: index,
    tighteningId: formatTighteningId(area, index),
    markerNo,
    xRatio,
    yRatio,
    calloutTipXRatio: null,
    calloutTipYRatio: null,
    boltSpec: 'M6x30',
    nominalDiameter: 'M6',
    boltLengthMm: 30,
    material: 'STEEL',
    strengthClass: '8.8',
    capabilityGroupId: null,
    nominalTorque: 90,
    lowerLimit: 81,
    upperLimit: 99,
    unit: 'kgf-cm',
    kioskDocumentId: pageRef?.source === 'kiosk_document' ? pageRef.documentId : null,
    assemblyProcedureDocumentId: pageRef?.source === 'assembly_procedure_document' ? pageRef.documentId : null,
    pageIndex: pageRef?.pageIndex ?? null
  };
  return options?.inheritFrom ? copyAssemblyBoltCondition(options.inheritFrom, created) : created;
}

export function createAssemblyCheckItemAt(
  checkItems: AssemblyDraftCheckItem[],
  xRatio: number,
  yRatio: number,
  pageRef?: AssemblyPageRef | null
): AssemblyDraftCheckItem {
  const index = checkItems.length;
  return {
    id: crypto.randomUUID(),
    markerNo: index + 1,
    label: `チェック${index + 1}`,
    required: true,
    xRatio,
    yRatio,
    calloutTipXRatio: null,
    calloutTipYRatio: null,
    sortOrder: index,
    kioskDocumentId: pageRef?.source === 'kiosk_document' ? pageRef.documentId : null,
    assemblyProcedureDocumentId: pageRef?.source === 'assembly_procedure_document' ? pageRef.documentId : null,
    pageIndex: pageRef?.pageIndex ?? 0
  };
}

export function dtoAreaToDraft(area: AssemblyTemplateAreaDto): AssemblyDraftArea {
  return {
    id: area.id,
    sortOrder: area.sortOrder,
    processNo: area.processNo,
    areaCode: area.areaCode,
    areaName: area.areaName,
    unitCode: area.unitCode,
    requireManualAdvance: area.requireManualAdvance,
    bolts: area.bolts.map(dtoBoltToDraft)
  };
}

export function dtoBoltToDraft(bolt: AssemblyTemplateBoltDto): AssemblyDraftBolt {
  return {
    id: bolt.id,
    sortOrder: bolt.sortOrder,
    tighteningId: bolt.tighteningId,
    markerNo: bolt.markerNo,
    xRatio: toNumber(bolt.xRatio),
    yRatio: toNumber(bolt.yRatio),
    calloutTipXRatio: bolt.calloutTipXRatio == null ? null : toNumber(bolt.calloutTipXRatio),
    calloutTipYRatio: bolt.calloutTipYRatio == null ? null : toNumber(bolt.calloutTipYRatio),
    boltSpec: bolt.boltSpec,
    nominalDiameter: bolt.nominalDiameter,
    boltLengthMm: bolt.boltLengthMm == null ? null : toNumber(bolt.boltLengthMm),
    material: bolt.material,
    strengthClass: bolt.strengthClass,
    capabilityGroupId: bolt.capabilityGroupId,
    nominalTorque: toNumber(bolt.nominalTorque),
    lowerLimit: toNumber(bolt.lowerLimit),
    upperLimit: toNumber(bolt.upperLimit),
    unit: bolt.unit,
    kioskDocumentId: bolt.kioskDocumentId ?? null,
    assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId ?? null,
    pageIndex: bolt.pageIndex ?? null
  };
}

export function dtoCheckItemToDraft(item: AssemblyTemplateCheckItemDto): AssemblyDraftCheckItem {
  return {
    id: item.id,
    markerNo: item.markerNo,
    label: item.label,
    required: item.required,
    xRatio: item.xRatio,
    yRatio: item.yRatio,
    calloutTipXRatio: item.calloutTipXRatio ?? null,
    calloutTipYRatio: item.calloutTipYRatio ?? null,
    sortOrder: item.sortOrder,
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
    pageIndex: item.pageIndex
  };
}

export function templateToDraftAreas(template: AssemblyTemplateDto): AssemblyDraftArea[] {
  return template.areas.map(dtoAreaToDraft);
}

export function templateToDraftCheckItems(template: AssemblyTemplateDto): AssemblyDraftCheckItem[] {
  return (template.checkItems ?? []).map(dtoCheckItemToDraft);
}

export function draftAreasToInput(areas: AssemblyDraftArea[]): AssemblyTemplateAreaInput[] {
  return areas.map((area, areaIndex) => ({
    sortOrder: areaIndex,
    processNo: area.processNo,
    areaCode: area.areaCode,
    areaName: area.areaName,
    unitCode: area.unitCode,
    requireManualAdvance: area.requireManualAdvance ?? true,
    bolts: area.bolts.map((bolt, boltIndex) => ({
      sortOrder: boltIndex,
      tighteningId: bolt.tighteningId,
      markerNo: bolt.markerNo,
      xRatio: bolt.xRatio,
      yRatio: bolt.yRatio,
      calloutTipXRatio: bolt.calloutTipXRatio ?? null,
      calloutTipYRatio: bolt.calloutTipYRatio ?? null,
      boltSpec: bolt.boltSpec,
      nominalDiameter: bolt.nominalDiameter ?? null,
      boltLengthMm: bolt.boltLengthMm ?? null,
      material: bolt.material ?? null,
      strengthClass: bolt.strengthClass ?? null,
      capabilityGroupId: bolt.capabilityGroupId ?? null,
      nominalTorque: bolt.nominalTorque,
      lowerLimit: bolt.lowerLimit,
      upperLimit: bolt.upperLimit,
      unit: bolt.unit,
      kioskDocumentId: bolt.kioskDocumentId ?? null,
      assemblyProcedureDocumentId: bolt.assemblyProcedureDocumentId ?? null,
      pageIndex: bolt.pageIndex ?? null
    }))
  }));
}

export function draftCheckItemsToInput(checkItems: AssemblyDraftCheckItem[]): AssemblyTemplateCheckItemInput[] {
  return checkItems.map((item, index) => ({
    markerNo: item.markerNo,
    label: item.label,
    required: item.required ?? true,
    xRatio: item.xRatio,
    yRatio: item.yRatio,
    calloutTipXRatio: item.calloutTipXRatio ?? null,
    calloutTipYRatio: item.calloutTipYRatio ?? null,
    sortOrder: index,
    kioskDocumentId: item.kioskDocumentId ?? null,
    assemblyProcedureDocumentId: item.assemblyProcedureDocumentId ?? null,
    pageIndex: item.pageIndex ?? 0
  }));
}

export function renumberDraftCheckItems(checkItems: AssemblyDraftCheckItem[]): AssemblyDraftCheckItem[] {
  return checkItems.map((item, index) => ({
    ...item,
    markerNo: index + 1,
    sortOrder: index,
    label: item.label?.trim() ? item.label : `チェック${index + 1}`
  }));
}

export function filterDraftBoltsForPage(
  areas: AssemblyDraftArea[],
  pageRef: AssemblyPageRef,
  templateProcedureDocumentId: string
): AssemblyCanvasBolt[] {
  return areas.flatMap((area) =>
    area.bolts
      .filter((bolt) => matchesAssemblyMarkerPageRef(bolt, pageRef, templateProcedureDocumentId))
      .map((bolt) => ({
        id: bolt.id,
        markerNo: bolt.markerNo,
        xRatio: bolt.xRatio,
        yRatio: bolt.yRatio,
        calloutTipXRatio: bolt.calloutTipXRatio ?? null,
        calloutTipYRatio: bolt.calloutTipYRatio ?? null,
        label: bolt.tighteningId ?? `丸数字${bolt.markerNo}`,
        status: 'pending' as const
      }))
  );
}

export function filterDraftCheckItemsForPage(
  checkItems: AssemblyDraftCheckItem[],
  pageRef: AssemblyPageRef,
  templateProcedureDocumentId: string
): AssemblyCanvasCheckItem[] {
  return checkItems
    .filter((item) => matchesAssemblyMarkerPageRef(item, pageRef, templateProcedureDocumentId))
    .map((item) => ({
      id: item.id,
      markerNo: item.markerNo,
      xRatio: item.xRatio,
      yRatio: item.yRatio,
      calloutTipXRatio: item.calloutTipXRatio ?? null,
      calloutTipYRatio: item.calloutTipYRatio ?? null,
      label: item.label ?? null,
      required: item.required ?? true,
      checked: false
    }));
}

export function draftToCanvasBolts(areas: AssemblyDraftArea[]): AssemblyCanvasBolt[] {
  return areas.flatMap((area) =>
    area.bolts.map((bolt) => ({
      id: bolt.id,
      markerNo: bolt.markerNo,
      xRatio: bolt.xRatio,
      yRatio: bolt.yRatio,
      calloutTipXRatio: bolt.calloutTipXRatio ?? null,
      calloutTipYRatio: bolt.calloutTipYRatio ?? null,
      label: bolt.tighteningId ?? `丸数字${bolt.markerNo}`,
      status: 'pending' as const
    }))
  );
}

export function templateToCanvasBolts(
  template: AssemblyTemplateDto,
  statusByBolt = new Map<string, AssemblyTorqueMarkerDisplayState>(),
  pageRef?: AssemblyPageRef | null
): AssemblyCanvasBolt[] {
  return template.areas.flatMap((area) =>
    area.bolts
      .filter((bolt) => (pageRef ? matchesAssemblyMarkerPageRef(bolt, pageRef, template.procedureDocumentId) : true))
      .map((bolt) => ({
        id: bolt.id,
        markerNo: bolt.markerNo,
        xRatio: toNumber(bolt.xRatio),
        yRatio: toNumber(bolt.yRatio),
        calloutTipXRatio: bolt.calloutTipXRatio == null ? null : toNumber(bolt.calloutTipXRatio),
        calloutTipYRatio: bolt.calloutTipYRatio == null ? null : toNumber(bolt.calloutTipYRatio),
        label: bolt.tighteningId,
        status: statusByBolt.get(bolt.id) ?? 'pending'
      }))
  );
}

export function sessionCheckItemsToCanvas(
  checkItems: AssemblyWorkSessionCheckItemDto[] | undefined,
  pageRef?: AssemblyPageRef | null,
  templateProcedureDocumentId?: string
): AssemblyCanvasCheckItem[] {
  return (checkItems ?? [])
    .filter((item) =>
      pageRef && templateProcedureDocumentId
        ? matchesAssemblyMarkerPageRef(item, pageRef, templateProcedureDocumentId)
        : true
    )
    .map((item) => ({
      id: item.id,
      markerNo: item.markerNo,
      xRatio: item.xRatio,
      yRatio: item.yRatio,
      calloutTipXRatio: item.calloutTipXRatio ?? null,
      calloutTipYRatio: item.calloutTipYRatio ?? null,
      label: item.label ?? null,
      required: item.required,
      checked: item.record?.checked ?? false
    }));
}


export function currentAssemblyArea(session: AssemblyWorkSessionDto) {
  return session.template.areas.find((area) => area.id === session.currentAreaId) ?? null;
}

export function currentAssemblyBolt(session: AssemblyWorkSessionDto) {
  return session.template.areas.flatMap((area) => area.bolts).find((bolt) => bolt.id === session.currentBoltId) ?? null;
}

export function emptyAssemblyCheckSummary(): AssemblyWorkSessionDto['checkSummary'] {
  return { requiredTotal: 0, requiredCompleted: 0, allRequiredCompleted: true };
}

export function resolveAssemblyCheckSummary(session: AssemblyWorkSessionDto): AssemblyWorkSessionDto['checkSummary'] {
  return session.checkSummary ?? emptyAssemblyCheckSummary();
}
