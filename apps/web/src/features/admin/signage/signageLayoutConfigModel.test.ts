import { describe, expect, it } from 'vitest';

import {
  buildLayoutConfigFromEditorState,
  createDefaultEditorState,
  editorStateFromSchedule,
  type SignageScheduleEditorState,
} from './signageLayoutConfigModel';

import type { SignageLayoutConfig, SignagePdf, SignageSchedule } from '../../../api/client';

const SAMPLE_PDFS: SignagePdf[] = [
  {
    id: 'pdf-slideshow',
    name: 'Slideshow PDF',
    filename: 'slide.pdf',
    filePath: '/data/slide.pdf',
    displayMode: 'SLIDESHOW',
    slideInterval: 15,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pdf-single',
    name: 'Single PDF',
    filename: 'single.pdf',
    filePath: '/data/single.pdf',
    displayMode: 'SINGLE',
    slideInterval: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function baseSchedule(partial: Partial<SignageSchedule>): SignageSchedule {
  return {
    id: 'sched-1',
    name: 'Test Schedule',
    contentType: 'TOOLS',
    pdfId: null,
    layoutConfig: null,
    targetClientKeys: [],
    dayOfWeek: [1, 2, 3],
    startTime: '09:00',
    endTime: '18:00',
    priority: 1,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function roundTripLayoutConfig(
  layoutConfig: SignageLayoutConfig,
  pdfs: SignagePdf[] = SAMPLE_PDFS
): SignageLayoutConfig | null {
  const schedule = baseSchedule({ layoutConfig, contentType: 'TOOLS' });
  const editorState: SignageScheduleEditorState = editorStateFromSchedule(schedule);
  return buildLayoutConfigFromEditorState(editorState, pdfs);
}

describe('signageLayoutConfigModel', () => {
  describe('round-trip parse → build for FULL slot kinds', () => {
    it('loans', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [{ position: 'FULL', kind: 'loans', config: {} }],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('pdf with slideshow enrichment from pdfs list', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'pdf',
            config: {
              pdfId: 'pdf-slideshow',
              displayMode: 'SLIDESHOW',
              slideInterval: 15,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('pdf with single display mode', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'pdf',
            config: {
              pdfId: 'pdf-single',
              displayMode: 'SINGLE',
              slideInterval: null,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('csv_dashboard', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'csv_dashboard',
            config: { csvDashboardId: 'csv-1' },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('visualization', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'visualization',
            config: { visualizationDashboardId: 'viz-1' },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('kiosk_progress_overview with optional numeric fields', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'kiosk_progress_overview',
            config: {
              deviceScopeKey: 'scope-kiosk',
              slideIntervalSeconds: 45,
              seibanPerPage: 6,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('kiosk_leader_order_cards', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'kiosk_leader_order_cards',
            config: {
              deviceScopeKey: 'scope-leader',
              resourceCds: ['R001', 'R002'],
              slideIntervalSeconds: 30,
              cardsPerPage: 8,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('mobile_placement_parts_shelf_grid', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'mobile_placement_parts_shelf_grid',
            config: { maxItemsPerZone: 24 },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('self_inspection_machine_board manual mode', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'manual_machine_name',
              machineName: 'L300KP',
              deviceScopeKey: 'scope-si',
              slideIntervalSeconds: 30,
              partsPerPage: 10,
              detailTopN: 7,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('self_inspection_machine_board auto mode', () => {
      const original: SignageLayoutConfig = {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'auto_from_leaderboard_status',
              deviceScopeKey: 'scope-auto',
              resourceCds: ['RD01', 'RD02'],
              maxAutoMachines: 8,
              slideIntervalSeconds: 20,
              partsPerPage: 12,
              detailTopN: 5,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });
  });

  describe('round-trip parse → build for SPLIT layouts', () => {
    it('loans + pdf', () => {
      const original: SignageLayoutConfig = {
        layout: 'SPLIT',
        slots: [
          { position: 'LEFT', kind: 'loans', config: {} },
          {
            position: 'RIGHT',
            kind: 'pdf',
            config: {
              pdfId: 'pdf-single',
              displayMode: 'SINGLE',
              slideInterval: null,
            },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('csv_dashboard + visualization', () => {
      const original: SignageLayoutConfig = {
        layout: 'SPLIT',
        slots: [
          {
            position: 'LEFT',
            kind: 'csv_dashboard',
            config: { csvDashboardId: 'csv-left' },
          },
          {
            position: 'RIGHT',
            kind: 'visualization',
            config: { visualizationDashboardId: 'viz-right' },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });

    it('pdf + csv_dashboard', () => {
      const original: SignageLayoutConfig = {
        layout: 'SPLIT',
        slots: [
          {
            position: 'LEFT',
            kind: 'pdf',
            config: {
              pdfId: 'pdf-slideshow',
              displayMode: 'SLIDESHOW',
              slideInterval: 15,
            },
          },
          {
            position: 'RIGHT',
            kind: 'csv_dashboard',
            config: { csvDashboardId: 'csv-right' },
          },
        ],
      };
      expect(roundTripLayoutConfig(original)).toEqual(original);
    });
  });

  describe('legacy contentType schedules use old form (build returns null)', () => {
    it('TOOLS legacy', () => {
      const schedule = baseSchedule({ contentType: 'TOOLS', layoutConfig: null });
      const editorState = editorStateFromSchedule(schedule);
      expect(editorState.useNewLayout).toBe(false);
      expect(buildLayoutConfigFromEditorState(editorState, SAMPLE_PDFS)).toBeNull();
    });

    it('PDF legacy', () => {
      const schedule = baseSchedule({
        contentType: 'PDF',
        pdfId: 'pdf-single',
        layoutConfig: null,
      });
      const editorState = editorStateFromSchedule(schedule);
      expect(editorState.useNewLayout).toBe(false);
      expect(editorState.fullSlotKind).toBe('pdf');
      expect(editorState.fullPdfId).toBe('pdf-single');
      expect(buildLayoutConfigFromEditorState(editorState, SAMPLE_PDFS)).toBeNull();
    });

    it('SPLIT legacy', () => {
      const schedule = baseSchedule({
        contentType: 'SPLIT',
        pdfId: 'pdf-slideshow',
        layoutConfig: null,
      });
      const editorState = editorStateFromSchedule(schedule);
      expect(editorState.useNewLayout).toBe(false);
      expect(editorState.layoutType).toBe('SPLIT');
      expect(editorState.leftSlotKind).toBe('loans');
      expect(editorState.rightSlotKind).toBe('pdf');
      expect(editorState.rightPdfId).toBe('pdf-slideshow');
      expect(buildLayoutConfigFromEditorState(editorState, SAMPLE_PDFS)).toBeNull();
    });
  });

  describe('buildLayoutConfig validation-error branches', () => {
    it('returns null when useNewLayout is false', () => {
      const state = createDefaultEditorState();
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toBeNull();
    });

    it('self_inspection manual without machineName returns null', () => {
      const state: SignageScheduleEditorState = {
        ...createDefaultEditorState(),
        useNewLayout: true,
        layoutType: 'FULL',
        fullSlotKind: 'self_inspection_machine_board',
        fullSelfInspectionTargetMode: 'manual_machine_name',
        fullSelfInspectionMachineName: '',
      };
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toBeNull();
    });

    it('self_inspection auto without deviceScopeKey returns null', () => {
      const state: SignageScheduleEditorState = {
        ...createDefaultEditorState(),
        useNewLayout: true,
        layoutType: 'FULL',
        fullSlotKind: 'self_inspection_machine_board',
        fullSelfInspectionTargetMode: 'auto_from_leaderboard_status',
        fullSelfInspectionDeviceScopeKey: '',
        fullSelfInspectionResourceCdsText: 'RD01',
      };
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toBeNull();
    });

    it('self_inspection auto without resourceCds returns null', () => {
      const state: SignageScheduleEditorState = {
        ...createDefaultEditorState(),
        useNewLayout: true,
        layoutType: 'FULL',
        fullSlotKind: 'self_inspection_machine_board',
        fullSelfInspectionTargetMode: 'auto_from_leaderboard_status',
        fullSelfInspectionDeviceScopeKey: 'scope-auto',
        fullSelfInspectionResourceCdsText: '',
      };
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toBeNull();
    });

    it('kiosk_progress_overview without deviceScopeKey falls back to loans', () => {
      const state: SignageScheduleEditorState = {
        ...createDefaultEditorState(),
        useNewLayout: true,
        layoutType: 'FULL',
        fullSlotKind: 'kiosk_progress_overview',
        fullKioskDeviceScopeKey: '',
      };
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toEqual({
        layout: 'FULL',
        slots: [{ position: 'FULL', kind: 'loans', config: {} }],
      });
    });

    it('kiosk_leader_order_cards without resourceCds falls back to loans', () => {
      const state: SignageScheduleEditorState = {
        ...createDefaultEditorState(),
        useNewLayout: true,
        layoutType: 'FULL',
        fullSlotKind: 'kiosk_leader_order_cards',
        fullLeaderOrderDeviceScopeKey: 'scope-leader',
        fullLeaderOrderResourceCdsText: '',
      };
      expect(buildLayoutConfigFromEditorState(state, SAMPLE_PDFS)).toEqual({
        layout: 'FULL',
        slots: [{ position: 'FULL', kind: 'loans', config: {} }],
      });
    });
  });
});
