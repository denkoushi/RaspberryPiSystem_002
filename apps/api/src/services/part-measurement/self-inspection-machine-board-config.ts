import type { SelfInspectionMachineBoardSlotConfig } from '../signage/signage-layout.types.js';
import {
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES,
  MAX_SELF_INSPECTION_MACHINE_BOARD_MAX_AUTO_MACHINES,
} from '../signage/self-inspection-machine-board/layout-contracts.js';

export type ResolvedSelfInspectionMachineBoardTargetMode =
  | 'manual_machine_name'
  | 'auto_from_leaderboard_status'
  | 'kiosk_active_sessions';

/** route/signage 側の保存契約が段階移行中でも読める active mode の入力型。 */
export type SelfInspectionMachineBoardTargetMode = ResolvedSelfInspectionMachineBoardTargetMode;

export type SelfInspectionMachineBoardConfigInput = Omit<
  SelfInspectionMachineBoardSlotConfig,
  'targetMode'
> & {
  targetMode?: SelfInspectionMachineBoardTargetMode;
};

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
  config: { targetMode?: string | null }
): ResolvedSelfInspectionMachineBoardTargetMode {
  switch (config.targetMode) {
    case 'auto_from_leaderboard_status':
      return 'auto_from_leaderboard_status';
    case 'kiosk_active_sessions':
      return 'kiosk_active_sessions';
    case 'manual_machine_name':
    case undefined:
    case null:
      return 'manual_machine_name';
    default:
      throw new Error(`Unsupported self-inspection machine board targetMode: ${config.targetMode}`);
  }
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
  config: SelfInspectionMachineBoardConfigInput
): ResolvedSelfInspectionMachineBoardConfig {
  const targetMode = resolveSelfInspectionMachineBoardTargetMode(config);
  const deviceScopeKey = normalizeText(config.deviceScopeKey) || undefined;

  if (targetMode === 'kiosk_active_sessions') {
    return { targetMode };
  }

  if (targetMode === 'auto_from_leaderboard_status') {
    const resourceCds = (config.resourceCds ?? [])
      .map((cd) => cd.trim())
      .filter(Boolean);
    return {
      targetMode,
      deviceScopeKey,
      resourceCds,
      ...(targetMode === 'auto_from_leaderboard_status'
        ? { maxAutoMachines: sanitizeSelfInspectionMachineBoardMaxAutoMachines(config.maxAutoMachines) }
        : {}),
    };
  }

  return {
    targetMode,
    machineName: normalizeText(config.machineName) || undefined,
    deviceScopeKey,
  };
}
