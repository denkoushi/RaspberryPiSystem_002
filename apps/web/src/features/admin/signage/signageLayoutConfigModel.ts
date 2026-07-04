import { DEFAULT_SCHEDULE_FORM_DATA, parseResourceCdListInput } from './signageScheduleDisplay';

import type {
  SignageLayoutConfig,
  SignagePdf,
  SignageSchedule,
  SignageSlot,
  SignageSlotConfig,
} from '../../../api/client';

export type SignageFullSlotKind =
  | 'loans'
  | 'pdf'
  | 'csv_dashboard'
  | 'visualization'
  | 'kiosk_progress_overview'
  | 'kiosk_leader_order_cards'
  | 'mobile_placement_parts_shelf_grid'
  | 'self_inspection_machine_board';

export type SignageSplitSlotKind = 'loans' | 'pdf' | 'csv_dashboard' | 'visualization';

export type SignageSelfInspectionTargetMode = 'manual_machine_name' | 'auto_from_leaderboard_status';

export interface SignageScheduleEditorState {
  formData: Partial<SignageSchedule>;
  useNewLayout: boolean;
  layoutType: 'FULL' | 'SPLIT';
  leftSlotKind: SignageSplitSlotKind;
  rightSlotKind: SignageSplitSlotKind;
  leftPdfId: string | null;
  rightPdfId: string | null;
  leftCsvDashboardId: string | null;
  rightCsvDashboardId: string | null;
  leftVisualizationDashboardId: string | null;
  rightVisualizationDashboardId: string | null;
  fullSlotKind: SignageFullSlotKind;
  fullPdfId: string | null;
  fullCsvDashboardId: string | null;
  fullVisualizationDashboardId: string | null;
  fullKioskDeviceScopeKey: string;
  fullKioskSlideIntervalStr: string;
  fullKioskSeibanPerPageStr: string;
  fullLeaderOrderDeviceScopeKey: string;
  fullLeaderOrderResourceCdsText: string;
  fullLeaderOrderSlideIntervalStr: string;
  fullLeaderOrderCardsPerPageStr: string;
  fullPartsShelfMaxItemsStr: string;
  fullSelfInspectionTargetMode: SignageSelfInspectionTargetMode;
  fullSelfInspectionMachineName: string;
  fullSelfInspectionDeviceScopeKey: string;
  fullSelfInspectionResourceCdsText: string;
  fullSelfInspectionMaxAutoMachinesStr: string;
  fullSelfInspectionSlideIntervalStr: string;
  fullSelfInspectionPartsPerPageStr: string;
  fullSelfInspectionDetailTopNStr: string;
}

export type SignageScheduleEditorStatePatch = Partial<
  Omit<SignageScheduleEditorState, 'formData'>
> & {
  formData?: Partial<SignageSchedule>;
};

export function createResetFullSlotSpecificFieldsPatch(): SignageScheduleEditorStatePatch {
  return {
    fullPdfId: null,
    fullCsvDashboardId: null,
    fullVisualizationDashboardId: null,
    fullKioskDeviceScopeKey: '',
    fullKioskSlideIntervalStr: '',
    fullKioskSeibanPerPageStr: '',
    fullLeaderOrderDeviceScopeKey: '',
    fullLeaderOrderResourceCdsText: '',
    fullLeaderOrderSlideIntervalStr: '',
    fullLeaderOrderCardsPerPageStr: '',
    fullPartsShelfMaxItemsStr: '',
    fullSelfInspectionTargetMode: 'manual_machine_name',
    fullSelfInspectionMachineName: '',
    fullSelfInspectionDeviceScopeKey: '',
    fullSelfInspectionResourceCdsText: '',
    fullSelfInspectionMaxAutoMachinesStr: '',
    fullSelfInspectionSlideIntervalStr: '',
    fullSelfInspectionPartsPerPageStr: '',
    fullSelfInspectionDetailTopNStr: '',
  };
}

