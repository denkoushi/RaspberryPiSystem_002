import type { SignageSlotConfig } from '../../../api/client';

/**
 * 自主検査部品別進捗の管理 UI 用設定。
 * detailTopN は既存設定を読み込むためだけに残し、新規保存には使わない。
 */
export interface SelfInspectionMachineBoardEditorFields {
  fullSelfInspectionTargetMode: 'manual_machine_name' | 'kiosk_active_sessions';
  fullSelfInspectionMachineName: string;
  fullSelfInspectionDeviceScopeKey: string;
  fullSelfInspectionResourceCdsText: string;
  fullSelfInspectionMaxAutoMachinesStr: string;
  fullSelfInspectionSlideIntervalStr: string;
  fullSelfInspectionPartsPerPageStr: string;
  /** legacy auto 設定を読んだときだけ表示する移行案内。保存データには含めない。 */
  fullSelfInspectionLegacyAutoMigrationNotice: boolean;
  /** legacy detailTopN の読込保持用。UI には表示しない。 */
  fullSelfInspectionDetailTopNStr: string;
}

export type SelfInspectionMachineBoardEditorFieldsPatch = Partial<SelfInspectionMachineBoardEditorFields>;
export type SelfInspectionMachineBoardBuildFields = Omit<
  SelfInspectionMachineBoardEditorFields,
  'fullSelfInspectionDetailTopNStr' | 'fullSelfInspectionLegacyAutoMigrationNotice'
>;

export const DEFAULT_SELF_INSPECTION_PARTS_PER_PAGE = 6;
export const MAX_SELF_INSPECTION_PARTS_PER_PAGE = 6;

export function createResetSelfInspectionMachineBoardEditorFields(): SelfInspectionMachineBoardEditorFields {
  return {
    fullSelfInspectionTargetMode: 'kiosk_active_sessions',
    fullSelfInspectionMachineName: '',
    fullSelfInspectionDeviceScopeKey: '',
    fullSelfInspectionResourceCdsText: '',
    fullSelfInspectionMaxAutoMachinesStr: '',
    fullSelfInspectionSlideIntervalStr: '',
    fullSelfInspectionPartsPerPageStr: '',
    fullSelfInspectionLegacyAutoMigrationNotice: false,
    fullSelfInspectionDetailTopNStr: '',
  };
}

/**
 * 既存の slot.config を管理 UI の入力値へ変換する。
 * detailTopN もここでは読み込むが、buildSelfInspectionMachineBoardConfig は出力しない。
 */
export function parseSelfInspectionMachineBoardConfig(
  config: SignageSlotConfig
): SelfInspectionMachineBoardEditorFieldsPatch {
  const resourceCds = Array.isArray(config.resourceCds) ? config.resourceCds : [];
  const isLegacyAuto = config.targetMode === 'auto_from_leaderboard_status';

  return {
    fullSelfInspectionTargetMode:
      config.targetMode === 'kiosk_active_sessions' || isLegacyAuto
        ? 'kiosk_active_sessions'
        : 'manual_machine_name',
    fullSelfInspectionMachineName: String(config.machineName ?? '').trim(),
    fullSelfInspectionDeviceScopeKey: String(config.deviceScopeKey ?? '').trim(),
    fullSelfInspectionResourceCdsText: resourceCds
      .map((cd) => String(cd).trim())
      .filter(Boolean)
      .join('\n'),
    fullSelfInspectionMaxAutoMachinesStr:
      config.maxAutoMachines != null ? String(config.maxAutoMachines) : '',
    fullSelfInspectionSlideIntervalStr:
      config.slideIntervalSeconds != null ? String(config.slideIntervalSeconds) : '',
    fullSelfInspectionPartsPerPageStr:
      config.partsPerPage != null ? String(config.partsPerPage) : '',
    fullSelfInspectionLegacyAutoMigrationNotice: isLegacyAuto,
    fullSelfInspectionDetailTopNStr: config.detailTopN != null ? String(config.detailTopN) : '',
  };
}

/**
 * 管理 UI の入力値を新しい保存設定へ変換する。
 * 新規保存は部品行数を既定6・最大6に固定し、legacy detailTopN は移行しない。
 */
export function buildSelfInspectionMachineBoardConfig(
  fields: SelfInspectionMachineBoardBuildFields
): SignageSlotConfig | null {
  const boardConfig: SignageSlotConfig = {
    targetMode:
      fields.fullSelfInspectionTargetMode === 'manual_machine_name'
        ? 'manual_machine_name'
        : 'kiosk_active_sessions',
  };

  if (fields.fullSelfInspectionTargetMode === 'manual_machine_name') {
    const machineName = fields.fullSelfInspectionMachineName.trim();
    if (!machineName) {
      return null;
    }
    boardConfig.machineName = machineName;
    if (fields.fullSelfInspectionDeviceScopeKey.trim() !== '') {
      boardConfig.deviceScopeKey = fields.fullSelfInspectionDeviceScopeKey.trim();
    }
  }

  if (fields.fullSelfInspectionSlideIntervalStr.trim() !== '') {
    const n = Number(fields.fullSelfInspectionSlideIntervalStr);
    if (Number.isFinite(n) && n > 0) {
      boardConfig.slideIntervalSeconds = n;
    }
  }

  const partsPerPageInput = fields.fullSelfInspectionPartsPerPageStr.trim();
  const partsPerPage = partsPerPageInput === ''
    ? DEFAULT_SELF_INSPECTION_PARTS_PER_PAGE
    : Number(partsPerPageInput);
  boardConfig.partsPerPage = Number.isFinite(partsPerPage) && partsPerPage >= 1
    ? Math.min(MAX_SELF_INSPECTION_PARTS_PER_PAGE, Math.floor(partsPerPage))
    : DEFAULT_SELF_INSPECTION_PARTS_PER_PAGE;

  return boardConfig;
}
