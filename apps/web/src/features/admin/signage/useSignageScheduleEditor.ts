import { useState } from 'react';

import {
  useSignageSchedulesForManagement,
  useSignageScheduleMutations,
  useSignagePdfs,
  useSignageRenderMutation,
  useSignageRenderStatus,
  useCsvDashboards,
  useVisualizationDashboards,
  useSignageScheduleEditorClients,
} from '../../../api/hooks';

import {
  buildLayoutConfigFromEditorState,
  createResetEditorStatePatch,
  createResetFullSlotSpecificFieldsPatch,
  parseScheduleToEditorStatePatch,
  type SignageFullSlotKind,
  type SignageScheduleEditorState,
  type SignageScheduleEditorStatePatch,
  type SignageSelfInspectionTargetMode,
  type SignageSplitSlotKind,
} from './signageLayoutConfigModel';
import { DEFAULT_SCHEDULE_FORM_DATA, parseResourceCdListInput } from './signageScheduleDisplay';

import type { SignageSchedule } from '../../../api/client';

function applyEditorStatePatch(
  patch: SignageScheduleEditorStatePatch,
  setters: {
    setFormData: (value: Partial<SignageSchedule>) => void;
    setUseNewLayout: (value: boolean) => void;
    setLayoutType: (value: 'FULL' | 'SPLIT') => void;
    setLeftSlotKind: (value: SignageSplitSlotKind) => void;
    setRightSlotKind: (value: SignageSplitSlotKind) => void;
    setLeftPdfId: (value: string | null) => void;
    setRightPdfId: (value: string | null) => void;
    setLeftCsvDashboardId: (value: string | null) => void;
    setRightCsvDashboardId: (value: string | null) => void;
    setLeftVisualizationDashboardId: (value: string | null) => void;
    setRightVisualizationDashboardId: (value: string | null) => void;
    setFullSlotKind: (value: SignageFullSlotKind) => void;
    setFullPdfId: (value: string | null) => void;
    setFullCsvDashboardId: (value: string | null) => void;
    setFullVisualizationDashboardId: (value: string | null) => void;
    setFullKioskDeviceScopeKey: (value: string) => void;
    setFullKioskSlideIntervalStr: (value: string) => void;
    setFullKioskSeibanPerPageStr: (value: string) => void;
    setFullLeaderOrderDeviceScopeKey: (value: string) => void;
    setFullLeaderOrderResourceCdsText: (value: string) => void;
    setFullLeaderOrderSlideIntervalStr: (value: string) => void;
    setFullLeaderOrderCardsPerPageStr: (value: string) => void;
    setFullPartsShelfMaxItemsStr: (value: string) => void;
    setFullSelfInspectionTargetMode: (value: SignageSelfInspectionTargetMode) => void;
    setFullSelfInspectionMachineName: (value: string) => void;
    setFullSelfInspectionDeviceScopeKey: (value: string) => void;
    setFullSelfInspectionResourceCdsText: (value: string) => void;
    setFullSelfInspectionMaxAutoMachinesStr: (value: string) => void;
    setFullSelfInspectionSlideIntervalStr: (value: string) => void;
    setFullSelfInspectionPartsPerPageStr: (value: string) => void;
    setFullSelfInspectionDetailTopNStr: (value: string) => void;
  }
) {
  if (patch.formData !== undefined) setters.setFormData(patch.formData);
  if (patch.useNewLayout !== undefined) setters.setUseNewLayout(patch.useNewLayout);
  if (patch.layoutType !== undefined) setters.setLayoutType(patch.layoutType);
  if (patch.leftSlotKind !== undefined) setters.setLeftSlotKind(patch.leftSlotKind);
  if (patch.rightSlotKind !== undefined) setters.setRightSlotKind(patch.rightSlotKind);
  if (patch.leftPdfId !== undefined) setters.setLeftPdfId(patch.leftPdfId);
  if (patch.rightPdfId !== undefined) setters.setRightPdfId(patch.rightPdfId);
  if (patch.leftCsvDashboardId !== undefined) setters.setLeftCsvDashboardId(patch.leftCsvDashboardId);
  if (patch.rightCsvDashboardId !== undefined) setters.setRightCsvDashboardId(patch.rightCsvDashboardId);
  if (patch.leftVisualizationDashboardId !== undefined) {
    setters.setLeftVisualizationDashboardId(patch.leftVisualizationDashboardId);
  }
  if (patch.rightVisualizationDashboardId !== undefined) {
    setters.setRightVisualizationDashboardId(patch.rightVisualizationDashboardId);
  }
  if (patch.fullSlotKind !== undefined) setters.setFullSlotKind(patch.fullSlotKind);
  if (patch.fullPdfId !== undefined) setters.setFullPdfId(patch.fullPdfId);
  if (patch.fullCsvDashboardId !== undefined) setters.setFullCsvDashboardId(patch.fullCsvDashboardId);
  if (patch.fullVisualizationDashboardId !== undefined) {
    setters.setFullVisualizationDashboardId(patch.fullVisualizationDashboardId);
  }
  if (patch.fullKioskDeviceScopeKey !== undefined) {
    setters.setFullKioskDeviceScopeKey(patch.fullKioskDeviceScopeKey);
  }
  if (patch.fullKioskSlideIntervalStr !== undefined) {
    setters.setFullKioskSlideIntervalStr(patch.fullKioskSlideIntervalStr);
  }
  if (patch.fullKioskSeibanPerPageStr !== undefined) {
    setters.setFullKioskSeibanPerPageStr(patch.fullKioskSeibanPerPageStr);
  }
  if (patch.fullLeaderOrderDeviceScopeKey !== undefined) {
    setters.setFullLeaderOrderDeviceScopeKey(patch.fullLeaderOrderDeviceScopeKey);
  }
  if (patch.fullLeaderOrderResourceCdsText !== undefined) {
    setters.setFullLeaderOrderResourceCdsText(patch.fullLeaderOrderResourceCdsText);
  }
  if (patch.fullLeaderOrderSlideIntervalStr !== undefined) {
    setters.setFullLeaderOrderSlideIntervalStr(patch.fullLeaderOrderSlideIntervalStr);
  }
  if (patch.fullLeaderOrderCardsPerPageStr !== undefined) {
    setters.setFullLeaderOrderCardsPerPageStr(patch.fullLeaderOrderCardsPerPageStr);
  }
  if (patch.fullPartsShelfMaxItemsStr !== undefined) {
    setters.setFullPartsShelfMaxItemsStr(patch.fullPartsShelfMaxItemsStr);
  }
  if (patch.fullSelfInspectionTargetMode !== undefined) {
    setters.setFullSelfInspectionTargetMode(patch.fullSelfInspectionTargetMode);
  }
  if (patch.fullSelfInspectionMachineName !== undefined) {
    setters.setFullSelfInspectionMachineName(patch.fullSelfInspectionMachineName);
  }
  if (patch.fullSelfInspectionDeviceScopeKey !== undefined) {
    setters.setFullSelfInspectionDeviceScopeKey(patch.fullSelfInspectionDeviceScopeKey);
  }
  if (patch.fullSelfInspectionResourceCdsText !== undefined) {
    setters.setFullSelfInspectionResourceCdsText(patch.fullSelfInspectionResourceCdsText);
  }
  if (patch.fullSelfInspectionMaxAutoMachinesStr !== undefined) {
    setters.setFullSelfInspectionMaxAutoMachinesStr(patch.fullSelfInspectionMaxAutoMachinesStr);
  }
  if (patch.fullSelfInspectionSlideIntervalStr !== undefined) {
    setters.setFullSelfInspectionSlideIntervalStr(patch.fullSelfInspectionSlideIntervalStr);
  }
  if (patch.fullSelfInspectionPartsPerPageStr !== undefined) {
    setters.setFullSelfInspectionPartsPerPageStr(patch.fullSelfInspectionPartsPerPageStr);
  }
  if (patch.fullSelfInspectionDetailTopNStr !== undefined) {
    setters.setFullSelfInspectionDetailTopNStr(patch.fullSelfInspectionDetailTopNStr);
  }
}

