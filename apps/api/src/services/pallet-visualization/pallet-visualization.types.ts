import type { MachinePalletEventActionType } from '@prisma/client';

export type PalletVisualizationMachineSummary = {
  machineCd: string;
  machineName: string;
  illustrationUrl: string | null;
  /** 1..N のパレット欄。未設定時は 10 相当をサーバが返す */
  palletCount: number;
};

export type PalletVisualizationItem = {
  id: string;
  machineCd: string;
  palletNo: number;
  displayOrder: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  /** カード表示用（半角大文字・ハイフン前など）。 */
  machineNameDisplay: string | null;
  csvDashboardRowId: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
  outsideDimensionsDisplay: string | null;
};

export type PalletVisualizationPalletView = {
  palletNo: number;
  items: PalletVisualizationItem[];
};

export type PalletVisualizationMachineBoard = PalletVisualizationMachineSummary & {
  pallets: PalletVisualizationPalletView[];
};

export type PalletVisualizationMachinesResponse = {
  machines: PalletVisualizationMachineSummary[];
};

export type PalletVisualizationBoardResponse = {
  machines: PalletVisualizationMachineBoard[];
};

export type PalletVisualizationMachineResponse = {
  machine: PalletVisualizationMachineBoard;
};

export type PalletVisualizationHistoryEntry = {
  id: string;
  actionType: MachinePalletEventActionType;
  machineCd: string;
  palletNo: number | null;
  affectedItemId: string | null;
  manufacturingOrderBarcodeRaw: string | null;
  illustrationRelativeUrl: string | null;
  createdAt: string;
};

export type PalletVisualizationHistoryResponse = {
  events: PalletVisualizationHistoryEntry[];
  nextCursor: string | null;
};
