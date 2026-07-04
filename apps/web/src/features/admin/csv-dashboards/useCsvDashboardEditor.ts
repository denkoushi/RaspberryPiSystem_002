import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  createCsvDashboard,
  getCsvDashboard,
  getCsvDashboards,
  previewCsvDashboardParse,
  updateCsvDashboard,
  uploadCsvToDashboard,
  type CsvDashboard,
  type CsvPreviewResult,
} from '../../../api/client';

import {
  applyDisplayNameChange,
  buildUpdatePayload,
  normalizeColumnDefinitions,
  parseCsvHeaderCandidatesInput,
  syncFormFromDashboard,
} from './csvDashboardFormModel';
import {
  buildMachineDailyInspectionPreset,
  MACHINE_DAILY_INSPECTION_DASHBOARD_NAME,
} from './csvDashboardPresets';

export function useCsvDashboardEditor() {
  const queryClient = useQueryClient();
  const dashboardsQuery = useQuery({
    queryKey: ['csv-dashboards', { enabled: true }],
    queryFn: () => getCsvDashboards({ enabled: true }),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedDashboardQuery = useQuery({
    queryKey: ['csv-dashboard', selectedId],
    queryFn: () => getCsvDashboard(selectedId!),
    enabled: Boolean(selectedId),
  });

  const selected = selectedDashboardQuery.data ?? null;

  const [displayPeriodDays, setDisplayPeriodDays] = useState<number>(1);
  const [dateColumnName, setDateColumnName] = useState<string>('');
  const [emptyMessage, setEmptyMessage] = useState<string>('');
  const [gmailSubjectPattern, setGmailSubjectPattern] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [columnDefinitions, setColumnDefinitions] = useState<CsvDashboard['columnDefinitions']>([]);
  const [columnDefinitionError, setColumnDefinitionError] = useState<string | null>(null);
  const [templateConfigError, setTemplateConfigError] = useState<string | null>(null);
  const [previewCsvContent, setPreviewCsvContent] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<CsvPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [tableRowsPerPage, setTableRowsPerPage] = useState<number>(50);
  const [tableFontSize, setTableFontSize] = useState<number>(14);
  const [tableDisplayColumns, setTableDisplayColumns] = useState<string[]>([]);
  const [manualColumnWidths, setManualColumnWidths] = useState<boolean>(false);
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<string, number>>({});
  const [addDisplayColumn, setAddDisplayColumn] = useState<string>('');

  useEffect(() => {
    if (!selected) return;
    const synced = syncFormFromDashboard(selected);
    setDisplayPeriodDays(synced.displayPeriodDays);
    setDateColumnName(synced.dateColumnName);
    setEmptyMessage(synced.emptyMessage);
    setGmailSubjectPattern(synced.gmailSubjectPattern);
    setEnabled(synced.enabled);
    setColumnDefinitions(synced.columnDefinitions);
    setColumnDefinitionError(synced.columnDefinitionError);
    setTemplateConfigError(synced.templateConfigError);
    setPreviewCsvContent(synced.previewCsvContent);
    setPreviewResult(synced.previewResult);
    setPreviewError(synced.previewError);
    setTableRowsPerPage(synced.tableRowsPerPage);
    setTableFontSize(synced.tableFontSize);
    setTableDisplayColumns(synced.tableDisplayColumns);
    setTableColumnWidths(synced.tableColumnWidths);
    setManualColumnWidths(synced.manualColumnWidths);
    setAddDisplayColumn(synced.addDisplayColumn);
  }, [selected]);

  const normalizedColumnDefinitions = useMemo(
    () => normalizeColumnDefinitions(columnDefinitions),
    [columnDefinitions]
  );

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('CSVダッシュボードが選択されていません');

      const result = buildUpdatePayload({
        selected,
        normalizedColumnDefinitions,
        displayPeriodDays,
        dateColumnName,
        emptyMessage,
        gmailSubjectPattern,
        enabled,
        tableDisplayColumns,
        tableFontSize,
        tableRowsPerPage,
        manualColumnWidths,
        tableColumnWidths,
      });

      if (!result.ok) {
        if (result.errorField === 'columnDefinition') {
          setColumnDefinitionError(result.message);
        } else {
          setTemplateConfigError(result.message);
        }
        throw new Error(result.message);
      }

      return updateCsvDashboard(selectedId, result.payload);
    },
    onSuccess: async (dashboard) => {
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboard', dashboard.id] });
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboards'] });
    },
  });

  const createInspectionDashboardMutation = useMutation({
    mutationFn: async () => {
      const dashboards = dashboardsQuery.data ?? [];
      const existing = dashboards.find((d) => d.name === MACHINE_DAILY_INSPECTION_DASHBOARD_NAME);
      if (existing) {
        return existing;
      }
      return await createCsvDashboard(buildMachineDailyInspectionPreset());
    },
    onSuccess: async (dashboard) => {
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboards'] });
      setSelectedId(dashboard.id);
    },
  });

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('CSVダッシュボードが選択されていません');
      if (!uploadFile) throw new Error('CSVファイルが選択されていません');
      return uploadCsvToDashboard(selectedId, uploadFile);
    },
    onSuccess: async () => {
      setUploadFile(null);
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboard', selectedId] });
      await queryClient.invalidateQueries({ queryKey: ['signage-content'] });
    },
  });

  const dashboards = dashboardsQuery.data ?? [];
  const previewHeaders = previewResult?.headers ?? [];
  const unmatchedHeaders = previewHeaders.filter((header) =>
    normalizedColumnDefinitions.every((col) => !col.csvHeaderCandidates.includes(header))
  );

  const handlePreviewFileChange = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewCsvContent(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  const handlePreviewParse = async () => {
    if (!selectedId) return;
    if (!previewCsvContent.trim()) {
      setPreviewError('CSV内容が空です。');
      setPreviewResult(null);
      return;
    }
    try {
      setPreviewError(null);
      const result = await previewCsvDashboardParse(selectedId, previewCsvContent);
      setPreviewResult(result);
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(error instanceof Error ? error.message : 'プレビュー解析に失敗しました。');
    }
  };

  const handleDisplayNameChange = (index: number, value: string) => {
    setColumnDefinitions((prev) => applyDisplayNameChange(prev, index, value));
  };

  const handleCsvHeaderCandidatesChange = (index: number, input: string) => {
    const candidates = parseCsvHeaderCandidatesInput(input);
    setColumnDefinitions((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, csvHeaderCandidates: candidates } : item))
    );
  };

  const handleRequiredChange = (index: number, checked: boolean) => {
    setColumnDefinitions((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, required: checked } : item))
    );
  };

  const handleMoveColumnDefinitionUp = (index: number) => {
    if (index === 0) return;
    setColumnDefinitions((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveColumnDefinitionDown = (index: number) => {
    if (index === normalizedColumnDefinitions.length - 1) return;
    setColumnDefinitions((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleAddDisplayColumn = () => {
    if (!addDisplayColumn) return;
    setTableDisplayColumns((prev) => [...prev, addDisplayColumn]);
    setAddDisplayColumn('');
  };

  const handleResetDisplayColumns = () => {
    setTableDisplayColumns(normalizedColumnDefinitions.map((c) => c.internalName));
  };

  const handleMoveDisplayColumnUp = (index: number) => {
    if (index === 0) return;
    setTableDisplayColumns((prev) => {
      const next = [...prev];
      const tmp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = tmp;
      return next;
    });
  };

  const handleMoveDisplayColumnDown = (index: number) => {
    if (index === tableDisplayColumns.length - 1) return;
    setTableDisplayColumns((prev) => {
      const next = [...prev];
      const tmp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = tmp;
      return next;
    });
  };

  const handleRemoveDisplayColumn = (internalName: string) => {
    setTableDisplayColumns((prev) => prev.filter((c) => c !== internalName));
    setTableColumnWidths((prev) => {
      if (!(internalName in prev)) return prev;
      const next = { ...prev };
      delete next[internalName];
      return next;
    });
  };

  const handleManualColumnWidthsChange = (checked: boolean) => {
    setManualColumnWidths(checked);
    if (!checked) {
      setTableColumnWidths({});
    }
  };

  const handleColumnWidthChange = (internalName: string, rawValue: string) => {
    const n = Number(rawValue);
    setTableColumnWidths((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(n) || n <= 0) {
        delete next[internalName];
        return next;
      }
      next[internalName] = n;
      return next;
    });
  };

  return {
    dashboardsQuery,
    selectedDashboardQuery,
    selectedId,
    setSelectedId,
    selected,
    dashboards,
    displayPeriodDays,
    setDisplayPeriodDays,
    dateColumnName,
    setDateColumnName,
    emptyMessage,
    setEmptyMessage,
    gmailSubjectPattern,
    setGmailSubjectPattern,
    enabled,
    setEnabled,
    columnDefinitions,
    setColumnDefinitions,
    columnDefinitionError,
    templateConfigError,
    previewCsvContent,
    setPreviewCsvContent,
    previewResult,
    previewError,
    tableRowsPerPage,
    setTableRowsPerPage,
    tableFontSize,
    setTableFontSize,
    tableDisplayColumns,
    setTableDisplayColumns,
    manualColumnWidths,
    tableColumnWidths,
    setTableColumnWidths,
    addDisplayColumn,
    setAddDisplayColumn,
    normalizedColumnDefinitions,
    previewHeaders,
    unmatchedHeaders,
    updateMutation,
    createInspectionDashboardMutation,
    uploadFile,
    setUploadFile,
    uploadMutation,
    handlePreviewFileChange,
    handlePreviewParse,
    handleDisplayNameChange,
    handleCsvHeaderCandidatesChange,
    handleRequiredChange,
    handleMoveColumnDefinitionUp,
    handleMoveColumnDefinitionDown,
    handleAddDisplayColumn,
    handleResetDisplayColumns,
    handleMoveDisplayColumnUp,
    handleMoveDisplayColumnDown,
    handleRemoveDisplayColumn,
    handleManualColumnWidthsChange,
    handleColumnWidthChange,
  };
}

export type CsvDashboardEditor = ReturnType<typeof useCsvDashboardEditor>;