export function useSignageScheduleEditor() {
  const schedulesQuery = useSignageSchedulesForManagement();
  const clientsForSignageQuery = useSignageScheduleEditorClients();
  const pdfsQuery = useSignagePdfs();
  const csvDashboardsQuery = useCsvDashboards({ enabled: true });
  /** サイネージ割当用: 無効なダッシュボードも表示（ラベルで区別）。未作成のパレット用は optgroup が空になる。 */
  const visualizationDashboardsQuery = useVisualizationDashboards();
  const { create, update, remove } = useSignageScheduleMutations();
  const renderMutation = useSignageRenderMutation();
  const renderStatusQuery = useSignageRenderStatus();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<SignageSchedule>>(DEFAULT_SCHEDULE_FORM_DATA);
  const [useNewLayout, setUseNewLayout] = useState(false); // 新形式を使用するか
  const [layoutType, setLayoutType] = useState<'FULL' | 'SPLIT'>('FULL'); // レイアウトタイプ
  const [leftSlotKind, setLeftSlotKind] = useState<'loans' | 'pdf' | 'csv_dashboard' | 'visualization'>('loans'); // 左スロットの種類
  const [rightSlotKind, setRightSlotKind] = useState<'loans' | 'pdf' | 'csv_dashboard' | 'visualization'>('pdf'); // 右スロットの種類
  const [leftPdfId, setLeftPdfId] = useState<string | null>(null); // 左スロットのPDF（kind='pdf'の場合）
  const [rightPdfId, setRightPdfId] = useState<string | null>(null); // 右スロットのPDF（kind='pdf'の場合）
  const [leftCsvDashboardId, setLeftCsvDashboardId] = useState<string | null>(null); // 左スロットのCSVダッシュボード（kind='csv_dashboard'の場合）
  const [rightCsvDashboardId, setRightCsvDashboardId] = useState<string | null>(null); // 右スロットのCSVダッシュボード（kind='csv_dashboard'の場合）
  const [leftVisualizationDashboardId, setLeftVisualizationDashboardId] = useState<string | null>(null); // 左スロットの可視化（kind='visualization'の場合）
  const [rightVisualizationDashboardId, setRightVisualizationDashboardId] = useState<string | null>(null); // 右スロットの可視化（kind='visualization'の場合）
  const [fullSlotKind, setFullSlotKind] = useState<
    | 'loans'
    | 'pdf'
    | 'csv_dashboard'
    | 'visualization'
    | 'kiosk_progress_overview'
    | 'kiosk_leader_order_cards'
    | 'mobile_placement_parts_shelf_grid'
    | 'self_inspection_machine_board'
  >('loans'); // 全体スロットの種類
  const [fullPdfId, setFullPdfId] = useState<string | null>(null); // 全体スロットのPDF（kind='pdf'の場合）
  const [fullCsvDashboardId, setFullCsvDashboardId] = useState<string | null>(null); // 全体スロットのCSVダッシュボード（kind='csv_dashboard'の場合）
  const [fullVisualizationDashboardId, setFullVisualizationDashboardId] = useState<string | null>(null); // 全体スロットの可視化（kind='visualization'の場合）
  const [fullKioskDeviceScopeKey, setFullKioskDeviceScopeKey] = useState('');
  const [fullKioskSlideIntervalStr, setFullKioskSlideIntervalStr] = useState('');
  const [fullKioskSeibanPerPageStr, setFullKioskSeibanPerPageStr] = useState('');
  const [fullLeaderOrderDeviceScopeKey, setFullLeaderOrderDeviceScopeKey] = useState('');
  const [fullLeaderOrderResourceCdsText, setFullLeaderOrderResourceCdsText] = useState('');
  const [fullLeaderOrderSlideIntervalStr, setFullLeaderOrderSlideIntervalStr] = useState('');
  const [fullLeaderOrderCardsPerPageStr, setFullLeaderOrderCardsPerPageStr] = useState('');
  const [fullPartsShelfMaxItemsStr, setFullPartsShelfMaxItemsStr] = useState('');
  const [fullSelfInspectionTargetMode, setFullSelfInspectionTargetMode] = useState<
    'manual_machine_name' | 'auto_from_leaderboard_status'
  >('manual_machine_name');
  const [fullSelfInspectionMachineName, setFullSelfInspectionMachineName] = useState('');
  const [fullSelfInspectionDeviceScopeKey, setFullSelfInspectionDeviceScopeKey] = useState('');
  const [fullSelfInspectionResourceCdsText, setFullSelfInspectionResourceCdsText] = useState('');
  const [fullSelfInspectionMaxAutoMachinesStr, setFullSelfInspectionMaxAutoMachinesStr] = useState('');
  const [fullSelfInspectionSlideIntervalStr, setFullSelfInspectionSlideIntervalStr] = useState('');
  const [fullSelfInspectionPartsPerPageStr, setFullSelfInspectionPartsPerPageStr] = useState('');
  const [fullSelfInspectionDetailTopNStr, setFullSelfInspectionDetailTopNStr] = useState('');

  const editorSetters = {
    setFormData,
    setUseNewLayout,
    setLayoutType,
    setLeftSlotKind,
    setRightSlotKind,
    setLeftPdfId,
    setRightPdfId,
    setLeftCsvDashboardId,
    setRightCsvDashboardId,
    setLeftVisualizationDashboardId,
    setRightVisualizationDashboardId,
    setFullSlotKind,
    setFullPdfId,
    setFullCsvDashboardId,
    setFullVisualizationDashboardId,
    setFullKioskDeviceScopeKey,
    setFullKioskSlideIntervalStr,
    setFullKioskSeibanPerPageStr,
    setFullLeaderOrderDeviceScopeKey,
    setFullLeaderOrderResourceCdsText,
    setFullLeaderOrderSlideIntervalStr,
    setFullLeaderOrderCardsPerPageStr,
    setFullPartsShelfMaxItemsStr,
    setFullSelfInspectionTargetMode,
    setFullSelfInspectionMachineName,
    setFullSelfInspectionDeviceScopeKey,
    setFullSelfInspectionResourceCdsText,
    setFullSelfInspectionMaxAutoMachinesStr,
    setFullSelfInspectionSlideIntervalStr,
    setFullSelfInspectionPartsPerPageStr,
    setFullSelfInspectionDetailTopNStr,
  };

  const resetFullSlotSpecificFields = () => {
    applyEditorStatePatch(createResetFullSlotSpecificFieldsPatch(), editorSetters);
  };

  const resetEditorState = () => {
    applyEditorStatePatch(createResetEditorStatePatch(), editorSetters);
  };

  const getEditorState = (): SignageScheduleEditorState => ({
    formData,
    useNewLayout,
    layoutType,
    leftSlotKind,
    rightSlotKind,
    leftPdfId,
    rightPdfId,
    leftCsvDashboardId,
    rightCsvDashboardId,
    leftVisualizationDashboardId,
    rightVisualizationDashboardId,
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
  });

  const handleCreate = () => {
    setIsCreating(true);
    resetEditorState();
  };

  const handleEdit = (schedule: SignageSchedule) => {
    setEditingId(schedule.id);
    applyEditorStatePatch(parseScheduleToEditorStatePatch(schedule), editorSetters);
  };

  const buildLayoutConfig = () => buildLayoutConfigFromEditorState(getEditorState(), pdfsQuery.data);

  const handleSave = async () => {
    if (useNewLayout && layoutType === 'FULL' && fullSlotKind === 'self_inspection_machine_board') {
      if (
        fullSelfInspectionTargetMode === 'manual_machine_name' &&
        fullSelfInspectionMachineName.trim() === ''
      ) {
        alert('手入力モードでは機種名（machineName）が必須です。');
        return;
      }
      if (fullSelfInspectionTargetMode === 'auto_from_leaderboard_status') {
        if (fullSelfInspectionDeviceScopeKey.trim() === '') {
          alert('自動選定モードでは deviceScopeKey が必須です。');
          return;
        }
        if (parseResourceCdListInput(fullSelfInspectionResourceCdsText).length === 0) {
          alert('自動選定モードでは resourceCds が必須です。');
          return;
        }
      }
    }

    try {
      const layoutConfig = buildLayoutConfig();

      // 後方互換のため、contentTypeとpdfIdも設定（layoutConfigがない場合に使用）
      let contentType = formData.contentType!;
      let pdfId = formData.pdfId ?? null;

      if (layoutConfig) {
        // 新形式を使用する場合、contentTypeとpdfIdをlayoutConfigから推論
        if (layoutConfig.layout === 'FULL') {
          const slot = layoutConfig.slots[0];
          if (slot.kind === 'pdf') {
            contentType = 'PDF';
            pdfId = (slot.config as { pdfId: string }).pdfId;
          } else {
            contentType = 'TOOLS';
            pdfId = null;
          }
        } else {
          contentType = 'SPLIT';
          const pdfSlot = layoutConfig.slots.find((s) => s.kind === 'pdf');
          pdfId = pdfSlot ? (pdfSlot.config as { pdfId: string }).pdfId : null;
        }
      }

      if (isCreating) {
        await create.mutateAsync({
          name: formData.name!,
          contentType,
          pdfId,
          layoutConfig,
          targetClientKeys: formData.targetClientKeys?.length ? formData.targetClientKeys : [],
          dayOfWeek: formData.dayOfWeek!,
          startTime: formData.startTime!,
          endTime: formData.endTime!,
          priority: formData.priority!,
          enabled: formData.enabled ?? true,
        });
        setIsCreating(false);
      } else if (editingId) {
        const targetClientKeys = formData.targetClientKeys?.length ? formData.targetClientKeys : [];
        await update.mutateAsync({
          id: editingId,
          payload: {
            name: formData.name,
            contentType,
            pdfId,
            layoutConfig,
            dayOfWeek: formData.dayOfWeek,
            startTime: formData.startTime,
            endTime: formData.endTime,
            priority: formData.priority,
            enabled: formData.enabled,
            targetClientKeys,
          },
        });
        setEditingId(null);
      }

      resetEditorState();
    } catch (error) {
      console.error('Failed to save schedule:', error);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    resetEditorState();
  };

  const handleDelete = async (id: string) => {
    if (confirm('このスケジュールを削除しますか？')) {
      await remove.mutateAsync(id);
    }
  };

  const toggleDayOfWeek = (day: number) => {
    const currentDays = formData.dayOfWeek || [];
    if (currentDays.includes(day)) {
      setFormData({ ...formData, dayOfWeek: currentDays.filter((d) => d !== day) });
    } else {
      setFormData({ ...formData, dayOfWeek: [...currentDays, day] });
    }
  };

  const handleRender = async () => {
    try {
      await renderMutation.mutateAsync();
      alert('サイネージの再レンダリングを開始しました');
    } catch (error) {
      console.error('Failed to render signage:', error);
      alert('サイネージの再レンダリングに失敗しました');
    }
  };

  return {
    schedulesQuery,
    clientsForSignageQuery,
    pdfsQuery,
    csvDashboardsQuery,
    visualizationDashboardsQuery,
    create,
    update,
    renderMutation,
    renderStatusQuery,
    isCreating,
    editingId,
    formData,
    setFormData,
    useNewLayout,
    setUseNewLayout,
    layoutType,
    setLayoutType,
    leftSlotKind,
    setLeftSlotKind,
    rightSlotKind,
    setRightSlotKind,
    leftPdfId,
    setLeftPdfId,
    rightPdfId,
    setRightPdfId,
    leftCsvDashboardId,
    setLeftCsvDashboardId,
    rightCsvDashboardId,
    setRightCsvDashboardId,
    leftVisualizationDashboardId,
    setLeftVisualizationDashboardId,
    rightVisualizationDashboardId,
    setRightVisualizationDashboardId,
    fullSlotKind,
    setFullSlotKind,
    fullPdfId,
    setFullPdfId,
    fullCsvDashboardId,
    setFullCsvDashboardId,
    fullVisualizationDashboardId,
    setFullVisualizationDashboardId,
    fullKioskDeviceScopeKey,
    setFullKioskDeviceScopeKey,
    fullKioskSlideIntervalStr,
    setFullKioskSlideIntervalStr,
    fullKioskSeibanPerPageStr,
    setFullKioskSeibanPerPageStr,
    fullLeaderOrderDeviceScopeKey,
    setFullLeaderOrderDeviceScopeKey,
    fullLeaderOrderResourceCdsText,
    setFullLeaderOrderResourceCdsText,
    fullLeaderOrderSlideIntervalStr,
    setFullLeaderOrderSlideIntervalStr,
    fullLeaderOrderCardsPerPageStr,
    setFullLeaderOrderCardsPerPageStr,
    fullPartsShelfMaxItemsStr,
    setFullPartsShelfMaxItemsStr,
    fullSelfInspectionTargetMode,
    setFullSelfInspectionTargetMode,
    fullSelfInspectionMachineName,
    setFullSelfInspectionMachineName,
    fullSelfInspectionDeviceScopeKey,
    setFullSelfInspectionDeviceScopeKey,
    fullSelfInspectionResourceCdsText,
    setFullSelfInspectionResourceCdsText,
    fullSelfInspectionMaxAutoMachinesStr,
    setFullSelfInspectionMaxAutoMachinesStr,
    fullSelfInspectionSlideIntervalStr,
    setFullSelfInspectionSlideIntervalStr,
    fullSelfInspectionPartsPerPageStr,
    setFullSelfInspectionPartsPerPageStr,
    fullSelfInspectionDetailTopNStr,
    setFullSelfInspectionDetailTopNStr,
    resetFullSlotSpecificFields,
    handleCreate,
    handleEdit,
    handleSave,
    handleCancel,
    handleDelete,
    toggleDayOfWeek,
    handleRender,
  };
}

export type SignageScheduleEditorController = ReturnType<typeof useSignageScheduleEditor>;
