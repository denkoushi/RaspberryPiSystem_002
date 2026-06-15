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
  it('maps FSIGENSHOYORYO to requiredMinutes', () => {
    const row = normalizeLeaderBoardRow(
      mkRow({
        FSIGENCD: '305',
        FSEIBAN: 'S1',
        FSIGENSHOYORYO: '120',
        progress: ''
      })
    );
    expect(row?.requiredMinutes).toBe(120);
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
