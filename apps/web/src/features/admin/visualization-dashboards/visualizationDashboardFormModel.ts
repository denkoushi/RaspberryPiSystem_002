import {
  DEFAULT_JSON,
  MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  UNINSPECTED_DATA_SOURCE_TYPE,
} from './visualizationDashboardPresets';

import type { VisualizationDashboard } from '../../../api/client';

export type JsonParseResult = { value: Record<string, unknown> | null; error?: string };

export function parseJson(input: string, label: string): JsonParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: {} };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown> };
    }
    return { value: null, error: `${label}はオブジェクト形式で指定してください。` };
  } catch {
    return { value: null, error: `${label}のJSON形式が不正です。` };
  }
}

export function extractCsvDashboardId(dataSourceConfig: string): string {
  try {
    const parsed = JSON.parse(dataSourceConfig);
    return typeof parsed?.csvDashboardId === 'string' ? parsed.csvDashboardId : '';
  } catch {
    return '';
  }
}

export function setCsvDashboardId(dataSourceConfig: string, csvDashboardId: string): string {
  try {
    const parsed = JSON.parse(dataSourceConfig);
    const updated = {
      ...parsed,
      csvDashboardId: csvDashboardId || '',
    };
    return JSON.stringify(updated, null, 2);
  } catch {
    return JSON.stringify(
      {
        csvDashboardId: csvDashboardId || '',
        date: '',
        maxRows: 30,
      },
      null,
      2,
    );
  }
}

