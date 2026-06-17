import { describe, expect, it } from 'vitest';

import { normalizeLeaderBoardRow } from '../normalizeLeaderBoardRow';

import type { ProductionScheduleRow } from '../../../../api/client';

const mkRow = (rowData: Record<string, unknown>): ProductionScheduleRow => ({
  id: 'r1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  rowData,
  processingOrder: null,
  dueDate: null,
  plannedEndDate: null
});

describe('normalizeLeaderBoardRow', () => {
  it('maps FSIGENSHOYORYO to machineRequiredMinutes and requiredMinutes', () => {
    const row = normalizeLeaderBoardRow(
      mkRow({
        FSIGENCD: '305',
        FSEIBAN: 'S1',
        FSIGENSHOYORYO: '120',
        progress: ''
      })
    );
    expect(row?.machineRequiredMinutes).toBe(120);
    expect(row?.laborRequiredMinutes).toBe(0);
    expect(row?.requiredMinutes).toBe(120);
  });

  it('uses API labor metadata when provided', () => {
    const row = normalizeLeaderBoardRow({
      ...mkRow({
        FSIGENCD: '021',
        FSEIBAN: 'S1',
        FSIGENSHOYORYO: '400',
        progress: ''
      }),
      machineRequiredMinutes: 400,
      laborRequiredMinutes: 175
    });
    expect(row?.machineRequiredMinutes).toBe(400);
    expect(row?.laborRequiredMinutes).toBe(175);
    expect(row?.requiredMinutes).toBe(400);
  });

  it('excludes FSIGENCD=10 from slot display rows', () => {
    const row = normalizeLeaderBoardRow(
      mkRow({
        FSIGENCD: '10',
        FSEIBAN: 'S1',
        FSIGENSHOYORYO: '60',
        progress: ''
      })
    );
    expect(row).toBeNull();
  });

  it('uses 0 for missing or invalid FSIGENSHOYORYO', () => {
    const row = normalizeLeaderBoardRow(
      mkRow({
        FSIGENCD: '305',
        FSEIBAN: 'S1',
        progress: ''
      })
    );
    expect(row?.requiredMinutes).toBe(0);
    expect(row?.machineRequiredMinutes).toBe(0);
  });

  it('carries self-inspection template id for paper print workflow', () => {
    const row = normalizeLeaderBoardRow({
      ...mkRow({
        FSIGENCD: '305',
        FSEIBAN: 'S1',
        progress: ''
      }),
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-1',
      selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?templateId=tpl-1'
    });
    expect(row?.selfInspectionTemplateId).toBe('tpl-1');
  });
});
