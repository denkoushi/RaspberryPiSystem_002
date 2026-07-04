import { describe, expect, it } from 'vitest';

import {
  buildSavePayload,
  clearPalletVizTargets,
  computeIsDirty,
  extractCsvDashboardId,
  parseJson,
  setCsvDashboardId,
  togglePalletVizMachine,
} from './visualizationDashboardFormModel';
import {
  DEFAULT_JSON,
  MI_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE,
  MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  MI_LOAN_INSPECTION_RENDERER_TYPE,
  RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE,
  RIGGING_LOAN_INSPECTION_RENDERER_TYPE,
  UNINSPECTED_DATA_SOURCE_TYPE,
  UNINSPECTED_RENDERER_TYPE,
} from './visualizationDashboardPresets';

import type { VisualizationDashboard } from '../../../api/client';

function makeDashboard(overrides: Partial<VisualizationDashboard> = {}): VisualizationDashboard {
  return {
    id: 'viz-1',
    name: 'Test Viz',
    description: 'desc',
    dataSourceType: 'custom_source',
    rendererType: 'custom_renderer',
    dataSourceConfig: { foo: 'bar' },
    rendererConfig: { theme: 'dark' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('visualizationDashboardFormModel', () => {
  describe('parseJson', () => {
    it('returns empty object for blank input', () => {
      expect(parseJson('  ', 'データソース設定')).toEqual({ value: {} });
    });

    it('parses valid object JSON', () => {
      const result = parseJson('{"metric":"usage"}', 'データソース設定');
      expect(result).toEqual({ value: { metric: 'usage' } });
    });

    it('rejects array JSON', () => {
      const result = parseJson('[1,2]', 'レンダラー設定');
      expect(result.error).toBe('レンダラー設定はオブジェクト形式で指定してください。');
    });

    it('rejects invalid JSON syntax', () => {
      const result = parseJson('{bad', 'データソース設定');
      expect(result.error).toBe('データソース設定のJSON形式が不正です。');
    });
  });

  describe('extractCsvDashboardId / setCsvDashboardId', () => {
    it('extracts csvDashboardId from valid config', () => {
      const config = JSON.stringify({ csvDashboardId: 'dash-abc', maxRows: 30 }, null, 2);
      expect(extractCsvDashboardId(config)).toBe('dash-abc');
    });

    it('returns empty string on parse failure', () => {
      expect(extractCsvDashboardId('{invalid')).toBe('');
    });

    it('patches csvDashboardId in existing config', () => {
      const original = JSON.stringify({ csvDashboardId: '', date: '', maxRows: 30 }, null, 2);
      const updated = setCsvDashboardId(original, 'new-id');
      expect(JSON.parse(updated)).toEqual({ csvDashboardId: 'new-id', date: '', maxRows: 30 });
    });

    it('creates default template on parse failure', () => {
      const updated = setCsvDashboardId('{bad', 'fallback-id');
      expect(JSON.parse(updated)).toEqual({
        csvDashboardId: 'fallback-id',
        date: '',
        maxRows: 30,
      });
    });
  });

  describe('togglePalletVizMachine', () => {
    const order = ['M01', 'M02', 'M03'];

    it('adds machine in resource-master order', () => {
      const config = '{}';
      const result = togglePalletVizMachine(config, 'm02', new Set(), order);
      expect(JSON.parse(result)).toEqual({ machineCds: ['M02'] });
    });

    it('removes machine and deletes key when empty', () => {
      const config = JSON.stringify({ machineCds: ['M01', 'M02'] }, null, 2);
      const selected = new Set(['M01', 'M02']);
      const result = togglePalletVizMachine(config, 'M01', selected, order);
      const parsed = JSON.parse(result) as Record<string, unknown>;
      expect(parsed.machineCds).toEqual(['M02']);
    });

    it('removes machineCds key when last machine deselected', () => {
      const config = JSON.stringify({ machineCds: ['M01'], pageIndex: 0 }, null, 2);
      const selected = new Set(['M01']);
      const result = togglePalletVizMachine(config, 'M01', selected, order);
      const parsed = JSON.parse(result) as Record<string, unknown>;
      expect(parsed).toEqual({ pageIndex: 0 });
      expect(parsed).not.toHaveProperty('machineCds');
    });

    it('preserves order from resource master when multiple selected', () => {
      const config = '{}';
      let selected = new Set<string>();
      let configAfter = togglePalletVizMachine(config, 'M03', selected, order);
      selected = new Set(['M03']);
      configAfter = togglePalletVizMachine(configAfter, 'M01', selected, order);
      expect(JSON.parse(configAfter)).toEqual({ machineCds: ['M01', 'M03'] });
    });
  });

  describe('clearPalletVizTargets', () => {
    it('removes machineCds while preserving other keys', () => {
      const config = JSON.stringify({ machineCds: ['M01'], pageIndex: 1 }, null, 2);
      const result = clearPalletVizTargets(config);
      expect(JSON.parse(result)).toEqual({ pageIndex: 1 });
    });

    it('returns empty object on parse failure', () => {
      expect(clearPalletVizTargets('{bad')).toBe('{}');
    });
  });

  describe('computeIsDirty', () => {
    it('detects dirty state in create mode', () => {
      expect(
        computeIsDirty({
          isCreating: true,
          name: 'New',
          description: '',
          dataSourceType: '',
          rendererType: '',
          dataSourceConfig: DEFAULT_JSON,
          rendererConfig: DEFAULT_JSON,
          enabled: true,
          selected: null,
        }),
      ).toBe(true);
    });

    it('returns false in create mode with empty form', () => {
      expect(
        computeIsDirty({
          isCreating: true,
          name: '',
          description: '',
          dataSourceType: '',
          rendererType: '',
          dataSourceConfig: DEFAULT_JSON,
          rendererConfig: DEFAULT_JSON,
          enabled: true,
          selected: null,
        }),
      ).toBe(false);
    });

    it('detects dirty state in edit mode', () => {
      const selected = makeDashboard();
      expect(
        computeIsDirty({
          isCreating: false,
          name: 'Changed',
          description: selected.description ?? '',
          dataSourceType: selected.dataSourceType,
          rendererType: selected.rendererType,
          dataSourceConfig: JSON.stringify(selected.dataSourceConfig, null, 2),
          rendererConfig: JSON.stringify(selected.rendererConfig, null, 2),
          enabled: selected.enabled,
          selected,
        }),
      ).toBe(true);
    });
  });

  describe('buildSavePayload', () => {
    const baseInput = {
      name: 'Dashboard',
      description: '',
      dataSourceType: 'custom',
      rendererType: 'custom',
      dataSourceConfig: '{}',
      rendererConfig: '{}',
      enabled: true,
    };

    it('rejects missing name', () => {
      const result = buildSavePayload({ ...baseInput, name: '  ' });
      expect(result).toEqual({ ok: false, error: '名前は必須です。' });
    });

    it('requires csvDashboardId for uninspected preset', () => {
      const result = buildSavePayload({
        ...baseInput,
        dataSourceType: UNINSPECTED_DATA_SOURCE_TYPE,
        rendererType: UNINSPECTED_RENDERER_TYPE,
        dataSourceConfig: JSON.stringify({ csvDashboardId: '' }, null, 2),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('csvDashboardId');
      }
    });

    it('requires sectionEquals for measuring inspection preset', () => {
      const result = buildSavePayload({
        ...baseInput,
        dataSourceType: MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
        rendererType: MI_LOAN_INSPECTION_RENDERER_TYPE,
        dataSourceConfig: JSON.stringify({ sectionEquals: '  ' }, null, 2),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('sectionEquals');
      }
    });

    it('requires sectionEquals for rigging inspection preset', () => {
      const result = buildSavePayload({
        ...baseInput,
        dataSourceType: RIGGING_LOAN_INSPECTION_DATA_SOURCE_TYPE,
        rendererType: RIGGING_LOAN_INSPECTION_RENDERER_TYPE,
        dataSourceConfig: JSON.stringify({ period: 'today_jst' }, null, 2),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('sectionEquals');
      }
    });

    it('converts empty description to null', () => {
      const result = buildSavePayload({
        ...baseInput,
        dataSourceType: MI_LOAN_INSPECTION_DATA_SOURCE_TYPE,
        rendererType: MI_LOAN_INSPECTION_RENDERER_TYPE,
        dataSourceConfig: MI_LOAN_INSPECTION_DATA_SOURCE_TEMPLATE,
        description: '   ',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.description).toBeNull();
      }
    });

    it('builds valid payload for uninspected preset', () => {
      const result = buildSavePayload({
        ...baseInput,
        dataSourceType: UNINSPECTED_DATA_SOURCE_TYPE,
        rendererType: UNINSPECTED_RENDERER_TYPE,
        dataSourceConfig: JSON.stringify({ csvDashboardId: 'dash-1', maxRows: 30 }, null, 2),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.dataSourceConfig).toEqual({ csvDashboardId: 'dash-1', maxRows: 30 });
      }
    });
  });
});
