import type { SelfInspectionMachineBoardSlotConfig } from '../signage/signage-layout.types.js';
import {
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES,
  MAX_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES,
} from '../signage/self-inspection-machine-board/layout-contracts.js';

export type ResolvedSelfInspectionMachineBoardTargetMode =
  | 'manual_machine_name'
  | 'auto_from_leaderboard_status';

export type ResolvedSelfInspectionMachineBoardConfig = {
  targetMode: ResolvedSelfInspectionMachineBoardTargetMode;
  machineName?: string;
  deviceScopeKey?: string;
  resourceCds?: string[];
  /** auto 時のみ */
  maxAutoMachines?: number;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function resolveSelfInspectionMachineBoardTargetMode(
  config: Pick<SelfInspectionMachineBoardSlotConfig, 'targetMode'>
): ResolvedSelfInspectionMachineBoardTargetMode {
  return config.targetMode ?? 'manual_machine_name';
}

export function sanitizeSelfInspectionMachineBoardMaxAutoMachines(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES;
  }
  const n = Math.floor(value as number);
  if (n < 1) {
    return 1;
  }
  if (n > MAX_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES) {
    return MAX_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES;
  }
  return n;
}

export function resolveSelfInspectionMachineBoardConfig(
  config: SelfInspectionMachineBoardSlotConfig
): ResolvedSelfInspectionMachineBoardConfig {
  const targetMode = resolveSelfInspectionMachineBoardTargetMode(config);
  const deviceScopeKey = normalizeText(config.deviceScopeKey) || undefined;

  if (targetMode === 'auto_from_leaderboard_status') {
    return {
      targetMode,
      deviceScopeKey,
      resourceCds: (config.resourceCds ?? []).map((cd) => cd.trim()).filter(Boolean),
      maxAutoMachines: sanitizeSelfInspectionMachineBoardMaxAutoMachines(config.maxAutoMachines),
    };
  }

  return {
    targetMode,
    machineName: normalizeText(config.machineName) || undefined,
    deviceScopeKey,
  };
}
