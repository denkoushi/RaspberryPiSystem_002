import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getToolsPalletVisualizationBoard } from '../../../api/client';
import {
  useCsvDashboards,
  useVisualizationDashboard,
  useVisualizationDashboardMutations,
  useVisualizationDashboards,
} from '../../../api/hooks';

import {
  buildSavePayload,
  clearPalletVizTargets,
  computeIsDirty,
  extractCsvDashboardId,
  extractPalletVizSelectedMachineSet,
  setCsvDashboardId,
  togglePalletVizMachine,
} from './visualizationDashboardFormModel';
import {
  buildMeasuringInspectionPresetFields,
  buildPalletVisualizationPresetFields,
  buildRiggingInspectionPresetFields,
  buildUninspectedPresetFields,
  DEFAULT_JSON,
  MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  PALLET_VIZ_DATA_SOURCE_TYPE,
  RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  UNINSPECTED_DATA_SOURCE_TYPE,
} from './visualizationDashboardPresets';

export function useVisualizationDashboardEditor() {
  const dashboardsQuery = useVisualizationDashboards();
  const csvDashboardsQuery = useCsvDashboards();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedDashboardQuery = useVisualizationDashboard(selectedId);
  const { create, update, remove } = useVisualizationDashboardMutations();

  const dashboards = dashboardsQuery.data ?? [];
  const csvDashboards = csvDashboardsQuery.data ?? [];
  const selected = selectedDashboardQuery.data ?? null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataSourceType, setDataSourceType] = useState('');
  const [rendererType, setRendererType] = useState('');
  const [dataSourceConfig, setDataSourceConfig] = useState(DEFAULT_JSON);
  const [rendererConfig, setRendererConfig] = useState(DEFAULT_JSON);
  const [enabled, setEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(selectedId) && !isCreating;
  const isUninspectedPreset = dataSourceType.trim() === UNINSPECTED_DATA_SOURCE_TYPE;
  const isMeasuringInspectionPreset = dataSourceType.trim() === MI_LOAN_INSPECTION_DATA_SOURCE_TYPE;
  const isRiggingInspectionPreset = dataSourceType.trim() === RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE;
  const isPalletVizPreset = dataSourceType.trim() === PALLET_VIZ_DATA_SOURCE_TYPE;

  const palletVizBoardQuery = useQuery({
    queryKey: ['tools-pallet-viz-board'],
    queryFn: () => getToolsPalletVisualizationBoard(),
    enabled: isPalletVizPreset,
  });

  const currentCsvDashboardId = useMemo(() => {
    if (!isUninspectedPreset) return '';
    return extractCsvDashboardId(dataSourceConfig);
  }, [dataSourceConfig, isUninspectedPreset]);

  const handleCsvDashboardIdChange = (csvDashboardId: string) => {
    setDataSourceConfig(setCsvDashboardId(dataSourceConfig, csvDashboardId));
  };

  const palletVizMachinesInOrder = useMemo(
    () =>
      palletVizBoardQuery.data?.machines
        ?.map((m) => m.machineCd.trim().toUpperCase())
        .filter(Boolean) ?? [],
    [palletVizBoardQuery.data?.machines],
  );

  const palletVizSelectedMachineSet = useMemo(
    () => extractPalletVizSelectedMachineSet(dataSourceConfig, isPalletVizPreset),
    [dataSourceConfig, isPalletVizPreset],
  );

  const handlePalletVizMachineToggle = (machineCdRaw: string) => {
    setDataSourceConfig(
      togglePalletVizMachine(
        dataSourceConfig,
        machineCdRaw,
        palletVizSelectedMachineSet,
        palletVizMachinesInOrder,
      ),
    );
  };

  const handlePalletVizClearTargets = () => {
    setDataSourceConfig(clearPalletVizTargets(dataSourceConfig));
  };

  useEffect(() => {
    if (!isEditing || !selected) return;
    setName(selected.name ?? '');
    setDescription(selected.description ?? '');
    setDataSourceType(selected.dataSourceType ?? '');
    setRendererType(selected.rendererType ?? '');
    setDataSourceConfig(JSON.stringify(selected.dataSourceConfig ?? {}, null, 2));
    setRendererConfig(JSON.stringify(selected.rendererConfig ?? {}, null, 2));
    setEnabled(Boolean(selected.enabled));
    setFormError(null);
  }, [isEditing, selected]);

  useEffect(() => {
    if (!isCreating) return;
    setSelectedId(null);
    setName('');
    setDescription('');
    setDataSourceType('');
    setRendererType('');
    setDataSourceConfig(DEFAULT_JSON);
    setRendererConfig(DEFAULT_JSON);
    setEnabled(true);
    setFormError(null);
  }, [isCreating]);

  const isDirty = useMemo(
    () =>
      computeIsDirty({
        isCreating,
        name,
        description,
        dataSourceType,
        rendererType,
        dataSourceConfig,
        rendererConfig,
        enabled,
        selected,
      }),
    [dataSourceConfig, description, enabled, isCreating, name, rendererConfig, rendererType, selected, dataSourceType],
  );

  const handleSave = async () => {
    setFormError(null);
    const result = buildSavePayload({
      name,
      description,
      dataSourceType,
      rendererType,
      dataSourceConfig,
      rendererConfig,
      enabled,
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    if (isCreating) {
      await create.mutateAsync(result.payload);
      setIsCreating(false);
      return;
    }

    if (!selectedId) {
      setFormError('編集対象が選択されていません。');
      return;
    }

    await update.mutateAsync({
      id: selectedId,
      payload: result.payload,
    });
  };

  const handleDelete = async () => {
    if (!selectedId || !selected) return;
    if (!confirm(`可視化ダッシュボード「${selected.name}」を削除しますか？`)) return;
    await remove.mutateAsync(selectedId);
    setSelectedId(null);
  };

  const applyPresetFields = (fields: ReturnType<typeof buildUninspectedPresetFields>) => {
    setDataSourceType(fields.dataSourceType);
    setRendererType(fields.rendererType);
    setDataSourceConfig(fields.dataSourceConfig);
    setRendererConfig(fields.rendererConfig);
    setName(fields.name);
    setDescription(fields.description);
    setFormError(null);
  };

  const applyUninspectedPreset = () => {
    applyPresetFields(buildUninspectedPresetFields(name, description));
  };

  const applyMeasuringInspectionPreset = () => {
    applyPresetFields(buildMeasuringInspectionPresetFields(name, description));
  };

  const applyRiggingInspectionPreset = () => {
    applyPresetFields(buildRiggingInspectionPresetFields(name, description));
  };

  const applyPalletVisualizationPreset = () => {
    applyPresetFields(buildPalletVisualizationPresetFields(name, description));
  };

  const handleSelectChange = (id: string | null) => {
    setIsCreating(false);
    setSelectedId(id);
  };

  return {
    dashboardsQuery,
    csvDashboardsQuery,
    selectedDashboardQuery,
    create,
    update,
    remove,
    dashboards,
    csvDashboards,
    selected,
    selectedId,
    setSelectedId,
    isCreating,
    setIsCreating,
    name,
    setName,
    description,
    setDescription,
    dataSourceType,
    setDataSourceType,
    rendererType,
    setRendererType,
    dataSourceConfig,
    setDataSourceConfig,
    rendererConfig,
    setRendererConfig,
    enabled,
    setEnabled,
    formError,
    isEditing,
    isUninspectedPreset,
    isMeasuringInspectionPreset,
    isRiggingInspectionPreset,
    isPalletVizPreset,
    palletVizBoardQuery,
    currentCsvDashboardId,
    handleCsvDashboardIdChange,
    palletVizSelectedMachineSet,
    handlePalletVizMachineToggle,
    handlePalletVizClearTargets,
    isDirty,
    handleSave,
    handleDelete,
    applyUninspectedPreset,
    applyMeasuringInspectionPreset,
    applyRiggingInspectionPreset,
    applyPalletVisualizationPreset,
    handleSelectChange,
  };
}

export type VisualizationDashboardEditor = ReturnType<typeof useVisualizationDashboardEditor>;
