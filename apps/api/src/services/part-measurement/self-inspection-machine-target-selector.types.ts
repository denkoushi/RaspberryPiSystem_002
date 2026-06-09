export type SelfInspectionMachineTargetCandidate = {
  machineName: string;
  normalizedMachineName: string;
  inProgressCount: number;
  earliestDueDate: Date | null;
  sourceRowCount: number;
};

export type SelfInspectionMachineTargetSelectionResult = {
  targets: SelfInspectionMachineTargetCandidate[];
  /** 切り詰め前の候補機種数 */
  totalCandidateCount: number;
  truncated: boolean;
  hitScanCap: boolean;
  scannedRowCount: number;
};