export function createDefaultEditorState(): SignageScheduleEditorState {
  return {
    formData: DEFAULT_SCHEDULE_FORM_DATA,
    useNewLayout: false,
    layoutType: 'FULL',
    leftSlotKind: 'loans',
    rightSlotKind: 'pdf',
    leftPdfId: null,
    rightPdfId: null,
    leftCsvDashboardId: null,
    rightCsvDashboardId: null,
    leftVisualizationDashboardId: null,
    rightVisualizationDashboardId: null,
    fullSlotKind: 'loans',
    ...createResetFullSlotSpecificFieldsPatch(),
  } as SignageScheduleEditorState;
}

export function createResetEditorStatePatch(): SignageScheduleEditorStatePatch {
  return {
    useNewLayout: false,
    layoutType: 'FULL',
    fullSlotKind: 'loans',
    leftSlotKind: 'loans',
    rightSlotKind: 'pdf',
    ...createResetFullSlotSpecificFieldsPatch(),
    leftPdfId: null,
    rightPdfId: null,
    leftCsvDashboardId: null,
    rightCsvDashboardId: null,
    leftVisualizationDashboardId: null,
    rightVisualizationDashboardId: null,
    formData: DEFAULT_SCHEDULE_FORM_DATA,
  };
}

export function parseScheduleToEditorStatePatch(schedule: SignageSchedule): SignageScheduleEditorStatePatch {
  const hasLayoutConfig = schedule.layoutConfig !== null && schedule.layoutConfig !== undefined;
  const patch: SignageScheduleEditorStatePatch = {
    useNewLayout: hasLayoutConfig,
  };

  if (hasLayoutConfig && schedule.layoutConfig) {
    const config = schedule.layoutConfig;
    patch.layoutType = config.layout;

    if (config.layout === 'FULL') {
      const slot = config.slots[0];
      Object.assign(patch, createResetFullSlotSpecificFieldsPatch());
      if (slot) {
        if (slot.kind === 'pdf') {
          patch.fullSlotKind = 'pdf';
          patch.fullPdfId = 'pdfId' in slot.config ? slot.config.pdfId ?? null : null;
        } else if (slot.kind === 'csv_dashboard') {
          patch.fullSlotKind = 'csv_dashboard';
          patch.fullCsvDashboardId = 'csvDashboardId' in slot.config ? slot.config.csvDashboardId ?? null : null;
        } else if (slot.kind === 'visualization') {
          patch.fullSlotKind = 'visualization';
          patch.fullVisualizationDashboardId =
            'visualizationDashboardId' in slot.config ? slot.config.visualizationDashboardId ?? null : null;
        } else if (slot.kind === 'kiosk_progress_overview') {
          patch.fullSlotKind = 'kiosk_progress_overview';
          patch.fullKioskDeviceScopeKey =
            'deviceScopeKey' in slot.config ? String(slot.config.deviceScopeKey ?? '').trim() : '';
          patch.fullKioskSlideIntervalStr =
            'slideIntervalSeconds' in slot.config && slot.config.slideIntervalSeconds != null
              ? String(slot.config.slideIntervalSeconds)
              : '';
          patch.fullKioskSeibanPerPageStr =
            'seibanPerPage' in slot.config && slot.config.seibanPerPage != null
              ? String(slot.config.seibanPerPage)
              : '';
        } else if (slot.kind === 'kiosk_leader_order_cards') {
          patch.fullSlotKind = 'kiosk_leader_order_cards';
          patch.fullLeaderOrderDeviceScopeKey =
            'deviceScopeKey' in slot.config ? String(slot.config.deviceScopeKey ?? '').trim() : '';
          const cds =
            'resourceCds' in slot.config && Array.isArray(slot.config.resourceCds)
              ? (slot.config.resourceCds as string[])
              : [];
          patch.fullLeaderOrderResourceCdsText = cds.map((c) => String(c).trim()).filter(Boolean).join('\n');
          patch.fullLeaderOrderSlideIntervalStr =
            'slideIntervalSeconds' in slot.config && slot.config.slideIntervalSeconds != null
              ? String(slot.config.slideIntervalSeconds)
              : '';
          patch.fullLeaderOrderCardsPerPageStr =
            'cardsPerPage' in slot.config && slot.config.cardsPerPage != null
              ? String(slot.config.cardsPerPage)
              : '';
        } else if (slot.kind === 'mobile_placement_parts_shelf_grid') {
          patch.fullSlotKind = 'mobile_placement_parts_shelf_grid';
          patch.fullPartsShelfMaxItemsStr =
            'maxItemsPerZone' in slot.config && slot.config.maxItemsPerZone != null
              ? String(slot.config.maxItemsPerZone)
              : '';
        } else if (slot.kind === 'self_inspection_machine_board') {
          patch.fullSlotKind = 'self_inspection_machine_board';
          patch.fullSelfInspectionTargetMode =
            'targetMode' in slot.config &&
            slot.config.targetMode === 'auto_from_leaderboard_status'
              ? 'auto_from_leaderboard_status'
              : 'manual_machine_name';
          patch.fullSelfInspectionMachineName =
            'machineName' in slot.config ? String(slot.config.machineName ?? '').trim() : '';
          patch.fullSelfInspectionDeviceScopeKey =
            'deviceScopeKey' in slot.config ? String(slot.config.deviceScopeKey ?? '').trim() : '';
          const resourceCds =
            'resourceCds' in slot.config && Array.isArray(slot.config.resourceCds)
              ? (slot.config.resourceCds as string[])
              : [];
          patch.fullSelfInspectionResourceCdsText =
            resourceCds.map((cd) => String(cd).trim()).filter(Boolean).join('\n');
          patch.fullSelfInspectionMaxAutoMachinesStr =
            'maxAutoMachines' in slot.config && slot.config.maxAutoMachines != null
              ? String(slot.config.maxAutoMachines)
              : '';
          patch.fullSelfInspectionSlideIntervalStr =
            'slideIntervalSeconds' in slot.config && slot.config.slideIntervalSeconds != null
              ? String(slot.config.slideIntervalSeconds)
              : '';
          patch.fullSelfInspectionPartsPerPageStr =
            'partsPerPage' in slot.config && slot.config.partsPerPage != null
              ? String(slot.config.partsPerPage)
              : '';
          patch.fullSelfInspectionDetailTopNStr =
            'detailTopN' in slot.config && slot.config.detailTopN != null
              ? String(slot.config.detailTopN)
              : '';
        } else {
          patch.fullSlotKind = 'loans';
        }
      }
    } else {
      Object.assign(patch, createResetFullSlotSpecificFieldsPatch());
      const leftSlot = config.slots.find((s) => s.position === 'LEFT');
      const rightSlot = config.slots.find((s) => s.position === 'RIGHT');
      if (leftSlot) {
        if (leftSlot.kind === 'pdf') {
          patch.leftSlotKind = 'pdf';
          patch.leftPdfId = 'pdfId' in leftSlot.config ? leftSlot.config.pdfId ?? null : null;
          patch.leftCsvDashboardId = null;
        } else if (leftSlot.kind === 'csv_dashboard') {
          patch.leftSlotKind = 'csv_dashboard';
          patch.leftCsvDashboardId = 'csvDashboardId' in leftSlot.config ? leftSlot.config.csvDashboardId ?? null : null;
          patch.leftPdfId = null;
          patch.leftVisualizationDashboardId = null;
        } else if (leftSlot.kind === 'visualization') {
          patch.leftSlotKind = 'visualization';
          patch.leftVisualizationDashboardId =
            'visualizationDashboardId' in leftSlot.config ? leftSlot.config.visualizationDashboardId ?? null : null;
          patch.leftPdfId = null;
          patch.leftCsvDashboardId = null;
        } else {
          patch.leftSlotKind = 'loans';
          patch.leftPdfId = null;
          patch.leftCsvDashboardId = null;
          patch.leftVisualizationDashboardId = null;
        }
      }
      if (rightSlot) {
        if (rightSlot.kind === 'pdf') {
          patch.rightSlotKind = 'pdf';
          patch.rightPdfId = 'pdfId' in rightSlot.config ? rightSlot.config.pdfId ?? null : null;
          patch.rightCsvDashboardId = null;
          patch.rightVisualizationDashboardId = null;
        } else if (rightSlot.kind === 'csv_dashboard') {
          patch.rightSlotKind = 'csv_dashboard';
          patch.rightCsvDashboardId = 'csvDashboardId' in rightSlot.config ? rightSlot.config.csvDashboardId ?? null : null;
          patch.rightPdfId = null;
          patch.rightVisualizationDashboardId = null;
        } else if (rightSlot.kind === 'visualization') {
          patch.rightSlotKind = 'visualization';
          patch.rightVisualizationDashboardId =
            'visualizationDashboardId' in rightSlot.config ? rightSlot.config.visualizationDashboardId ?? null : null;
          patch.rightPdfId = null;
          patch.rightCsvDashboardId = null;
        } else {
          patch.rightSlotKind = 'loans';
          patch.rightPdfId = null;
          patch.rightCsvDashboardId = null;
          patch.rightVisualizationDashboardId = null;
        }
      }
    }
  } else {
    // 旧形式から初期値を設定
    if (schedule.contentType === 'TOOLS') {
      patch.layoutType = 'FULL';
      patch.fullSlotKind = 'loans';
    } else if (schedule.contentType === 'PDF') {
      patch.layoutType = 'FULL';
      patch.fullSlotKind = 'pdf';
      patch.fullPdfId = schedule.pdfId;
    } else {
      patch.layoutType = 'SPLIT';
      patch.leftSlotKind = 'loans';
      patch.rightSlotKind = 'pdf';
      patch.rightPdfId = schedule.pdfId;
    }
    patch.fullVisualizationDashboardId = null;
    patch.leftVisualizationDashboardId = null;
    patch.rightVisualizationDashboardId = null;
  }

  patch.formData = {
    name: schedule.name,
    contentType: schedule.contentType,
    pdfId: schedule.pdfId,
    layoutConfig: schedule.layoutConfig,
    targetClientKeys: [...(schedule.targetClientKeys ?? [])],
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    priority: schedule.priority,
    enabled: schedule.enabled,
  };

  return patch;
}

