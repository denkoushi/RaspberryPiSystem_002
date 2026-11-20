import type { AssemblyProcedureOverlayElement } from './assembly-procedure-overlay.js';
import type { AssemblyProcedureCropRect } from './assembly-procedure-step.js';

export type ProcedureManualPrintPage = {
  pageUrl: string;
  crop: AssemblyProcedureCropRect | null;
  overlays: AssemblyProcedureOverlayElement[];
  assets: Record<string, {
    assetId: string;
    storageKey: string;
    contentType: string;
    byteSize: number;
    url: string;
  }>;
};

export type ProcedureManualPrintPayload = ProcedureManualPrintPage & {
  title: string;
  revisionLabel: string;
  pageLabel: string;
  informationLabel: string;
  outputLabel: string;
};
