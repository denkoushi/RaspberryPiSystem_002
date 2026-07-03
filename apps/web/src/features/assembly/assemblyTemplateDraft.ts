import type { AssemblyCanvasBolt } from './AssemblyProcedureCanvas';
import type {
  AssemblyTemplateAreaDto,
  AssemblyTemplateAreaInput,
  AssemblyTemplateBoltDto,
  AssemblyTemplateBoltInput,
  AssemblyTemplateDto,
  AssemblyWorkSessionDto
} from './types';

export type AssemblyDraftBolt = AssemblyTemplateBoltInput & { id: string };
export type AssemblyDraftArea = Omit<AssemblyTemplateAreaInput, 'bolts'> & { id: string; bolts: AssemblyDraftBolt[] };

export const toNumber = (raw: string | number | null | undefined, fallback = 0): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

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

export function createAssemblyBoltAt(area: AssemblyDraftArea, xRatio: number, yRatio: number): AssemblyDraftBolt {
  const index = area.bolts.length;
  return {
    id: crypto.randomUUID(),
    sortOrder: index,
    tighteningId: formatTighteningId(area, index),
    markerNo: index + 1,
    xRatio,
    yRatio,
    boltSpec: 'M6x30',
    nominalTorque: 90,
    lowerLimit: 81,
    upperLimit: 99,
    unit: 'kgf-cm'
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
    boltSpec: bolt.boltSpec,
    nominalTorque: toNumber(bolt.nominalTorque),
    lowerLimit: toNumber(bolt.lowerLimit),
    upperLimit: toNumber(bolt.upperLimit),
    unit: bolt.unit
  };
}

export function templateToDraftAreas(template: AssemblyTemplateDto): AssemblyDraftArea[] {
  return template.areas.map(dtoAreaToDraft);
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
      boltSpec: bolt.boltSpec,
      nominalTorque: bolt.nominalTorque,
      lowerLimit: bolt.lowerLimit,
      upperLimit: bolt.upperLimit,
      unit: bolt.unit
    }))
  }));
}

export function draftToCanvasBolts(areas: AssemblyDraftArea[]): AssemblyCanvasBolt[] {
  return areas.flatMap((area) =>
    area.bolts.map((bolt) => ({
      id: bolt.id,
      markerNo: bolt.markerNo,
      xRatio: bolt.xRatio,
      yRatio: bolt.yRatio,
      label: bolt.tighteningId,
      status: 'pending' as const
    }))
  );
}

export function templateToCanvasBolts(
  template: AssemblyTemplateDto,
  statusByBolt = new Map<string, AssemblyCanvasBolt['status']>()
): AssemblyCanvasBolt[] {
  return template.areas.flatMap((area) =>
    area.bolts.map((bolt) => ({
      id: bolt.id,
      markerNo: bolt.markerNo,
      xRatio: toNumber(bolt.xRatio),
      yRatio: toNumber(bolt.yRatio),
      label: bolt.tighteningId,
      status: statusByBolt.get(bolt.id) ?? 'pending'
    }))
  );
}

export const latestStatusByBolt = (session: AssemblyWorkSessionDto): Map<string, AssemblyCanvasBolt['status']> => {
  const map = new Map<string, AssemblyCanvasBolt['status']>();
  for (const record of session.torqueRecords) {
    if (record.judgement === 'ok' && record.accepted) map.set(record.templateBoltId, 'ok');
    else if (record.judgement === 'ng') map.set(record.templateBoltId, 'ng');
    else if (record.judgement === 'ignored') map.set(record.templateBoltId, 'ignored');
  }
  if (session.currentBoltId) map.set(session.currentBoltId, 'current');
  return map;
};

export function currentAssemblyArea(session: AssemblyWorkSessionDto) {
  return session.template.areas.find((area) => area.id === session.currentAreaId) ?? null;
}

export function currentAssemblyBolt(session: AssemblyWorkSessionDto) {
  return session.template.areas.flatMap((area) => area.bolts).find((bolt) => bolt.id === session.currentBoltId) ?? null;
}