export function buildLayoutConfigFromEditorState(
  state: SignageScheduleEditorState,
  pdfs: SignagePdf[] | undefined
): SignageLayoutConfig | null {
  const {
    useNewLayout,
    layoutType,
    fullSlotKind,
    fullPdfId,
    fullCsvDashboardId,
    fullVisualizationDashboardId,
    fullKioskDeviceScopeKey,
    fullKioskSlideIntervalStr,
    fullKioskSeibanPerPageStr,
    fullLeaderOrderDeviceScopeKey,
    fullLeaderOrderResourceCdsText,
    fullLeaderOrderSlideIntervalStr,
    fullLeaderOrderCardsPerPageStr,
    fullPartsShelfMaxItemsStr,
    fullSelfInspectionTargetMode,
    fullSelfInspectionMachineName,
    fullSelfInspectionDeviceScopeKey,
    fullSelfInspectionResourceCdsText,
    fullSelfInspectionMaxAutoMachinesStr,
    fullSelfInspectionSlideIntervalStr,
    fullSelfInspectionPartsPerPageStr,
    fullSelfInspectionDetailTopNStr,
    leftSlotKind,
    rightSlotKind,
    leftPdfId,
    rightPdfId,
    leftCsvDashboardId,
    rightCsvDashboardId,
    leftVisualizationDashboardId,
    rightVisualizationDashboardId,
  } = state;

  if (!useNewLayout) {
    return null; // 旧形式を使用
  }

  if (layoutType === 'FULL') {
    if (fullSlotKind === 'pdf' && fullPdfId) {
      const pdf = pdfs?.find((p) => p.id === fullPdfId);
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'pdf',
            config: {
              pdfId: fullPdfId,
              displayMode: pdf?.displayMode || 'SINGLE',
              slideInterval: pdf?.slideInterval || null,
            },
          },
        ],
      };
    } else if (fullSlotKind === 'csv_dashboard' && fullCsvDashboardId) {
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'csv_dashboard',
            config: {
              csvDashboardId: fullCsvDashboardId,
            },
          },
        ],
      };
    } else if (fullSlotKind === 'visualization' && fullVisualizationDashboardId) {
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'visualization',
            config: {
              visualizationDashboardId: fullVisualizationDashboardId,
            },
          },
        ],
      };
    } else if (fullSlotKind === 'kiosk_progress_overview' && fullKioskDeviceScopeKey.trim()) {
      const config: SignageSlotConfig = {
        deviceScopeKey: fullKioskDeviceScopeKey.trim(),
      };
      if (fullKioskSlideIntervalStr.trim() !== '') {
        const n = Number(fullKioskSlideIntervalStr);
        if (Number.isFinite(n) && n > 0) {
          config.slideIntervalSeconds = n;
        }
      }
      if (fullKioskSeibanPerPageStr.trim() !== '') {
        const n = Number(fullKioskSeibanPerPageStr);
        if (Number.isFinite(n) && n >= 1) {
          config.seibanPerPage = Math.min(8, Math.floor(n));
        }
      }
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'kiosk_progress_overview',
            config,
          },
        ],
      };
    } else if (
      fullSlotKind === 'kiosk_leader_order_cards' &&
      fullLeaderOrderDeviceScopeKey.trim() &&
      parseResourceCdListInput(fullLeaderOrderResourceCdsText).length > 0
    ) {
      const locConfig: SignageSlotConfig = {
        deviceScopeKey: fullLeaderOrderDeviceScopeKey.trim(),
        resourceCds: parseResourceCdListInput(fullLeaderOrderResourceCdsText),
      };
      if (fullLeaderOrderSlideIntervalStr.trim() !== '') {
        const n = Number(fullLeaderOrderSlideIntervalStr);
        if (Number.isFinite(n) && n > 0) {
          locConfig.slideIntervalSeconds = n;
        }
      }
      if (fullLeaderOrderCardsPerPageStr.trim() !== '') {
        const n = Number(fullLeaderOrderCardsPerPageStr);
        if (Number.isFinite(n) && n >= 1) {
          locConfig.cardsPerPage = Math.min(10, Math.floor(n));
        }
      }
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'kiosk_leader_order_cards',
            config: locConfig,
          },
        ],
      };
    } else if (fullSlotKind === 'mobile_placement_parts_shelf_grid') {
      const mpConfig: SignageSlotConfig = {};
      if (fullPartsShelfMaxItemsStr.trim() !== '') {
        const n = Number(fullPartsShelfMaxItemsStr);
        if (Number.isFinite(n) && n >= 1) {
          mpConfig.maxItemsPerZone = Math.min(200, Math.floor(n));
        }
      }
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'mobile_placement_parts_shelf_grid',
            config: mpConfig,
          },
        ],
      };
    } else if (fullSlotKind === 'self_inspection_machine_board') {
      const boardConfig: SignageSlotConfig = {
        targetMode: fullSelfInspectionTargetMode,
      };
      if (fullSelfInspectionTargetMode === 'manual_machine_name') {
        const machineName = fullSelfInspectionMachineName.trim();
        if (!machineName) {
          return null;
        }
        boardConfig.machineName = machineName;
      } else {
        const deviceScopeKey = fullSelfInspectionDeviceScopeKey.trim();
        const resourceCds = parseResourceCdListInput(fullSelfInspectionResourceCdsText);
        if (!deviceScopeKey || resourceCds.length === 0) {
          return null;
        }
        boardConfig.deviceScopeKey = deviceScopeKey;
        boardConfig.resourceCds = resourceCds;
      }
      if (
        fullSelfInspectionTargetMode === 'manual_machine_name' &&
        fullSelfInspectionDeviceScopeKey.trim() !== ''
      ) {
        boardConfig.deviceScopeKey = fullSelfInspectionDeviceScopeKey.trim();
      }
      if (fullSelfInspectionTargetMode === 'auto_from_leaderboard_status') {
        if (fullSelfInspectionMaxAutoMachinesStr.trim() !== '') {
          const n = Number(fullSelfInspectionMaxAutoMachinesStr);
          if (Number.isFinite(n) && n >= 1) {
            boardConfig.maxAutoMachines = Math.min(20, Math.floor(n));
          }
        }
      }
      if (fullSelfInspectionSlideIntervalStr.trim() !== '') {
        const n = Number(fullSelfInspectionSlideIntervalStr);
        if (Number.isFinite(n) && n > 0) {
          boardConfig.slideIntervalSeconds = n;
        }
      }
      if (fullSelfInspectionPartsPerPageStr.trim() !== '') {
        const n = Number(fullSelfInspectionPartsPerPageStr);
        if (Number.isFinite(n) && n >= 1) {
          boardConfig.partsPerPage = Math.min(12, Math.floor(n));
        }
      }
      if (fullSelfInspectionDetailTopNStr.trim() !== '') {
        const n = Number(fullSelfInspectionDetailTopNStr);
        if (Number.isFinite(n) && n >= 0) {
          boardConfig.detailTopN = Math.min(20, Math.floor(n));
        }
      }
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: boardConfig,
          },
        ],
      };
    } else {
      return {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'loans',
            config: {},
          },
        ],
      };
    }
  } else {
    // SPLIT
    const slots: SignageSlot[] = [];

    // 左スロット
    if (leftSlotKind === 'pdf' && leftPdfId) {
      const pdf = pdfs?.find((p) => p.id === leftPdfId);
      slots.push({
        position: 'LEFT',
        kind: 'pdf',
        config: {
          pdfId: leftPdfId,
          displayMode: pdf?.displayMode || 'SINGLE',
          slideInterval: pdf?.slideInterval || null,
        },
      });
    } else if (leftSlotKind === 'csv_dashboard' && leftCsvDashboardId) {
      slots.push({
        position: 'LEFT',
        kind: 'csv_dashboard',
        config: {
          csvDashboardId: leftCsvDashboardId,
        },
      });
    } else if (leftSlotKind === 'visualization' && leftVisualizationDashboardId) {
      slots.push({
        position: 'LEFT',
        kind: 'visualization',
        config: {
          visualizationDashboardId: leftVisualizationDashboardId,
        },
      });
    } else {
      slots.push({
        position: 'LEFT',
        kind: 'loans',
        config: {},
      });
    }

    // 右スロット
    if (rightSlotKind === 'pdf' && rightPdfId) {
      const pdf = pdfs?.find((p) => p.id === rightPdfId);
      slots.push({
        position: 'RIGHT',
        kind: 'pdf',
        config: {
          pdfId: rightPdfId,
          displayMode: pdf?.displayMode || 'SINGLE',
          slideInterval: pdf?.slideInterval || null,
        },
      });
    } else if (rightSlotKind === 'csv_dashboard' && rightCsvDashboardId) {
      slots.push({
        position: 'RIGHT',
        kind: 'csv_dashboard',
        config: {
          csvDashboardId: rightCsvDashboardId,
        },
      });
    } else if (rightSlotKind === 'visualization' && rightVisualizationDashboardId) {
      slots.push({
        position: 'RIGHT',
        kind: 'visualization',
        config: {
          visualizationDashboardId: rightVisualizationDashboardId,
        },
      });
    } else {
      slots.push({
        position: 'RIGHT',
        kind: 'loans',
        config: {},
      });
    }

    return {
      layout: 'SPLIT',
      slots,
    };
  }
}

export function editorStateFromPatch(
  base: SignageScheduleEditorState,
  patch: SignageScheduleEditorStatePatch
): SignageScheduleEditorState {
  return {
    ...base,
    ...patch,
    formData: patch.formData ?? base.formData,
  };
}

export function editorStateFromSchedule(
  schedule: SignageSchedule,
  base: SignageScheduleEditorState = createDefaultEditorState()
): SignageScheduleEditorState {
  return editorStateFromPatch(base, parseScheduleToEditorStatePatch(schedule));
}
