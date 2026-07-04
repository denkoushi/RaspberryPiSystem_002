import type { CsvDashboard } from '../../../api/client';

export type CsvDashboardTableFormState = {
  tableRowsPerPage: number;
  tableFontSize: number;
  tableDisplayColumns: string[];
  manualColumnWidths: boolean;
  tableColumnWidths: Record<string, number>;
  addDisplayColumn: string;
};

export type CsvDashboardFormSyncResult = {
  displayPeriodDays: number;
  dateColumnName: string;
  emptyMessage: string;
  gmailSubjectPattern: string;
  enabled: boolean;
  columnDefinitions: CsvDashboard['columnDefinitions'];
  columnDefinitionError: null;
  templateConfigError: null;
  previewCsvContent: string;
  previewResult: null;
  previewError: null;
} & CsvDashboardTableFormState;

export type BuildUpdatePayloadInput = {
  selected: CsvDashboard | null;
  normalizedColumnDefinitions: CsvDashboard['columnDefinitions'];
  displayPeriodDays: number;
  dateColumnName: string;
  emptyMessage: string;
  gmailSubjectPattern: string;
  enabled: boolean;
  tableDisplayColumns: string[];
  tableFontSize: number;
  tableRowsPerPage: number;
  manualColumnWidths: boolean;
  tableColumnWidths: Record<string, number>;
};

export type BuildUpdatePayloadSuccess = {
  ok: true;
  payload: Partial<
    Pick<
      CsvDashboard,
      | 'displayPeriodDays'
      | 'dateColumnName'
      | 'emptyMessage'
      | 'gmailSubjectPattern'
      | 'enabled'
      | 'columnDefinitions'
      | 'templateType'
      | 'templateConfig'
    >
  >;
};

export type BuildUpdatePayloadFailure = {
  ok: false;
  errorField: 'columnDefinition' | 'templateConfig';
  message: string;
};

export type BuildUpdatePayloadResult = BuildUpdatePayloadSuccess | BuildUpdatePayloadFailure;

export function normalizeColumnDefinitions(
  columnDefinitions: CsvDashboard['columnDefinitions']
): CsvDashboard['columnDefinitions'] {
  return columnDefinitions.map((col, index) => ({ ...col, order: index }));
}

export function validateColumnDefinitions(columns: CsvDashboard['columnDefinitions']): string | null {
  if (columns.length === 0) {
    return '列定義が空です。';
  }
  for (const col of columns) {
    if (!col.displayName?.trim()) {
      return '表示名が空の列があります。';
    }
    if (!col.csvHeaderCandidates || col.csvHeaderCandidates.length === 0) {
      return `CSVヘッダー候補が空の列があります（${col.internalName}）。`;
    }
  }
  return null;
}

