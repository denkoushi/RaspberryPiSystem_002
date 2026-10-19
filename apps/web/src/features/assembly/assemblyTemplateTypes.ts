import type { AssemblyProcedureDocumentDto } from './assemblyProcedureDocumentTypes';
import type {
  AssemblyProcedureSequenceItemDto,
  AssemblyProcedureStepSourceDto,
  AssemblyTemplateProcedureStepDto
} from './assemblyProcedureSequenceTypes';

export type AssemblyTemplateBoltDto = {
  id: string;
  areaId: string;
  templateId: string;
  sortOrder: number;
  tighteningId: string;
  markerNo: number;
  xRatio: string;
  yRatio: string;
  calloutTipXRatio?: string | null;
  calloutTipYRatio?: string | null;
  boltSpec: string;
  nominalDiameter: string | null;
  boltLengthMm: string | null;
  material: string | null;
  strengthClass: string | null;
  capabilityGroupId: string | null;
  nominalTorque: string;
  lowerLimit: string;
  upperLimit: string;
  unit: string;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number;
  createdAt: string;
  updatedAt: string;
};

export type AssemblyTemplateCheckItemDto = {
  id: string;
  markerNo: number;
  label: string | null;
  required: boolean;
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  sortOrder: number;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
};

export type AssemblyTemplateAreaDto = {
  id: string;
  templateId: string;
  sortOrder: number;
  processNo: string;
  areaCode: string;
  areaName: string;
  unitCode: string;
  requireManualAdvance: boolean;
  createdAt: string;
  updatedAt: string;
  bolts: AssemblyTemplateBoltDto[];
};

export type AssemblyTemplateDto = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  traceabilityMode?: 'LEGACY' | 'REQUIRED';
  procedureDocumentId: string;
  createdAt: string;
  updatedAt: string;
  procedureDocument: AssemblyProcedureDocumentDto;
  procedureSequence?: {
    source: 'template_version' | 'legacy_machine_order' | 'primary_fallback';
    stepSource?: AssemblyProcedureStepSourceDto;
    steps?: AssemblyTemplateProcedureStepDto[];
    items: AssemblyProcedureSequenceItemDto[];
  };
  areas: AssemblyTemplateAreaDto[];
  checkItems: AssemblyTemplateCheckItemDto[];
};

export type AssemblyTemplateSummaryDto = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  traceabilityMode?: 'LEGACY' | 'REQUIRED';
  procedureDocumentId: string;
  procedureDocumentName: string;
  procedureItemCount: number;
  usesLegacyProcedureSequence: boolean;
  areaCount: number;
  boltCount: number;
  createdAt: string;
  updatedAt: string;
};