export function extractPalletVizSelectedMachineSet(
  dataSourceConfig: string,
  isPalletVizPreset: boolean,
): Set<string> {
  if (!isPalletVizPreset) {
    return new Set<string>();
  }
  try {
    const parsed = JSON.parse(dataSourceConfig) as { machineCds?: unknown };
    if (!Array.isArray(parsed.machineCds)) {
      return new Set<string>();
    }
    return new Set(
      parsed.machineCds
        .filter((v): v is string => typeof v === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    );
  } catch {
    return new Set<string>();
  }
}

export function togglePalletVizMachine(
  dataSourceConfig: string,
  machineCdRaw: string,
  palletVizSelectedMachineSet: Set<string>,
  palletVizMachinesInOrder: string[],
): string {
  const machineCd = machineCdRaw.trim().toUpperCase();
  if (!machineCd) {
    return dataSourceConfig;
  }
  const order = palletVizMachinesInOrder.length > 0 ? palletVizMachinesInOrder : [machineCd];
  try {
    const parsed = (JSON.parse(dataSourceConfig) as Record<string, unknown> & { machineCds?: unknown }) ?? {};
    const next: Record<string, unknown> = { ...parsed };
    const selected = new Set(palletVizSelectedMachineSet);
    if (selected.has(machineCd)) {
      selected.delete(machineCd);
    } else {
      selected.add(machineCd);
    }
    if (selected.size === 0) {
      delete next.machineCds;
    } else {
      next.machineCds = order.filter((cd) => selected.has(cd));
    }
    return JSON.stringify(next, null, 2);
  } catch {
    const selected = new Set(palletVizSelectedMachineSet);
    if (selected.has(machineCd)) {
      selected.delete(machineCd);
    } else {
      selected.add(machineCd);
    }
    const next: Record<string, unknown> =
      selected.size === 0 ? {} : { machineCds: order.filter((cd) => selected.has(cd)) };
    return JSON.stringify(next, null, 2);
  }
}

export function clearPalletVizTargets(dataSourceConfig: string): string {
  try {
    const parsed = (JSON.parse(dataSourceConfig) as Record<string, unknown> & { machineCds?: unknown }) ?? {};
    const next: Record<string, unknown> = { ...parsed };
    delete next.machineCds;
    return JSON.stringify(next, null, 2);
  } catch {
    return '{}';
  }
}

export type ComputeIsDirtyInput = {
  isCreating: boolean;
  name: string;
  description: string;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: string;
  rendererConfig: string;
  enabled: boolean;
  selected: VisualizationDashboard | null;
};

export function computeIsDirty(input: ComputeIsDirtyInput): boolean {
  const {
    isCreating,
    name,
    description,
    dataSourceType,
    rendererType,
    dataSourceConfig,
    rendererConfig,
    enabled,
    selected,
  } = input;

  if (isCreating) {
    return Boolean(
      name || description || dataSourceType || rendererType || dataSourceConfig.trim() !== DEFAULT_JSON,
    );
  }
  if (!selected) return false;
  return (
    name !== (selected.name ?? '') ||
    description !== (selected.description ?? '') ||
    dataSourceType !== (selected.dataSourceType ?? '') ||
    rendererType !== (selected.rendererType ?? '') ||
    dataSourceConfig.trim() !== JSON.stringify(selected.dataSourceConfig ?? {}, null, 2) ||
    rendererConfig.trim() !== JSON.stringify(selected.rendererConfig ?? {}, null, 2) ||
    enabled !== Boolean(selected.enabled)
  );
}

export type SavePayloadFields = {
  name: string;
  description: string | null;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: Record<string, unknown>;
  rendererConfig: Record<string, unknown>;
  enabled: boolean;
};

export type BuildSavePayloadSuccess = {
  ok: true;
  payload: SavePayloadFields;
};

export type BuildSavePayloadFailure = {
  ok: false;
  error: string;
};

export type BuildSavePayloadResult = BuildSavePayloadSuccess | BuildSavePayloadFailure;

export type BuildSavePayloadInput = {
  name: string;
  description: string;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: string;
  rendererConfig: string;
  enabled: boolean;
};

export function buildSavePayload(input: BuildSavePayloadInput): BuildSavePayloadResult {
  const { name, description, dataSourceType, rendererType, dataSourceConfig, rendererConfig, enabled } =
    input;

  if (!name.trim()) {
    return { ok: false, error: '名前は必須です。' };
  }
  if (!dataSourceType.trim()) {
    return { ok: false, error: 'データソースタイプは必須です。' };
  }
  if (!rendererType.trim()) {
    return { ok: false, error: 'レンダラータイプは必須です。' };
  }

  const dataSourceParsed = parseJson(dataSourceConfig, 'データソース設定');
  if (dataSourceParsed.error) {
    return { ok: false, error: dataSourceParsed.error };
  }
  const rendererParsed = parseJson(rendererConfig, 'レンダラー設定');
  if (rendererParsed.error) {
    return { ok: false, error: rendererParsed.error };
  }

  if (dataSourceType.trim() === UNINSPECTED_DATA_SOURCE_TYPE) {
    const cfg = dataSourceParsed.value ?? {};
    const csvDashboardId = typeof cfg.csvDashboardId === 'string' ? cfg.csvDashboardId.trim() : '';
    if (!csvDashboardId) {
      return {
        ok: false,
        error:
          '未点検加工機データソースでは csvDashboardId が必須です。CSVダッシュボードIDを設定してください。',
      };
    }
  }
  if (dataSourceType.trim() === MI_LOAN_INSPECTION_DATA_SOURCE_TYPE) {
    const cfg = dataSourceParsed.value ?? {};
    const sectionEquals = typeof cfg.sectionEquals === 'string' ? cfg.sectionEquals.trim() : '';
    if (!sectionEquals) {
      return {
        ok: false,
        error: '計測機器持出状況（点検可視化）データソースでは sectionEquals が必須です。',
      };
    }
  }
  if (dataSourceType.trim() === RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE) {
    const cfg = dataSourceParsed.value ?? {};
    const sectionEquals = typeof cfg.sectionEquals === 'string' ? cfg.sectionEquals.trim() : '';
    if (!sectionEquals) {
      return {
        ok: false,
        error: '吊具持出状況（点検可視化）データソースでは sectionEquals が必須です。',
      };
    }
  }

  return {
    ok: true,
    payload: {
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      dataSourceType: dataSourceType.trim(),
      rendererType: rendererType.trim(),
      dataSourceConfig: dataSourceParsed.value ?? {},
      rendererConfig: rendererParsed.value ?? {},
      enabled,
    },
  };
}