function parseTableTemplateConfig(
  templateConfig: Record<string, unknown>,
  sortedColumns: CsvDashboard['columnDefinitions']
): CsvDashboardTableFormState {
  const rowsPerPage = Number(templateConfig.rowsPerPage ?? 50);
  const fontSize = Number(templateConfig.fontSize ?? 14);
  const displayColumns = Array.isArray(templateConfig.displayColumns)
    ? (templateConfig.displayColumns as unknown[])
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : sortedColumns.map((c) => c.internalName);

  const rawWidths = templateConfig.columnWidths as unknown;
  const parsedWidths: Record<string, number> = {};
  if (rawWidths && typeof rawWidths === 'object' && !Array.isArray(rawWidths)) {
    for (const [k, v] of Object.entries(rawWidths as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (k && Number.isFinite(n) && n > 0) {
        parsedWidths[k] = n;
      }
    }
  }

  return {
    tableRowsPerPage: Number.isFinite(rowsPerPage) && rowsPerPage > 0 ? rowsPerPage : 50,
    tableFontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 14,
    tableDisplayColumns: displayColumns,
    tableColumnWidths: parsedWidths,
    manualColumnWidths: Object.keys(parsedWidths).length > 0,
    addDisplayColumn: '',
  };
}

function defaultTableFormState(): CsvDashboardTableFormState {
  return {
    tableRowsPerPage: 50,
    tableFontSize: 14,
    tableDisplayColumns: [],
    tableColumnWidths: {},
    manualColumnWidths: false,
    addDisplayColumn: '',
  };
}

export function syncFormFromDashboard(selected: CsvDashboard): CsvDashboardFormSyncResult {
  const sortedColumns = [...(selected.columnDefinitions ?? [])].sort((a, b) => a.order - b.order);
  const columnDefinitions = sortedColumns.map((col, index) => ({ ...col, order: index }));

  const base = {
    displayPeriodDays: selected.displayPeriodDays ?? 1,
    dateColumnName: selected.dateColumnName ?? '',
    emptyMessage: selected.emptyMessage ?? '',
    gmailSubjectPattern: selected.gmailSubjectPattern ?? '',
    enabled: Boolean(selected.enabled),
    columnDefinitions,
    columnDefinitionError: null,
    templateConfigError: null,
    previewCsvContent: '',
    previewResult: null,
    previewError: null,
  };

  const templateConfig = (selected.templateConfig ?? {}) as Record<string, unknown>;
  const templateType = selected.templateType;
  if (templateType === 'TABLE') {
    return {
      ...base,
      ...parseTableTemplateConfig(templateConfig, sortedColumns),
    };
  }

  return {
    ...base,
    ...defaultTableFormState(),
  };
}

export function buildUpdatePayload(input: BuildUpdatePayloadInput): BuildUpdatePayloadResult {
  const validationError = validateColumnDefinitions(input.normalizedColumnDefinitions);
  if (validationError) {
    return { ok: false, errorField: 'columnDefinition', message: validationError };
  }

  if (input.selected?.templateType === 'TABLE') {
    if (input.tableDisplayColumns.length === 0) {
      return {
        ok: false,
        errorField: 'templateConfig',
        message: 'サイネージ表示列が0件です。最低1列は選択してください。',
      };
    }
    if (!Number.isFinite(input.tableFontSize) || input.tableFontSize < 10 || input.tableFontSize > 48) {
      return {
        ok: false,
        errorField: 'templateConfig',
        message: 'フォントサイズは10〜48の範囲で指定してください。',
      };
    }
    if (!Number.isFinite(input.tableRowsPerPage) || input.tableRowsPerPage < 1 || input.tableRowsPerPage > 200) {
      return {
        ok: false,
        errorField: 'templateConfig',
        message: '行数は1〜200の範囲で指定してください。',
      };
    }
  }

  return {
    ok: true,
    payload: {
      displayPeriodDays: input.displayPeriodDays,
      dateColumnName: input.dateColumnName.length > 0 ? input.dateColumnName : null,
      emptyMessage: input.emptyMessage.length > 0 ? input.emptyMessage : null,
      gmailSubjectPattern: input.gmailSubjectPattern.length > 0 ? input.gmailSubjectPattern : null,
      enabled: input.enabled,
      columnDefinitions: input.normalizedColumnDefinitions,
      ...(input.selected?.templateType === 'TABLE'
        ? {
            templateType: 'TABLE' as const,
            templateConfig: {
              rowsPerPage: input.tableRowsPerPage,
              fontSize: input.tableFontSize,
              displayColumns: input.tableDisplayColumns,
              ...(input.manualColumnWidths && Object.keys(input.tableColumnWidths).length > 0
                ? { columnWidths: input.tableColumnWidths }
                : {}),
              headerFixed: true,
            },
          }
        : {}),
    },
  };
}

export function applyDisplayNameChange(
  columnDefinitions: CsvDashboard['columnDefinitions'],
  index: number,
  value: string
): CsvDashboard['columnDefinitions'] {
  return columnDefinitions.map((item, idx) => {
    if (idx !== index) return item;
    const updatedCandidates = [...item.csvHeaderCandidates];
    if (value && !updatedCandidates.includes(value)) {
      updatedCandidates.unshift(value);
    }
    return { ...item, displayName: value, csvHeaderCandidates: updatedCandidates };
  });
}

export function parseCsvHeaderCandidatesInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((val) => val.trim())
        .filter((val) => val.length > 0)
    )
  );
}
