import { describe, expect, it } from 'vitest';

import {
  applyDisplayNameChange,
  buildUpdatePayload,
  normalizeColumnDefinitions,
  parseCsvHeaderCandidatesInput,
  syncFormFromDashboard,
  validateColumnDefinitions,
} from './csvDashboardFormModel';
import { buildMachineDailyInspectionPreset } from './csvDashboardPresets';

import type { CsvDashboard } from '../../../api/client';

const sampleColumn = {
  order: 0,
  internalName: 'colA',
  displayName: '列A',
  csvHeaderCandidates: ['列A', 'ColA'],
  dataType: 'string' as const,
  required: true,
};

function makeDashboard(overrides: Partial<CsvDashboard> = {}): CsvDashboard {
  return {
    id: 'dash-1',
    name: 'Test Dashboard',
    description: null,
    columnDefinitions: [sampleColumn],
    dateColumnName: 'colA',
    displayPeriodDays: 7,
    emptyMessage: 'empty',
    ingestMode: 'APPEND',
    dedupKeyColumns: [],
    gmailScheduleId: null,
    gmailSubjectPattern: 'subject',
    templateType: 'TABLE',
    templateConfig: {
      rowsPerPage: 30,
      fontSize: 18,
      displayColumns: ['colA'],
      columnWidths: { colA: 120 },
      headerFixed: true,
    },
    csvFilePath: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('csvDashboardFormModel', () => {
  describe('normalizeColumnDefinitions', () => {
    it('reindexes order by array position', () => {
      const columns = [
        { ...sampleColumn, order: 5 },
        { ...sampleColumn, internalName: 'colB', order: 2 },
      ];
      expect(normalizeColumnDefinitions(columns).map((c) => c.order)).toEqual([0, 1]);
    });
  });

  describe('validateColumnDefinitions', () => {
    it('rejects empty column list', () => {
      expect(validateColumnDefinitions([])).toBe('列定義が空です。');
    });

    it('rejects blank display names', () => {
      expect(
        validateColumnDefinitions([{ ...sampleColumn, displayName: '  ' }])
      ).toBe('表示名が空の列があります。');
    });

    it('rejects empty csv header candidates', () => {
      expect(
        validateColumnDefinitions([{ ...sampleColumn, csvHeaderCandidates: [] }])
      ).toBe('CSVヘッダー候補が空の列があります（colA）。');
    });

    it('accepts valid columns', () => {
      expect(validateColumnDefinitions([sampleColumn])).toBeNull();
    });
  });

  describe('syncFormFromDashboard', () => {
    it('syncs TABLE dashboard templateConfig and basic fields', () => {
      const dashboard = makeDashboard();
      const synced = syncFormFromDashboard(dashboard);

      expect(synced.displayPeriodDays).toBe(7);
      expect(synced.dateColumnName).toBe('colA');
      expect(synced.emptyMessage).toBe('empty');
      expect(synced.gmailSubjectPattern).toBe('subject');
      expect(synced.enabled).toBe(true);
      expect(synced.columnDefinitions).toEqual([{ ...sampleColumn, order: 0 }]);
      expect(synced.tableRowsPerPage).toBe(30);
      expect(synced.tableFontSize).toBe(18);
      expect(synced.tableDisplayColumns).toEqual(['colA']);
      expect(synced.tableColumnWidths).toEqual({ colA: 120 });
      expect(synced.manualColumnWidths).toBe(true);
      expect(synced.previewCsvContent).toBe('');
      expect(synced.previewResult).toBeNull();
    });

    it('uses column internalNames when TABLE displayColumns missing', () => {
      const dashboard = makeDashboard({
        templateConfig: { rowsPerPage: 50, fontSize: 14 },
      });
      const synced = syncFormFromDashboard(dashboard);
      expect(synced.tableDisplayColumns).toEqual(['colA']);
      expect(synced.tableFontSize).toBe(14);
    });

    it('resets table state to defaults for non-TABLE dashboards', () => {
      const dashboard = makeDashboard({
        templateType: 'CARD_GRID',
        templateConfig: { rowsPerPage: 99, fontSize: 20, displayColumns: ['colA'] },
      });
      const synced = syncFormFromDashboard(dashboard);

      expect(synced.tableRowsPerPage).toBe(50);
      expect(synced.tableFontSize).toBe(14);
      expect(synced.tableDisplayColumns).toEqual([]);
      expect(synced.tableColumnWidths).toEqual({});
      expect(synced.manualColumnWidths).toBe(false);
    });
  });

  describe('buildUpdatePayload', () => {
    const baseInput = {
      selected: makeDashboard(),
      normalizedColumnDefinitions: [sampleColumn],
      displayPeriodDays: 3,
      dateColumnName: '',
      emptyMessage: '',
      gmailSubjectPattern: '  ',
      enabled: false,
      tableDisplayColumns: ['colA'],
      tableFontSize: 16,
      tableRowsPerPage: 40,
      manualColumnWidths: true,
      tableColumnWidths: { colA: 100 },
    };

    it('maps empty strings to null and includes TABLE templateConfig', () => {
      const result = buildUpdatePayload(baseInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.payload.dateColumnName).toBeNull();
      expect(result.payload.emptyMessage).toBeNull();
      expect(result.payload.gmailSubjectPattern).toBe('  ');
      expect(result.payload.enabled).toBe(false);
      expect(result.payload.displayPeriodDays).toBe(3);
      expect(result.payload.templateType).toBe('TABLE');
      expect(result.payload.templateConfig).toEqual({
        rowsPerPage: 40,
        fontSize: 16,
        displayColumns: ['colA'],
        columnWidths: { colA: 100 },
        headerFixed: true,
      });
    });

    it('omits columnWidths when manual widths disabled', () => {
      const result = buildUpdatePayload({
        ...baseInput,
        manualColumnWidths: false,
        tableColumnWidths: { colA: 100 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.templateConfig).toEqual({
        rowsPerPage: 40,
        fontSize: 16,
        displayColumns: ['colA'],
        headerFixed: true,
      });
    });

    it('rejects out-of-range font size', () => {
      const result = buildUpdatePayload({ ...baseInput, tableFontSize: 5 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorField).toBe('templateConfig');
      expect(result.message).toContain('フォントサイズ');
    });

    it('rejects zero display columns for TABLE', () => {
      const result = buildUpdatePayload({ ...baseInput, tableDisplayColumns: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain('サイネージ表示列');
    });

    it('skips templateConfig for non-TABLE dashboards', () => {
      const result = buildUpdatePayload({
        ...baseInput,
        selected: makeDashboard({ templateType: 'CARD_GRID' }),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.templateType).toBeUndefined();
      expect(result.payload.templateConfig).toBeUndefined();
    });
  });

  describe('applyDisplayNameChange', () => {
    it('prepends display name to csv header candidates when new', () => {
      const updated = applyDisplayNameChange([sampleColumn], 0, '新名称');
      expect(updated[0].displayName).toBe('新名称');
      expect(updated[0].csvHeaderCandidates[0]).toBe('新名称');
      expect(updated[0].csvHeaderCandidates).toContain('列A');
    });
  });

  describe('parseCsvHeaderCandidatesInput', () => {
    it('splits, trims, deduplicates candidates', () => {
      expect(parseCsvHeaderCandidatesInput(' A , B , A ,  ')).toEqual(['A', 'B']);
    });
  });
});

describe('csvDashboardPresets', () => {
  it('buildMachineDailyInspectionPreset has expected shape and fontSize 16', () => {
    const preset = buildMachineDailyInspectionPreset();
    expect(preset.name).toBe('加工機_日常点検結果');
    expect(preset.templateType).toBe('TABLE');
    expect(preset.templateConfig?.fontSize).toBe(16);
    expect(preset.templateConfig?.rowsPerPage).toBe(50);
    expect(preset.columnDefinitions).toHaveLength(9);
    expect(preset.dateColumnName).toBe('inspectionAt');
  });
});
